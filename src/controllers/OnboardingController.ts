import { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { hashPassword } from "../utils/password";
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { generateToken, sha256Hex } from '../utils/tokens';
import { asyncHandler } from '../lib/asyncHandler';

export const registerTenant = asyncHandler(async (req: Request, res: Response) => {
  const GENERIC_SUCCESS = {
    message: 'Cadastro realizado com sucesso! Sua solicitação será analisada pelo administrador.',
    pending: true
  };

  const { nomeFantasia, telefoneWhatsapp, nomeResponsavel, email, senha, planId } = req.body;

  if (!nomeFantasia || !email || !senha) {
    res.status(400).json({ error: 'Campos obrigatórios: Nome da Loja, Email e Senha' });
    return;
  }

  // 1. Anti-enumeração: e-mail já cadastrado responde IGUAL ao sucesso
  //    (mesmo status, mesmo corpo — não revela que o e-mail existe)
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    res.status(201).json(GENERIC_SUCCESS);
    return;
  }

  // Hash da senha (Bcrypt cost 12 via util central)
  const hashedPassword = await hashPassword(senha);

  // Token de verificação de e-mail (cru vai no link; hash fica no banco)
  const emailVerifyToken = generateToken(32);

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
        // Cadastro self-service: exige confirmação de e-mail antes de usar a conta
        emailVerificationRequired: true,
        emailVerifyToken: sha256Hex(emailVerifyToken),
        emailVerifyTokenExpires: new Date(Date.now() + 48 * 60 * 60 * 1000),
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
    logger.error('Erro ao notificar admin:', err);
  }

  // Enviar e-mail de verificação ao usuário (fire-and-forget — o cadastro
  // não falha por problema de SMTP; o usuário pode reenviar depois)
  try {
    const { sendVerificationEmail } = await import('../services/email.service');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const verifyLink = `${frontendUrl}/verificar-email?token=${emailVerifyToken}`;
    await sendVerificationEmail(email, verifyLink);
  } catch (err) {
    logger.error('Erro ao enviar e-mail de verificação:', err);
  }

  // 4. Retornar sucesso (sem auto-login — aguarda aprovação do admin)
  // ⚠️ NENHUM e-mail de boas-vindas é enviado ao cliente aqui. O e-mail de
  //    boas-vindas com link de acesso é disparado APENAS na aprovação pelo
  //    Super Admin.
  res.status(201).json(GENERIC_SUCCESS);
}, "registro do tenant");
