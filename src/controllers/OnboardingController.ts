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

    // 2. Criar Client -> Control -> Store -> Users -> Subscription
    const transactionResult = await prisma.$transaction(async (tx) => {
      // 2.1 Criar Client (status PENDENTE = aguardando aprovação)
      const newClient = await tx.client.create({
        data: {
          nomeCompleto: nomeFantasia,
          telefoneWhatsapp: telefoneWhatsapp || null,
          email: email,
          status: 'PENDENTE'
        },
      });

      // 2.2 Criar Control
      const newControl = await tx.control.create({
        data: {
          clientId: newClient.id,
          nome: 'Varejo',
          tipo: 'PJ'
        }
      });

      // 2.3 Criar Store
      const newStore = await tx.store.create({
        data: {
          controlId: newControl.id,
          nomeFantasia,
          telefoneWhatsapp: telefoneWhatsapp || null,
          emailContato: email,
          status: 'ATIVO'
        },
      });

      // 2.4 Criar User Global
      const newUser = await tx.user.create({
        data: {
          email,
          senhaHash: hashedPassword,
          nome: nomeResponsavel || 'Dono da Loja',
          role: 'USER',
        },
      });

      // 2.5 Criar acessos
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

      // 2.5b Criar carteira padrão
      await tx.wallet.create({
        data: { storeId: newStore.id, nome: 'Caixa Interno', tipo: 'EMPRESA', saldoAtual: 0 }
      });

      // 2.6 Usar o plano escolhido (ou o primeiro como fallback)
      let selectedPlan = planId
        ? await tx.plan.findUnique({ where: { id: planId } })
        : null;
      if (!selectedPlan) {
        selectedPlan = await tx.plan.findFirst({ orderBy: { precoMensal: 'asc' } });
      }
      if (!selectedPlan) {
        selectedPlan = await tx.plan.create({
          data: {
            nome: 'Plano Pro (Trial)',
            precoMensal: 0,
            maxControls: 1,
            maxStores: 1,
          }
        });
      }

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

    // 3. Enviar email de confirmação
    try {
      const { sendPendingApproval } = await import('../services/email.service');
      await sendPendingApproval(email, nomeResponsavel || nomeFantasia);
    } catch (err) {
      console.error('Erro ao enviar email de confirmação:', err);
    }

    // 4. Notificar admin sobre novo cadastro
    try {
      const { sendNewTicketNotification } = await import('../services/email.service');
      await sendNewTicketNotification(nomeFantasia, 'Novo cadastro aguardando aprovação', '');
    } catch (err) {
      console.error('Erro ao notificar admin:', err);
    }

    // 5. Retornar sucesso (sem auto-login — aguarda aprovação do admin)
    res.status(201).json({
      message: 'Cadastro realizado com sucesso! Sua solicitação será analisada pelo administrador.',
      pending: true
    });
  } catch (error) {
    console.error('Erro no registro do tenant:', error);
    res.status(500).json({ error: 'Erro interno ao registrar loja' });
  }
};
