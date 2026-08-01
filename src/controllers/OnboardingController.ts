import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

export const registerTenant = async (req: Request, res: Response): Promise<void> => {
  try {
    const { nomeFantasia, telefoneWhatsapp, nomeResponsavel, email, senha, planId } = req.body;

    if (!nomeFantasia || !email || !senha) {
      res.status(400).json({ error: 'Campos obrigatórios: Nome da Loja, Email e Senha' });
      return;
    }

    // 1. Verificar se o e-mail já existe (como usuário)
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(400).json({ error: 'E-mail já está em uso' });
      return;
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(senha, 10);

    // 2. Resolver plano e workspaceType antes da transação
    let selectedPlan = planId
      ? await prisma.plan.findUnique({ where: { id: planId } })
      : null;
    if (!selectedPlan) {
      selectedPlan = await prisma.plan.findFirst({ orderBy: { precoMensal: 'asc' } });
    }
    if (!selectedPlan) {
      selectedPlan = await prisma.plan.create({
        data: { nome: 'Plano Pro (Trial)', precoMensal: 0, maxControls: 1, maxStores: 1 }
      });
    }

    const workspaceType = req.body.workspaceType || (selectedPlan.nome.includes("PF") ? "PF" : "PJ");

    // 3. Criar Client -> Control -> Store -> Users -> Subscription
    const transactionResult = await prisma.$transaction(async (tx) => {
      const newClient = await tx.client.create({
        data: {
          nomeCompleto: nomeFantasia,
          telefoneWhatsapp: telefoneWhatsapp || null,
          email: email,
          status: 'PENDENTE'
        },
      });

      const newControl = await tx.control.create({
        data: {
          clientId: newClient.id,
          nome: workspaceType === 'PF' ? 'Finanças Pessoais' : 'Varejo',
          tipo: workspaceType
        }
      });

      const newStore = await tx.store.create({
        data: {
          controlId: newControl.id,
          nomeFantasia,
          telefoneWhatsapp: telefoneWhatsapp || null,
          emailContato: email,
          status: 'ATIVO',
          tipoWorkspace: workspaceType
        },
      });

      const newUser = await tx.user.create({
        data: {
          email,
          senhaHash: hashedPassword,
          nome: nomeResponsavel || 'Dono da Loja',
          role: 'USER',
        },
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

      await tx.wallet.create({
        data: { storeId: newStore.id, nome: 'Caixa Interno', tipo: workspaceType === 'PF' ? 'PESSOAL' : 'EMPRESA', saldoAtual: 0 }
      });

      const validade = new Date();
      validade.setDate(validade.getDate() + 7);

      const newSubscription = await tx.subscription.create({
        data: {
          clientId: newClient.id,
          planId: selectedPlan.id,
          valorMensalidade: Number(selectedPlan.precoMensal),
          statusPagamento: 'TRIAL',
          dataVencimento: validade,
        },
      });

      return { newClient, newStore, newUser, newSubscription };
    });

    // 3. Notificar admin sobre novo cadastro (interno, não envia e-mail ao cliente)
    try {
      const { sendNewTicketNotification } = await import('../services/email.service');
      await sendNewTicketNotification(nomeFantasia, 'Novo cadastro aguardando aprovação', '');
    } catch (err) {
      console.error('Erro ao notificar admin:', err);
    }

    // 4. Retornar sucesso (sem auto-login — aguarda aprovação do admin)
    // ⚠️ NENHUM e-mail é enviado ao cliente aqui. O e-mail de boas-vindas
    //    com link de acesso é disparado APENAS na aprovação pelo Super Admin.
    res.status(201).json({
      message: 'Cadastro realizado com sucesso! Sua solicitação será analisada pelo administrador.',
      pending: true
    });
  } catch (error) {
    console.error('Erro no registro do tenant:', error);
    res.status(500).json({ error: 'Erro interno ao registrar loja' });
  }
};
