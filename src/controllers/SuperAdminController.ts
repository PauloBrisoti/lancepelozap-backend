import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { getTimezone } from '../lib/dateUtils';

export class SuperAdminController {

  // ==========================================
  // DASHBOARD SUPER ADMIN
  // ==========================================

  async getDashboard(req: Request, res: Response) {
    try {
      // O middleware requireAuth e os middlewares do router já garantem o acesso

      const totalClients = await prisma.client.count();
      const totalStores = await prisma.store.count();
      const totalUsers = await prisma.user.count();

      // MRR do SaaS: Soma das mensalidades das assinaturas ativas/pagas
      const totalRevenueAggr = await prisma.subscription.aggregate({
        _sum: { valorMensalidade: true },
        where: { statusPagamento: 'PAGO' }
      });

      // Faturas pendentes do SaaS
      const totalPendingReceivablesAggr = await prisma.invoice.aggregate({
        _sum: { valorCobrado: true },
        where: { status: 'PENDENTE' }
      });

      // Top Lojas por assinaturas mais caras (ou mantemos quantidade de usuários?)
      // Vamos pegar os clientes com as assinaturas mais altas
      const topStoresAggr = await prisma.subscription.groupBy({
        by: ['clientId'],
        _sum: { valorMensalidade: true },
        where: { statusPagamento: 'PAGO' },
        orderBy: { _sum: { valorMensalidade: 'desc' } },
        take: 5
      });

      const topStoresList = await Promise.all(
        topStoresAggr.map(async (t) => {
          const client = await prisma.client.findUnique({ where: { id: t.clientId } });
          return {
            storeId: t.clientId, // mantendo compatibilidade com frontend por agora
            nomeFantasia: client?.nomeCompleto || 'Desconhecido',
            faturamentoTotal: t._sum.valorMensalidade || 0
          };
        })
      );

      return res.json({
        totalClients,
        totalStores,
        totalUsers,
        totalRevenue: totalRevenueAggr._sum.valorMensalidade || 0,
        totalPendingReceivables: totalPendingReceivablesAggr._sum.valorCobrado || 0,
        topStores: topStoresList,
        status: 'ok'
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao carregar dashboard do super admin' });
    }
  }

  // ==========================================
  // CLIENTES E LOJAS
  // ==========================================

  // Lista todos os Clientes e suas assinaturas e usuários
  async getAllClients(req: Request, res: Response) {
    try {
      // RBAC já validado na rota

      const clients = await prisma.client.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          subscriptions: true,
          clientUsers: {
            include: { user: { select: { id: true, nome: true, email: true, ativo: true } } }
          },
          controls: {
            include: {
              stores: true
            }
          }
        }
      });

      // Format for backwards compatibility with UI if needed, or UI can adapt.
      const formatted = clients.map(client => ({
        id: client.id,
        nomeCompleto: client.nomeCompleto,
        nomeFantasia: client.nomeCompleto, // mapping for UI compatibility
        cnpjCpf: client.cnpjCpf,
        telefoneWhatsapp: client.telefoneWhatsapp,
        emailContato: client.email,
        status: client.status,
        createdAt: client.createdAt,
        subscriptions: client.subscriptions,
        users: client.clientUsers.map(cu => cu.user),
        controls: client.controls
      }));

      return res.json(formatted);
    } catch (error) {
      console.error('Erro ao buscar clientes:', error);
      return res.status(500).json({ error: 'Erro ao buscar dados dos clientes' });
    }
  }

  async getClientById(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const client = await prisma.client.findUnique({
        where: { id },
        include: {
          subscriptions: true,
          clientUsers: {
            include: { user: { select: { id: true, nome: true, email: true, ativo: true } } }
          },
          controls: {
            include: { stores: true }
          }
        }
      });

      if (!client) return res.status(404).json({ error: "Cliente não encontrado" });

      const formatted = {
        id: client.id,
        nomeCompleto: client.nomeCompleto,
        nomeFantasia: client.nomeCompleto,
        cnpjCpf: client.cnpjCpf,
        telefoneWhatsapp: client.telefoneWhatsapp,
        emailContato: client.email,
        status: client.status,
        createdAt: client.createdAt,
        subscriptions: client.subscriptions,
        users: client.clientUsers.map(cu => cu.user),
        controls: client.controls
      };

      return res.json(formatted);
    } catch (error) {
      console.error("Erro ao buscar cliente:", error);
      return res.status(500).json({ error: "Erro ao buscar dados do cliente" });
    }
  }

  // Cria um novo Cliente manualmente (que por tabela cria Control, Store e User)
  async createClient(req: Request, res: Response) {
    try {
      // RBAC já validado na rota

      const { 
        nomeFantasia, 
        cnpjCpf, 
        nichoPrincipal, 
        telefoneWhatsapp, 
        emailContato, 
        chavePix,
        nomeResponsavel,
        emailResponsavel,
        senhaResponsavel,
        plano,
        statusPagamento,
        planId: _planId,
        workspaceType,
        cep,
        logradouro,
        numero,
        complemento,
        bairro,
        cidade,
        uf
      } = req.body;

      const planId = req.body.planoId || _planId;

      if (!nomeFantasia || !emailResponsavel || !senhaResponsavel) {
        return res.status(400).json({ error: 'Campos obrigatórios: Nome da Loja, Email do Responsável e Senha Inicial' });
      }

      const existingUser = await prisma.user.findUnique({ where: { email: emailResponsavel } });
      if (existingUser) {
        return res.status(400).json({ error: 'E-mail do responsável já está em uso' });
      }

      const hashedPassword = await bcrypt.hash(senhaResponsavel, 10);
      const tipo = workspaceType || 'PJ';

      const transactionResult = await prisma.$transaction(async (tx) => {
        const newClient = await tx.client.create({
          data: {
            nomeCompleto: nomeFantasia,
            cnpjCpf: cnpjCpf || null,
            email: emailContato || emailResponsavel,
            telefoneWhatsapp,
            status: 'ATIVO',
            cep,
            logradouro,
            numero,
            complemento,
            bairro,
            cidade,
            uf
          }
        });

        const newControl = await tx.control.create({
          data: {
            clientId: newClient.id,
            nome: 'Varejo e Estoque',
            tipo
          }
        });

        const newStore = await tx.store.create({
          data: {
            controlId: newControl.id,
            nomeFantasia,
            cnpjCpf: cnpjCpf || null,
            nichoPrincipal,
            telefoneWhatsapp,
            emailContato,
            chavePix,
            status: 'ATIVO',
            tipoWorkspace: tipo
          }
        });

        const newUser = await tx.user.create({
          data: {
            email: emailResponsavel,
            senhaHash: hashedPassword,
            nome: nomeResponsavel || 'Admin',
            role: 'USER'
          }
        });

        await tx.clientUser.create({
          data: {
            clientId: newClient.id,
            userId: newUser.id,
            role: 'OWNER'
          }
        });

        await tx.storeUserAccess.create({
          data: {
            storeId: newStore.id,
            userId: newUser.id,
            role: 'GERENTE'
          }
        });

        let selectedPlan = planId
          ? await tx.plan.findUnique({ where: { id: planId } })
          : null;
        if (!selectedPlan) {
          selectedPlan = await tx.plan.findFirst({ orderBy: { precoMensal: 'asc' } });
        }
        if (!selectedPlan) {
          selectedPlan = await tx.plan.create({
            data: { nome: plano || 'Starter', precoMensal: 49, maxControls: 1, maxStores: 1 }
          });
        }

        const validade = new Date();
        validade.setMonth(validade.getMonth() + 1);

        const newSubscription = await tx.subscription.create({
          data: {
            clientId: newClient.id,
            planId: selectedPlan.id,
            valorMensalidade: Number(selectedPlan.precoMensal),
            dataVencimento: validade,
            statusPagamento: statusPagamento || 'PAGO'
          }
        });

        return { newClient, newStore, newUser, newSubscription };
      });

      // Enviar e-mail de boas-vindas com dados de acesso
      try {
        const { sendAccountApproved } = await import('../services/email.service');
        const { newClient, newUser } = transactionResult;
        await sendAccountApproved(newClient.email, newUser.nome, newUser.email);
      } catch (err) {
        console.error('Erro ao enviar email de boas-vindas (createClient):', err);
      }

      return res.status(201).json(transactionResult);
    } catch (error: any) {
      console.error('Erro ao criar cliente pelo super admin:', error.message, error.stack);
      return res.status(500).json({ error: 'Erro ao registrar cliente' });
    }
  }

  // Atualiza um Cliente
  async updateClient(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const { nomeFantasia, cnpjCpf, nichoPrincipal, telefoneWhatsapp, emailContato, chavePix, status, cep, logradouro, numero, complemento, bairro, cidade, uf, planId: _planId, statusPagamento, dataVencimento, workspaceType } = req.body;
      const planId = req.body.planoId || _planId;

      const updateData: Record<string, any> = {};
      if (nomeFantasia) updateData.nomeCompleto = nomeFantasia;
      if (cnpjCpf) updateData.cnpjCpf = cnpjCpf;
      if (telefoneWhatsapp) updateData.telefoneWhatsapp = telefoneWhatsapp;
      if (emailContato) updateData.email = emailContato;
      if (status) updateData.status = status;
      if (cep) updateData.cep = cep;
      if (logradouro) updateData.logradouro = logradouro;
      if (numero) updateData.numero = numero;
      if (complemento) updateData.complemento = complemento;
      if (bairro) updateData.bairro = bairro;
      if (cidade) updateData.cidade = cidade;
      if (uf) updateData.uf = uf;

      const updatedClient = await prisma.client.update({
        where: { id },
        data: updateData
      });

      if (planId || statusPagamento || dataVencimento) {
        const latestSub = await prisma.subscription.findFirst({
          where: { clientId: id },
          orderBy: { createdAt: 'desc' }
        });

        if (latestSub) {
          const updateData: any = {};
          if (planId) {
            const plan = await prisma.plan.findUnique({ where: { id: planId } });
            if (!plan) return res.status(404).json({ error: 'Plano não encontrado' });
            updateData.planId = planId;
            updateData.valorMensalidade = plan.precoMensal;
          }
          if (statusPagamento) {
            updateData.statusPagamento = statusPagamento;
          }
          if (dataVencimento) {
            updateData.dataVencimento = new Date(dataVencimento);
          }

          await prisma.subscription.update({
            where: { id: latestSub.id },
            data: updateData
          });
        }
      }

      // Auto-marca como INADIMPLENTE se a data de vencimento está no passado
      // (a menos que o admin tenha explicitamente definido como PAGO)
      if (statusPagamento !== 'PAGO') {
        const sub = await prisma.subscription.findFirst({
          where: { clientId: id },
          orderBy: { createdAt: 'desc' }
        });
        if (sub) {
          const hoje = new Date();
          hoje.setHours(0, 0, 0, 0);
          const venc = new Date(sub.dataVencimento);
          venc.setHours(0, 0, 0, 0);
          if (venc < hoje && sub.statusPagamento !== 'PAGO' && sub.statusPagamento !== 'INADIMPLENTE') {
            await prisma.subscription.update({
              where: { id: sub.id },
              data: { statusPagamento: 'INADIMPLENTE' }
            });
          }
        }
      }

      if (workspaceType && ['PF', 'PJ'].includes(workspaceType)) {
        await prisma.control.updateMany({
          where: { clientId: id },
          data: { tipo: workspaceType }
        });

        const clientControls = await prisma.control.findMany({
          where: { clientId: id },
          select: { id: true }
        });

        await prisma.store.updateMany({
          where: { controlId: { in: clientControls.map(c => c.id) } },
          data: { tipoWorkspace: workspaceType }
        });
      }

      return res.json(updatedClient);
    } catch (error) {
      console.error('Erro ao atualizar cliente:', error);
      return res.status(500).json({ error: 'Erro ao atualizar dados do cliente' });
    }
  }

  // Lista todos os usuários de um Cliente (owners + admins)
  async getClientUsers(req: Request, res: Response) {
    try {
      // RBAC já validado na rota

      const id = req.params.id as string; // clientId

      let clientUsers = await prisma.clientUser.findMany({
        where: { clientId: id },
        include: { user: { select: { id: true, nome: true, email: true, role: true, ativo: true } } }
      });

      let users = clientUsers.map(cu => ({
        ...cu.user,
        clientRole: cu.role
      }));

      // Fallback para sistemas antigos: se não achar ClientUser, tenta achar pela Store associada ao Control do Client
      if (users.length === 0) {
        const controls = await prisma.control.findMany({ where: { clientId: id }, select: { id: true } });
        const stores = await prisma.store.findMany({ where: { controlId: { in: controls.map(c => c.id) } }, select: { id: true } });
        
        if (stores.length > 0) {
          const storeUsers = await prisma.storeUserAccess.findMany({
            where: { storeId: { in: stores.map(s => s.id) } },
            include: { user: { select: { id: true, nome: true, email: true, role: true, ativo: true } } }
          });
          
          // Remove duplicados
          const uniqueUsers = Array.from(new Set(storeUsers.map(su => su.user.id)))
            .map(uid => storeUsers.find(su => su.user.id === uid)!);

          users = uniqueUsers.map(su => ({
            ...su.user,
            clientRole: su.role
          }));
        }
      }

      return res.json(users);
    } catch (error) {
      console.error('Erro ao listar usuários do cliente:', error);
      return res.status(500).json({ error: 'Erro ao listar funcionários' });
    }
  }

  // ==========================================
  // CONFIGURAÇÕES GLOBAIS (WHITE-LABEL)
  // ==========================================

  async getSystemSettings(req: Request, res: Response) {
    try {
      // RBAC já validado na rota
      
      const settings = await prisma.systemSetting.findMany();
      return res.json(settings);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar configurações' });
    }
  }

  async updateSystemSettings(req: Request, res: Response) {
    try {
      // RBAC já validado na rota
      
      const { settings } = req.body; 
      
      for (const s of settings) {
        await prisma.systemSetting.upsert({
          where: { chave: s.chave },
          update: { valor: s.valor, descricao: s.descricao },
          create: { chave: s.chave, valor: s.valor, descricao: s.descricao }
        });
      }
      
      return res.json({ message: 'Configurações atualizadas' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao salvar configurações' });
    }
  }

  // ==========================================
  // NOTIFICAÇÕES PUSH (Broadcast)
  // ==========================================

  async listNotifications(req: Request, res: Response) {
    try {
      const setting = await prisma.systemSetting.findUnique({ where: { chave: 'NOTIFICATIONS' } });
      const all = (setting?.valor as any[]) || [];
      const userId = req.user?.id;
      const notifications = all.map((n: any) => ({
        ...n,
        read: userId ? (n.readBy || []).includes(userId) : false,
      }));
      return res.json(notifications);
    } catch {
      return res.status(500).json({ error: 'Erro ao listar notificações' });
    }
  }

  async sendNotification(req: Request, res: Response) {
    try {
      const { title, message, type } = req.body;
      if (!title || !message) return res.status(400).json({ error: 'Título e mensagem obrigatórios' });

      const setting = await prisma.systemSetting.findUnique({ where: { chave: 'NOTIFICATIONS' } });
      const all: any[] = (setting?.valor as any[]) || [];

      const notification = {
        id: `notif_${Date.now()}`,
        title,
        message,
        type: type || 'info',
        createdAt: new Date().toISOString(),
        readBy: [],
      };

      all.unshift(notification);
      if (all.length > 100) all.length = 100;

      await prisma.systemSetting.upsert({
        where: { chave: 'NOTIFICATIONS' },
        update: { valor: all },
        create: { chave: 'NOTIFICATIONS', valor: all, descricao: 'Notificações do sistema' },
      });

      return res.status(201).json(notification);
    } catch {
      return res.status(500).json({ error: 'Erro ao enviar notificação' });
    }
  }

  async markNotificationRead(req: Request, res: Response) {
    try {
      const notifId = req.params.id;
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });

      const setting = await prisma.systemSetting.findUnique({ where: { chave: 'NOTIFICATIONS' } });
      const all: any[] = (setting?.valor as any[]) || [];

      const updated = all.map((n: any) => {
        if (n.id === notifId && !(n.readBy || []).includes(userId)) {
          return { ...n, readBy: [...(n.readBy || []), userId] };
        }
        return n;
      });

      await prisma.systemSetting.upsert({
        where: { chave: 'NOTIFICATIONS' },
        update: { valor: updated },
        create: { chave: 'NOTIFICATIONS', valor: updated, descricao: 'Notificações do sistema' },
      });

      return res.json({ message: 'Notificação marcada como lida' });
    } catch {
      return res.status(500).json({ error: 'Erro ao marcar notificação' });
    }
  }

  async markAllNotificationsRead(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });

      const setting = await prisma.systemSetting.findUnique({ where: { chave: 'NOTIFICATIONS' } });
      const all: any[] = (setting?.valor as any[]) || [];

      const updated = all.map((n: any) => {
        if (!(n.readBy || []).includes(userId)) {
          return { ...n, readBy: [...(n.readBy || []), userId] };
        }
        return n;
      });

      await prisma.systemSetting.upsert({
        where: { chave: 'NOTIFICATIONS' },
        update: { valor: updated },
        create: { chave: 'NOTIFICATIONS', valor: updated, descricao: 'Notificações do sistema' },
      });

      return res.json({ message: 'Todas marcadas como lidas' });
    } catch {
      return res.status(500).json({ error: 'Erro ao marcar notificações' });
    }
  }

  // ==========================================
  // EMAIL (test)
  // ==========================================

  async testEmail(req: Request, res: Response) {
    try {
      const { to, smtpConfig } = req.body;
      if (!to) return res.status(400).json({ error: 'Destinatário (to) obrigatório' });

      const { sendEmail } = await import('../services/email.service');
      await sendEmail(
        to,
        'Teste de Email - Lance Pelo Zap',
        `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#059669">Teste de Email</h2>
          <p>Se você está vendo esta mensagem, o SMTP está configurado corretamente!</p>
          <p style="color:#6b7280;font-size:12px">Enviado em ${new Date().toLocaleString('pt-BR')}</p>
        </div>`,
        smtpConfig
      );

      return res.json({ message: 'Email de teste enviado com sucesso!' });
    } catch (error: any) {
      return res.status(500).json({ error: `Falha ao enviar: ${error.message}` });
    }
  }

  // ==========================================
  // APROVAÇÃO DE CADASTROS
  // ==========================================

  async listPendingRegistrations(req: Request, res: Response) {
    try {
      const clients = await prisma.client.findMany({
        where: { status: 'PENDENTE' },
        include: {
          controls: { include: { stores: { take: 1 } } },
          clientUsers: { include: { user: { select: { id: true, nome: true, email: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const result = clients.map(c => ({
        id: c.id,
        nome: c.nomeCompleto,
        email: c.email,
        telefone: c.telefoneWhatsapp,
        createdAt: c.createdAt,
        user: c.clientUsers[0]?.user || null,
        store: c.controls[0]?.stores[0] || null,
      }));

      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao listar pendentes' });
    }
  }

  async approveRegistration(req: Request, res: Response) {
    try {
      const clientId = req.params.id as string;
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        include: { clientUsers: { include: { user: true } } },
      });
      if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

      await prisma.client.update({
        where: { id: clientId },
        data: { status: 'ATIVO' },
      });

      // Enviar email de aprovação com e-mail de acesso
      try {
        const { sendAccountApproved } = await import('../services/email.service');
        const userName = client.clientUsers[0]?.user?.nome || client.nomeCompleto;
        const userEmail = client.clientUsers[0]?.user?.email || client.email;
        await sendAccountApproved(client.email, userName, userEmail);
      } catch (err) {
        console.error('Erro ao enviar email de aprovação:', err);
      }

      return res.json({ message: 'Cliente aprovado com sucesso! E-mail enviado.' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao aprovar cliente' });
    }
  }

  async rejectRegistration(req: Request, res: Response) {
    try {
      const clientId = req.params.id as string;
      await prisma.client.update({
        where: { id: clientId },
        data: { status: 'INATIVO' },
      });
      return res.json({ message: 'Cliente rejeitado.' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao rejeitar cliente' });
    }
  }

  // ==========================================
  // RESET DE BANCO (Zerar Painel)
  // ==========================================

  async resetDatabase(req: Request, res: Response) {
    try {
      const { confirmacao } = req.body;
      if (confirmacao !== 'ZERAR TUDO') {
        return res.status(400).json({ error: 'Digite "ZERAR TUDO" para confirmar' });
      }

      // Tabelas que NÃO devem ser apagadas (dados de sistema)
      const protectedTables = [
        '_prisma_migrations', 'users', 'plans', 'internal_roles',
        'internal_role_permissions', 'system_settings',
      ];

      const allTables = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname='public' AND tablename != ALL(${protectedTables})
      `;

      for (const { tablename } of allTables) {
        try {
          await prisma.$executeRawUnsafe(`TRUNCATE TABLE "public"."${tablename}" CASCADE;`);
        } catch {
          // ignora erros de tabelas que não podem ser truncadas
        }
      }

      return res.json({
        message: 'Banco zerado com sucesso! Usuários, planos e permissões foram preservados.',
        tabelasPreservadas: protectedTables,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  // ==========================================
  // RELATÓRIOS FINANCEIROS SAAS
  // ==========================================

  async getFinancialReports(req: Request, res: Response) {
    try {
      const hoje = toZonedTime(new Date(), getTimezone());
      const meses: { label: string; inicio: Date; fim: Date }[] = [];

      for (let i = 11; i >= 0; i--) {
        const dt = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        const ano = dt.getFullYear();
        const mes = dt.getMonth() + 1;
        const inicioStr = `${ano}-${String(mes).padStart(2, '0')}-01T00:00:00.000`;
        const ultimoDia = new Date(ano, mes, 0).getDate();
        const fimStr = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}T23:59:59.999`;
        const mesesPt = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        meses.push({ label: `${mesesPt[dt.getMonth()]}/${String(ano).slice(2)}`, inicio: fromZonedTime(inicioStr, getTimezone()), fim: fromZonedTime(fimStr, getTimezone()) });
      }

      const receitaMensal: { mes: string; receita: number; novosClientes: number; churn: number }[] = [];
      let clientesAnterior = 0;

      for (const mes of meses) {
        const receita = await prisma.subscription.aggregate({
          _sum: { valorMensalidade: true },
          where: { statusPagamento: 'PAGO', createdAt: { lte: mes.fim } },
        });

        const novosClientes = await prisma.client.count({
          where: { createdAt: { gte: mes.inicio, lte: mes.fim } },
        });

        const totalClientesAteMes = await prisma.client.count({
          where: { createdAt: { lte: mes.fim } },
        });

        const churn = clientesAnterior > 0
          ? Math.round(((clientesAnterior - (totalClientesAteMes - novosClientes)) / clientesAnterior) * 10000) / 100
          : 0;

        clientesAnterior = totalClientesAteMes;

        receitaMensal.push({
          mes: mes.label,
          receita: Number(receita._sum.valorMensalidade || 0),
          novosClientes,
          churn: Math.max(0, churn),
        });
      }

      const planos = await prisma.plan.findMany({
        include: { _count: { select: { subscriptions: true } } },
      });

      const statusBreakdown = await prisma.subscription.groupBy({
        by: ['statusPagamento'],
        _count: { id: true },
        _sum: { valorMensalidade: true },
      });

      const totalPago = await prisma.invoice.aggregate({ _sum: { valorCobrado: true }, where: { status: 'PAGO' } });
      const totalPendente = await prisma.invoice.aggregate({ _sum: { valorCobrado: true }, where: { status: 'PENDENTE' } });

      return res.json({
        receitaMensal,
        planos: planos.map(p => ({
          nome: p.nome,
          precoMensal: Number(p.precoMensal),
          totalAssinantes: p._count.subscriptions,
        })),
        statusBreakdown: statusBreakdown.map(s => ({
          status: s.statusPagamento,
          quantidade: s._count.id,
          valor: Number(s._sum.valorMensalidade || 0),
        })),
        totalFaturado: Number(totalPago._sum.valorCobrado || 0),
        totalAReceber: Number(totalPendente._sum.valorCobrado || 0),
      });
    } catch (error) {
      console.error('Erro nos relatórios financeiros:', error);
      return res.status(500).json({ error: 'Erro ao gerar relatórios' });
    }
  }

  // ==========================================
  // INADIMPLENTES
  // ==========================================

  async listOverdue(req: Request, res: Response) {
    try {
      const overdueSubs = await prisma.subscription.findMany({
        where: { statusPagamento: { in: ['VENCIDO', 'PENDENTE'] } },
        include: {
          client: {
            include: {
              controls: {
                include: { stores: { take: 1 } }
              }
            }
          },
          plan: true,
          invoices: { orderBy: { mesReferencia: 'desc' }, take: 3 },
        },
        orderBy: { dataVencimento: 'asc' },
      });

      const hoje = new Date();
      const result = overdueSubs.map(sub => {
        const store = sub.client.controls?.[0]?.stores?.[0];
        const diasVencido = Math.floor((hoje.getTime() - new Date(sub.dataVencimento).getTime()) / 86400000);
        return {
          id: sub.id,
          clientId: sub.client.id,
          storeId: store?.id || null,
          clientName: sub.client.nomeCompleto,
          clientEmail: sub.client.email,
          clientPhone: sub.client.telefoneWhatsapp,
          storeName: store?.nomeFantasia || '-',
          planName: sub.plan?.nome || '-',
          valorMensalidade: Number(sub.valorMensalidade),
          statusPagamento: sub.statusPagamento,
          dataVencimento: sub.dataVencimento,
          diasVencido: Math.max(0, diasVencido),
          invoices: sub.invoices.map(i => ({
            mesReferencia: i.mesReferencia,
            valorCobrado: Number(i.valorCobrado),
            status: i.status,
          })),
        };
      });

      return res.json({
        total: result.length,
        totalDevido: result.reduce((acc, r) => acc + r.valorMensalidade, 0),
        inadimplentes: result,
      });
    } catch (error) {
      console.error('Erro ao listar inadimplentes:', error);
      return res.status(500).json({ error: 'Erro ao listar inadimplentes' });
    }
  }

  // ==========================================
  // GESTÃO DE USUÁRIOS E SENHAS
  // ==========================================

  async listAllUsers(req: Request, res: Response) {
    try {
      const users = await prisma.user.findMany({
        orderBy: { nome: 'asc' },
        select: {
          id: true, nome: true, email: true, role: true, ativo: true,
          createdAt: true,
          clientAccess: { select: { client: { select: { nomeCompleto: true } } } },
          storeAccess: { select: { store: { select: { nomeFantasia: true } }, role: true } },
        },
      });

      const result = users.map(u => ({
        id: u.id,
        nome: u.nome,
        email: u.email,
        role: u.role,
        ativo: u.ativo,
        createdAt: u.createdAt,
        clients: u.clientAccess.map(ca => ca.client.nomeCompleto),
        stores: u.storeAccess.map(sa => ({
          nome: sa.store.nomeFantasia,
          role: sa.role,
        })),
      }));

      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao listar usuários' });
    }
  }

  async resetUserPassword(req: Request, res: Response) {
    try {
      const userId = req.params.id as string;
      const { novaSenha } = req.body;

      if (!novaSenha || novaSenha.length < 6) {
        return res.status(400).json({ error: 'Nova senha deve ter no mínimo 6 caracteres' });
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

      const hashedPassword = await bcrypt.hash(novaSenha, 10);
      await prisma.user.update({
        where: { id: userId },
        data: { senhaHash: hashedPassword },
      });

      return res.json({ message: `Senha de ${user.nome} redefinida com sucesso` });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao redefinir senha' });
    }
  }

  async resetAllUserPasswords(req: Request, res: Response) {
    try {
      const { senhaPadrao } = req.body;
      const password = senhaPadrao || 'Senha@123';
      if (password.length < 8) {
        return res.status(400).json({ error: 'Senha deve ter no mínimo 8 caracteres' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const result = await prisma.user.updateMany({
        where: { role: { not: 'SUPER_ADMIN' } },
        data: { senhaHash: hashedPassword },
      });

      return res.json({
        message: `Senha de ${result.count} usuário(s) redefinida para "${password}"`,
        count: result.count,
      });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao redefinir senhas' });
    }
  }

  async updateUser(req: Request, res: Response) {
    try {
      const userId = req.params.id as string;
      const { nome, email, role, ativo } = req.body;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

      const data: any = {};
      if (nome !== undefined) data.nome = nome;
      if (email !== undefined) {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing && existing.id !== userId) {
          return res.status(400).json({ error: 'Este email já está em uso por outro usuário' });
        }
        data.email = email;
      }
      if (role !== undefined) data.role = role;
      if (ativo !== undefined) data.ativo = ativo;

      await prisma.user.update({
        where: { id: userId },
        data,
      });

      return res.json({ message: 'Usuário atualizado com sucesso' });
    } catch (error) {
      console.error('Erro ao atualizar usuário:', error);
      return res.status(500).json({ error: 'Erro ao atualizar usuário' });
    }
  }

  async deleteUser(req: Request, res: Response) {
    try {
      const userId = req.params.id as string;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

      if (user.role === 'SUPER_ADMIN') {
        return res.status(400).json({ error: 'Não é possível excluir um Super Admin' });
      }

      await prisma.user.delete({ where: { id: userId } });

      return res.json({ message: `Usuário ${user.nome} excluído com sucesso` });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao excluir usuário' });
    }
  }

  async deleteClient(req: Request, res: Response) {
    try {
      const clientId = req.params.id as string;
      const client = await prisma.client.findUnique({ where: { id: clientId } });
      if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

      await prisma.$transaction(async (tx) => {
        // Apagar dados associados
        const controls = await tx.control.findMany({ where: { clientId }, select: { id: true } });
        const storeIds = (await tx.store.findMany({ where: { controlId: { in: controls.map(c => c.id) } }, select: { id: true } })).map(s => s.id);

        await tx.sale.deleteMany({ where: { storeId: { in: storeIds } } });
        await tx.store.deleteMany({ where: { controlId: { in: controls.map(c => c.id) } } });
        await tx.control.deleteMany({ where: { clientId } });
        await tx.clientUser.deleteMany({ where: { clientId } });
        await tx.subscription.deleteMany({ where: { clientId } });
        await tx.invoice.deleteMany({ where: { subscription: { clientId } } });
        await tx.client.delete({ where: { id: clientId } });
      });

      return res.json({ message: 'Cliente e todos os dados associados foram excluídos.' });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Erro ao excluir cliente' });
    }
  }

  // ==========================================
  // GESTÃO DE ASSINATURAS
  // ==========================================

  async getClientInvoices(req: Request, res: Response) {
    try {
      const clientId = req.params.clientId as string;
      const subscription = await prisma.subscription.findFirst({ where: { clientId } });
      if (!subscription) return res.status(404).json({ error: 'Assinatura não encontrada' });

      const invoices = await prisma.invoice.findMany({
        where: { subscriptionId: subscription.id },
        orderBy: { mesReferencia: 'desc' },
      });

      return res.json({ subscription, invoices });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar faturas' });
    }
  }

  async cancelSubscription(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const subscription = await prisma.subscription.findUnique({ where: { id } });
      if (!subscription) return res.status(404).json({ error: 'Assinatura não encontrada' });

      await prisma.subscription.update({
        where: { id },
        data: { statusPagamento: 'CANCELADO', mpStatus: 'CANCELADO' },
      });

      return res.json({ message: 'Assinatura cancelada com sucesso' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao cancelar assinatura' });
    }
  }

  async changeSubscriptionPlan(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const { planId, valorMensalidade, dataVencimento } = req.body;

      const subscription = await prisma.subscription.findUnique({ where: { id } });
      if (!subscription) return res.status(404).json({ error: 'Assinatura não encontrada' });

      if (planId) {
        const plan = await prisma.plan.findUnique({ where: { id: planId } });
        if (!plan) return res.status(404).json({ error: 'Plano não encontrado' });
      }

      const updated = await prisma.subscription.update({
        where: { id },
        data: {
          ...(planId && { planId }),
          ...(valorMensalidade !== undefined && { valorMensalidade }),
          ...(dataVencimento && { dataVencimento: new Date(dataVencimento) }),
        },
      });

      // Auto-marca como INADIMPLENTE se a nova data está no passado
      if (updated.statusPagamento !== 'PAGO') {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const venc = new Date(updated.dataVencimento);
        venc.setHours(0, 0, 0, 0);
        if (venc < hoje && updated.statusPagamento !== 'INADIMPLENTE') {
          await prisma.subscription.update({
            where: { id: updated.id },
            data: { statusPagamento: 'INADIMPLENTE' }
          });
          updated.statusPagamento = 'INADIMPLENTE';
        }
      }

      return res.json(updated);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao alterar plano' });
    }
  }

  async generateInvoice(req: Request, res: Response) {
    try {
      const subscriptionId = req.params.id as string;
      const { mesReferencia, valorCobrado, dataVencimento } = req.body;

      if (!mesReferencia || !valorCobrado) {
        return res.status(400).json({ error: 'mesReferencia e valorCobrado obrigatórios' });
      }

      const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
      if (!subscription) return res.status(404).json({ error: 'Assinatura não encontrada' });

      const invoice = await prisma.invoice.create({
        data: {
          subscriptionId,
          mesReferencia,
          valorCobrado,
          status: 'PENDENTE',
          dataPagamento: dataVencimento ? new Date(dataVencimento) : null,
        },
      });

      return res.status(201).json(invoice);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao gerar fatura' });
    }
  }

  async payInvoice(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const invoice = await prisma.invoice.findUnique({ where: { id } });
      if (!invoice) return res.status(404).json({ error: 'Fatura não encontrada' });

      await prisma.invoice.update({
        where: { id },
        data: { status: 'PAGO', dataPagamento: new Date() },
      });

      return res.json({ message: 'Fatura marcada como paga' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao pagar fatura' });
    }
  }

  // ==========================================
  // LOGS DE AUDITORIA
  // ==========================================

  async getAuditLogs(req: Request, res: Response) {
    try {
      // RBAC já validado na rota
      
      const logs = await prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100, 
        include: { user: { select: { nome: true, email: true } }, store: { select: { nomeFantasia: true } } }
      });
      
      return res.json(logs);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar logs' });
    }
  }

  // ==========================================
  // MÉTRICAS DE USO (#3)
  // ==========================================

  async getUsageMetrics(req: Request, res: Response) {
    try {
      const clientId = req.params.clientId as string;
      const controls = await prisma.control.findMany({ where: { clientId }, select: { id: true } });
      const storeIds = (await prisma.store.findMany({ where: { controlId: { in: controls.map(c => c.id) } }, select: { id: true } })).map(s => s.id);

      const [productCount, customerCount, saleCount, userCount, storageUsed] = await Promise.all([
        prisma.product.count({ where: { storeId: { in: storeIds } } }),
        prisma.customer.count({ where: { storeId: { in: storeIds } } }),
        prisma.sale.count({ where: { storeId: { in: storeIds } } }),
        prisma.storeUserAccess.count({ where: { storeId: { in: storeIds } } }),
        prisma.auditLog.count({ where: { storeId: { in: storeIds } } }),
      ]);

      return res.json({
        clientId,
        lojas: storeIds.length,
        produtos: productCount,
        clientes: customerCount,
        vendas: saleCount,
        usuarios: userCount,
        registrosAuditoria: storageUsed,
      });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar métricas de uso' });
    }
  }

  // ==========================================
  // ANÚNCIOS IN-APP (#4)
  // ==========================================

  async listAnnouncements(req: Request, res: Response) {
    try {
      const settings = await prisma.systemSetting.findUnique({ where: { chave: 'ANNOUNCEMENTS' } });
      return res.json(settings?.valor || []);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao listar anúncios' });
    }
  }

  async saveAnnouncements(req: Request, res: Response) {
    try {
      const { announcements } = req.body;
      await prisma.systemSetting.upsert({
        where: { chave: 'ANNOUNCEMENTS' },
        update: { valor: announcements },
        create: { chave: 'ANNOUNCEMENTS', valor: announcements, descricao: 'Anúncios in-app para lojistas' },
      });
      return res.json({ message: 'Anúncios salvos' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao salvar anúncios' });
    }
  }

  // ==========================================
  // FEATURE FLAGS (#5)
  // ==========================================

  async getFeatureFlags(req: Request, res: Response) {
    try {
      const settings = await prisma.systemSetting.findUnique({ where: { chave: 'FEATURE_FLAGS' } });
      const clientOverrides = req.query.clientId
        ? await prisma.systemSetting.findUnique({ where: { chave: `FEATURE_FLAGS_${req.query.clientId}` } })
        : null;
      return res.json({
        global: settings?.valor || {},
        clientOverride: clientOverrides?.valor || null,
      });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar feature flags' });
    }
  }

  async saveFeatureFlags(req: Request, res: Response) {
    try {
      const { flags, clientId } = req.body;
      const chave = clientId ? `FEATURE_FLAGS_${clientId}` : 'FEATURE_FLAGS';
      await prisma.systemSetting.upsert({
        where: { chave },
        update: { valor: flags },
        create: { chave, valor: flags, descricao: clientId ? `Feature flags para cliente ${clientId}` : 'Feature flags globais' },
      });
      return res.json({ message: 'Feature flags salvas' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao salvar feature flags' });
    }
  }

  // ==========================================
  // BACKUP (#6)
  // ==========================================

  async listBackups(req: Request, res: Response) {
    try {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsDir)) return res.json([]);
      const files = fs.readdirSync(uploadsDir)
        .filter((f: string) => f.endsWith('.sql') || f.endsWith('.sql.gz'))
        .map((f: string) => {
          const stat = fs.statSync(path.join(uploadsDir, f));
          return { name: f, size: stat.size, createdAt: (stat.birthtime || stat.mtime || new Date()).toISOString() };
        })
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return res.json(files);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao listar backups' });
    }
  }

  async triggerBackup(req: Request, res: Response) {
    try {
      const backupFile = `backup-${Date.now()}.sql`;
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) return res.status(500).json({ error: 'DATABASE_URL não configurada' });
      const cmd = `pg_dump "${dbUrl}" > uploads/${backupFile}`;
      exec(cmd, (error: any) => {
        if (error) return res.status(500).json({ error: 'Falha ao executar backup' });
        return res.json({ message: 'Backup concluído', file: backupFile });
      });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao iniciar backup' });
    }
  }

  async downloadBackup(req: Request, res: Response) {
    try {
      const fileName = req.params.file as string;
      const filePath = path.join(process.cwd(), 'uploads', fileName);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado' });
      return res.download(filePath);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao baixar backup' });
    }
  }

  async deleteBackup(req: Request, res: Response) {
    try {
      const fileName = req.params.file as string;
      const filePath = path.join(process.cwd(), 'uploads', fileName);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado' });
      fs.unlinkSync(filePath);
      return res.json({ message: 'Backup excluído' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao excluir backup' });
    }
  }

  // ==========================================
  // MODO MANUTENÇÃO (#7)
  // ==========================================

  async getMaintenanceMode(req: Request, res: Response) {
    try {
      const settings = await prisma.systemSetting.findUnique({ where: { chave: 'MAINTENANCE_MODE' } });
      return res.json(settings?.valor || { enabled: false, message: '' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar modo manutenção' });
    }
  }

  async setMaintenanceMode(req: Request, res: Response) {
    try {
      const { enabled, message } = req.body;
      await prisma.systemSetting.upsert({
        where: { chave: 'MAINTENANCE_MODE' },
        update: { valor: { enabled, message: message || 'Sistema em manutenção. Voltaremos em breve!' } },
        create: { chave: 'MAINTENANCE_MODE', valor: { enabled, message: message || 'Sistema em manutenção. Voltaremos em breve!' }, descricao: 'Modo manutenção do sistema' },
      });
      return res.json({ message: enabled ? 'Modo manutenção ativado' : 'Modo manutenção desativado' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao alterar modo manutenção' });
    }
  }

  // ==========================================
  // API KEYS (#8)
  // ==========================================

  async listApiKeys(req: Request, res: Response) {
    try {
      const settings = await prisma.systemSetting.findUnique({ where: { chave: 'API_KEYS' } });
      return res.json(settings?.valor || []);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao listar API Keys' });
    }
  }

  async saveApiKeys(req: Request, res: Response) {
    try {
      const { apiKeys } = req.body;
      await prisma.systemSetting.upsert({
        where: { chave: 'API_KEYS' },
        update: { valor: apiKeys },
        create: { chave: 'API_KEYS', valor: apiKeys, descricao: 'Chaves de API para integrações' },
      });
      return res.json({ message: 'API Keys salvas' });
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao salvar API Keys' });
    }
  }

  // ==========================================
  // LOGS DO SERVIDOR (#9) — Últimas N linhas
  // ==========================================

  async getSystemStatus(req: Request, res: Response) {
    try {
      const os = await import('os');
      const { execSync } = await import('child_process');

      const uptime = os.uptime();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const cpus = os.cpus().length;
      const loadAvg = os.loadavg();

      let diskFree = 0;
      let diskTotal = 0;
      try {
        const df = execSync('df -k / | tail -1').toString().trim().split(/\s+/);
        diskTotal = parseInt(df[1]) * 1024 || 0;
        diskFree = parseInt(df[3]) * 1024 || 0;
      } catch {}

      // DB connection test
      let dbConnected = false;
      let dbSize = 0;
      try {
        await prisma.$queryRaw`SELECT 1`;
        dbConnected = true;
        const sizeResult = await prisma.$queryRaw<{ size: string }[]>`SELECT pg_database_size(current_database())::text as size`;
        dbSize = parseInt(sizeResult[0]?.size || '0');
      } catch {}

      const storeCount = await prisma.store.count();
      const clientCount = await prisma.client.count();
      const userCount = await prisma.user.count();
      const pendingSales = await prisma.sale.count({ where: { status: 'PENDENTE' } });
      const pendingQueue = await prisma.sale.count({ where: { status: 'PENDENTE' } });

      const lastBackup = fs.existsSync(path.join(process.cwd(), 'uploads'))
        ? fs.readdirSync(path.join(process.cwd(), 'uploads'))
            .filter((f: string) => f.endsWith('.sql') || f.endsWith('.sql.gz'))
            .sort()
            .pop() || null
        : null;

      return res.json({
        status: dbConnected ? 'healthy' : 'degraded',
        uptime: Math.floor(uptime),
        uptimeHuman: `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
        memory: {
          total: totalMem,
          free: freeMem,
          used: totalMem - freeMem,
          usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
        },
        cpu: {
          cores: cpus,
          load1m: loadAvg[0],
          load5m: loadAvg[1],
          load15m: loadAvg[2],
        },
        disk: {
          total: diskTotal,
          free: diskFree,
          used: diskTotal - diskFree,
          usagePercent: diskTotal > 0 ? Math.round(((diskTotal - diskFree) / diskTotal) * 100) : 0,
        },
        database: {
          connected: dbConnected,
          size: dbSize,
          stores: storeCount,
          clients: clientCount,
          users: userCount,
        },
        queue: {
          pendingSales,
          pendingQueue,
        },
        lastBackup,
        nodeVersion: process.version,
        platform: process.platform,
        env: process.env.NODE_ENV || 'development',
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  }

  async getServerLogs(req: Request, res: Response) {
    try {
      const lines = Number(req.query.lines) || 100;
      const logFiles = ['/tmp/backend.log', path.join(process.cwd(), 'imports.log')];
      const logs: { file: string; lines: string[] }[] = [];

      for (const logFile of logFiles) {
        if (fs.existsSync(logFile)) {
          const content = fs.readFileSync(logFile, 'utf8');
          const logLines = content.split('\n').filter(Boolean).slice(-lines);
          logs.push({ file: path.basename(logFile), lines: logLines });
        }
      }
      return res.json(logs);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao buscar logs' });
    }
  }

  // ==========================================
  // IMPERSONATION (God Mode)
  // ==========================================

  // Entra no painel da loja selecionada (Impersonate)
  async impersonate(req: Request, res: Response) {
    try {
      const storeId = req.params.storeId as string;
      const store = await prisma.store.findUnique({ where: { id: storeId } });
      if (!store) return res.status(404).json({ error: 'Loja não encontrada' });

      const control = await prisma.control.findUnique({ where: { id: store.controlId } });

      const storeAdmin = await prisma.storeUserAccess.findFirst({
        where: { storeId, role: 'ADMIN_LOJA' },
        include: { user: { select: { role: true } } }
      });

      const targetRole = storeAdmin?.user?.role || 'USER';


      const storeOwner = await prisma.storeUserAccess.findFirst({
        where: { storeId },
        orderBy: { createdAt: "asc" },
        select: { userId: true }
      });
      const targetUserId = storeOwner?.userId || null;
      const JWT_SECRET = process.env.JWT_SECRET;
      if (!JWT_SECRET) return res.status(500).json({ error: 'JWT_SECRET ausente' });

      const token = jwt.sign(
        {
          id: req.user.id,
          storeId: storeId,
          allowedStoreIds: [storeId],
          clientId: control?.clientId || null,
          role: targetRole,
          isImpersonating: true,
          impersonatorId: req.user.id,
          targetUserId: targetUserId,
          originalUserId: req.user.id,
          originalStoreId: req.user.storeId || null,
          originalClientId: req.user.clientId || null
        },
        JWT_SECRET,
        { expiresIn: "1d" }
      );

      res.clearCookie('adminToken', { path: '/' });

      res.cookie("authToken", token, {
        httpOnly: true,
        path: '/',
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000,
      });

      return res.json({ message: "Login na loja efetuado com sucesso" });
    } catch (error: any) {
      console.error('Erro ao acessar painel da loja:', error.message, error.stack);
      return res.status(500).json({ error: "Erro ao acessar painel da loja" });
    }
  }

  // Volta para a sessão normal de Super Admin
  async revertImpersonation(req: Request, res: Response) {
    try {
      if (!req.user?.isImpersonating) {
        return res.status(400).json({ error: 'Você não está em modo de acesso a cliente' });
      }

      const originalUser = await prisma.user.findUnique({ 
        where: { id: req.user.originalUserId },
        include: {
          clientAccess: true,
          storeAccess: true
        }
      });

      if (!originalUser) return res.status(404).json({ error: 'Usuário original não encontrado' });

      const JWT_SECRET = process.env.JWT_SECRET;
      if (!JWT_SECRET) return res.status(500).json({ error: 'JWT_SECRET ausente' });

      const storeId = originalUser.storeAccess?.[0]?.storeId || null;
      const clientId = originalUser.clientAccess?.[0]?.clientId || null;

      const token = jwt.sign(
        { 
          id: originalUser.id, 
          storeId,
          clientId,
          role: originalUser.role 
        },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      res.clearCookie('authToken', { path: '/' });

      const cookieName = originalUser.role === 'SUPER_ADMIN' ? 'adminToken' : 'authToken';
      res.cookie(cookieName, token, {
        httpOnly: true,
        path: '/',
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return res.json({ message: "Sessão de Super Admin restaurada com sucesso" });
    } catch (error) {
      console.error('Erro ao reverter sessão:', error);
      return res.status(500).json({ error: "Erro ao reverter sessão" });
    }
  }

  // ==========================================
  // ADD-ON PF: Criar Control PF para cliente PJ
  // ==========================================
  async addPfControl(req: Request, res: Response) {
    try {
      const clientId = req.params.clientId as string;

      const client = await prisma.client.findUnique({
        where: { id: clientId },
        include: {
          controls: {
            where: { tipo: 'PF' },
            select: { id: true }
          }
        }
      });

      if (!client) {
        return res.status(404).json({ error: 'Cliente não encontrado' });
      }

      if (client.controls.length > 0) {
        return res.status(409).json({ error: 'Cliente já possui um controle PF. Limite de 1 por cliente.' });
      }

      const result = await prisma.$transaction(async (tx) => {
        const control = await tx.control.create({
          data: {
            clientId,
            nome: `${client.nomeCompleto} - Finanças Pessoais`,
            tipo: 'PF',
            status: 'ATIVO'
          }
        });

        const store = await tx.store.create({
          data: {
            controlId: control.id,
            nomeFantasia: `${client.nomeCompleto} - PF`,
            tipoWorkspace: 'PF',
            status: 'ATIVO',
            cnpjCpf: client.cnpjCpf,
            emailContato: client.email,
            telefoneWhatsapp: client.telefoneWhatsapp
          }
        });

        await tx.wallet.create({
          data: {
            storeId: store.id,
            nome: 'Carteira PF',
            tipo: 'PESSOAL',
            saldoAtual: 0
          }
        });

        return { control, store };
      });

      return res.status(201).json({
        message: 'Controle PF criado com sucesso',
        control: { id: result.control.id, nome: result.control.nome, tipo: result.control.tipo },
        store: { id: result.store.id, nome: result.store.nomeFantasia }
      });
    } catch (error: any) {
      console.error('Erro ao criar controle PF:', error.message, error.stack);
      return res.status(500).json({ error: 'Erro ao criar controle PF' });
    }
  }

  async updateStoreFeatures(req: Request, res: Response) {
    try {
      const storeId = req.params.id as string;

      const store = await prisma.store.findUnique({ where: { id: storeId } });
      if (!store) return res.status(404).json({ error: 'Loja não encontrada' });

      if (req.method === 'GET') {
        const features = store.features ? JSON.parse(store.features) : {};
        return res.json({ features });
      }

      const { features } = req.body;

      const updated = await prisma.store.update({
        where: { id: storeId },
        data: { features: features ? JSON.stringify(features) : null },
      });

      return res.json({ message: 'Features atualizadas', features: features || {} });
    } catch (error) {
      console.error('Erro ao atualizar features da loja:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  async triggerBilling(req: Request, res: Response) {
    try {
      const hoje = new Date();

      const vencidas = await prisma.subscription.findMany({
        where: {
          dataVencimento: { lt: hoje },
          statusPagamento: { notIn: ['PAGO', 'CANCELADO'] },
        },
        include: { client: { select: { nomeCompleto: true } } },
      });

      let atualizadas = 0;
      for (const sub of vencidas) {
        if (sub.statusPagamento !== 'VENCIDO') {
          await prisma.subscription.update({
            where: { id: sub.id },
            data: { statusPagamento: 'VENCIDO' },
          });
          atualizadas++;
        }
      }

      return res.json({
        message: `Varredura concluída. ${vencidas.length} assinatura(s) vencida(s) encontrada(s), ${atualizadas} atualizada(s) para VENCIDO.`,
        total: vencidas.length,
        atualizadas,
      });
    } catch (error) {
      console.error('Erro na varredura financeira:', error);
      return res.status(500).json({ error: 'Erro ao executar varredura financeira' });
    }
  }
}
