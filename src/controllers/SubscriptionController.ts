import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import { asyncHandler } from '../lib/asyncHandler';
import path from 'path';
import fs from 'fs';

// Chave da configuração de pagamento Pix manual (SystemSetting)
export const PIX_SUBSCRIPTION_CONFIG_KEY = 'PIX_SUBSCRIPTION_CONFIG';

// Extensões permitidas para comprovante (validado também por magic bytes)
export const PIX_PROOF_ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.pdf'];

/**
 * Resolve o clientId do usuário autenticado, com fallback pelo storeId
 * (mesma lógica do checkActiveSubscription do middleware de auth).
 */
async function resolveClientId(req: Request): Promise<string | null> {
  const user = req.user as any;
  if (user?.clientId) return user.clientId as string;

  const storeId = user?.storeId as string | undefined;
  if (!storeId) return null;

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: { control: { select: { clientId: true } } },
  });
  return store?.control?.clientId || null;
}

/** Recupera a configuração oficial de Pix da empresa (chave, beneficiário, WhatsApp). */
export async function getPixSubscriptionConfig(): Promise<{
  chavePix: string;
  beneficiario: string;
  whatsappSuporte: string;
} | null> {
  const setting = await prisma.systemSetting.findUnique({ where: { chave: PIX_SUBSCRIPTION_CONFIG_KEY } });
  const raw = setting?.valor as { chavePix?: unknown; beneficiario?: unknown; whatsappSuporte?: unknown } | null;
  if (!raw || typeof raw.chavePix !== 'string' || !raw.chavePix.trim()) return null;
  return {
    chavePix: raw.chavePix.trim(),
    beneficiario: typeof raw.beneficiario === 'string' ? raw.beneficiario.trim() : '',
    whatsappSuporte: typeof raw.whatsappSuporte === 'string' ? raw.whatsappSuporte.trim() : '',
  };
}

export class SubscriptionController {

  // Dados públicos de pagamento Pix manual (chave + valor do plano do usuário)
  static getPixConfig = asyncHandler(async (req: Request, res: Response) => {
    const clientId = await resolveClientId(req);
    if (!clientId) return res.status(403).json({ error: 'Conta sem cliente vinculado' });

    const config = await getPixSubscriptionConfig();
    if (!config) {
      return res.status(503).json({ error: 'Pagamento Pix ainda não configurado. Contate o suporte.' });
    }

    const subscription = await prisma.subscription.findFirst({
      where: { clientId, statusPagamento: { in: ['PAGO', 'PENDENTE', 'TRIAL', 'VENCIDO', 'INADIMPLENTE'] } },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    if (!subscription) return res.status(404).json({ error: 'Nenhuma assinatura encontrada para este cliente.' });

    return res.status(200).json({
      chavePix: config.chavePix,
      beneficiario: config.beneficiario,
      whatsappSuporte: config.whatsappSuporte,
      valor: Number(subscription.valorMensalidade),
      plano: subscription.plan?.nome || 'Desconhecido',
      subscriptionId: subscription.id,
      dataVencimento: subscription.dataVencimento,
    });
  }, "buscar config pix");

  // Envio de comprovante/ID de transação Pix manual.
  // O status da assinatura NUNCA é alterado aqui — apenas cria um registro
  // AGUARDANDO_VALIDACAO para análise da equipe administrativa.
  static submitPaymentProof = asyncHandler(async (req: Request, res: Response) => {
    const clientId = await resolveClientId(req);
    if (!clientId) return res.status(403).json({ error: 'Conta sem cliente vinculado' });

    const transactionId = typeof req.body?.transactionId === 'string'
      ? req.body.transactionId.trim().slice(0, 80)
      : '';
    const file = req.file;

    if (!transactionId && !file) {
      return res.status(400).json({ error: 'Informe o ID da transação Pix (End-to-End) ou anexe o comprovante.' });
    }

    // E2E ID do Pix: alfanumérico (com hífen opcional), entre 10 e 80 chars.
    if (transactionId && !/^[A-Za-z0-9\-]{10,80}$/.test(transactionId)) {
      return res.status(400).json({ error: 'ID de transação Pix inválido. Verifique o End-to-End ID copiado do app do banco.' });
    }

    // Valor e assinatura derivados SEMPRE do servidor (nunca do body)
    const subscription = await prisma.subscription.findFirst({
      where: { clientId, statusPagamento: { in: ['PAGO', 'PENDENTE', 'TRIAL', 'VENCIDO', 'INADIMPLENTE'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) {
      if (file) fs.unlink(file.path, () => {});
      return res.status(404).json({ error: 'Nenhuma assinatura encontrada para este cliente.' });
    }

    // Idempotência: mesmo End-to-End ID não pode gerar duas solicitações
    if (transactionId) {
      const duplicado = await prisma.paymentReceipt.findFirst({
        where: { transactionId: { equals: transactionId, mode: 'insensitive' } },
      });
      if (duplicado) {
        if (file) fs.unlink(file.path, () => {});
        return res.status(409).json({
          error: duplicado.status === 'AGUARDANDO_VALIDACAO'
            ? 'Este ID de transação já foi enviado e está aguardando validação.'
            : 'Este ID de transação já foi processado pela equipe.',
        });
      }
    }

    const receipt = await prisma.paymentReceipt.create({
      data: {
        clientId,
        subscriptionId: subscription.id,
        transactionId: transactionId || null,
        valorDeclarado: subscription.valorMensalidade,
        arquivoPath: file ? `/uploads/pix-proofs/${file.filename}` : null,
        arquivoOriginal: file ? file.originalname.slice(0, 200) : null,
      },
    });

    return res.status(201).json({
      message: 'Comprovante enviado! Nossa equipe vai validar o pagamento e liberar o acesso em até 24h úteis.',
      receipt: {
        id: receipt.id,
        status: receipt.status,
        valorDeclarado: Number(receipt.valorDeclarado),
        createdAt: receipt.createdAt,
      },
    });
  }, "enviar comprovante pix");

  // Histórico de comprovantes do lojista atual
  static getMyPaymentProofs = asyncHandler(async (req: Request, res: Response) => {
    const clientId = await resolveClientId(req);
    if (!clientId) return res.status(200).json([]);

    const receipts = await prisma.paymentReceipt.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return res.status(200).json(receipts.map(r => ({
      id: r.id,
      status: r.status,
      valorDeclarado: Number(r.valorDeclarado),
      transactionId: r.transactionId,
      arquivoOriginal: r.arquivoOriginal,
      motivoRejeicao: r.motivoRejeicao,
      createdAt: r.createdAt,
    })));
  }, "listar comprovantes do tenant");

  // Servir o arquivo do comprovante — apenas o dono ou equipe administrativa.
  // Nunca expõe o caminho real: resolve pelo ID e valida contra path traversal.
  static getPaymentProofFile = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const user = req.user as any;

    const receipt = await prisma.paymentReceipt.findUnique({ where: { id } });
    if (!receipt || !receipt.arquivoPath) return res.status(404).json({ error: 'Comprovante não encontrado' });

    // Autorização: dono do comprovante OU admin/equipe interna
    const clientId = await resolveClientId(req);
    const isAdmin = user?.role === 'SUPER_ADMIN' || !!user?.internalRoleId;
    if (!isAdmin && clientId !== receipt.clientId) {
      return res.status(403).json({ error: 'Acesso negado a este comprovante.' });
    }

    // Anti path traversal: o caminho é gerado pelo servidor no upload e o
    // nome final precisa casar com o padrão estrito (defesa em profundidade).
    const pathMatch = receipt.arquivoPath.match(/^\/uploads\/pix-proofs\/([A-Za-z0-9_.-]{1,160})$/);
    if (!pathMatch) {
      return res.status(400).json({ error: 'Arquivo inválido.' });
    }
    const fileName = pathMatch[1];

    const ext = path.extname(fileName).toLowerCase();
    if (!PIX_PROOF_ALLOWED_EXTS.includes(ext)) {
      return res.status(400).json({ error: 'Tipo de arquivo não permitido.' });
    }

    const fullPath = path.join(process.cwd(), 'uploads', 'pix-proofs', fileName);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Arquivo não encontrado' });

    const contentType = ext === '.pdf' ? 'application/pdf' : 'image/jpeg';
    res.setHeader('Content-Type', ext === '.png' ? 'image/png' : contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(fullPath);
  }, "servir comprovante pix");
  
  // Listar todas assinaturas (Somente Super ADM)
  static listAll = asyncHandler(async (req: Request, res: Response) => {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const subscriptions = await prisma.subscription.findMany({
      include: { client: true, plan: true },
      orderBy: { dataVencimento: 'desc' }
    });

    const result = subscriptions.map(sub => ({
      ...sub,
      plano: sub.plan?.nome || 'Desconhecido',
      tenantId: sub.clientId,
      tenant: sub.client ? { razaoSocial: sub.client.nomeCompleto } : undefined,
    }));

    return res.status(200).json(result);
  }, "listar subscriptions");

  // Ver assinatura do lojista atual
  static getMySubscription = asyncHandler(async (req: Request, res: Response) => {
    const clientId = (req.user as any)?.clientId as string;

    // Sem clientId (SUPER_ADMIN, equipe interna): não é 401 — a ausência de
    // assinatura é um estado válido. Um 401 aqui derrubaria a sessão do
    // frontend (evento session_expired) via chamadas auxiliares.
    if (!clientId) return res.status(200).json(null);

    const subscription = await prisma.subscription.findFirst({
      where: { clientId, statusPagamento: { in: ['PAGO', 'PENDENTE', 'TRIAL'] } },
      orderBy: { dataVencimento: 'desc' },
      include: { plan: true }
    });

    if (!subscription) return res.status(200).json(null);

    // Retorna plano com campo 'plano' para compatibilidade com o frontend
    const { plan, ...sub } = subscription;
    return res.status(200).json({
      ...sub,
      plano: plan?.nome || 'Desconhecido',
      planId: plan?.id || sub.planId,
    });
  }, "buscar subscription do tenant");

  // Criar / Atualizar plano
  static updatePlan = asyncHandler(async (req: Request, res: Response) => {
    const clientId = (req.user as any)?.clientId as string;
    const { planId, plano } = req.body;

    if (!clientId) return res.status(401).json({ message: 'Não autorizado' });

    // Se já tem assinatura PAGO, redireciona para fluxo de chamado
    const subAtiva = await prisma.subscription.findFirst({
      where: { clientId, statusPagamento: 'PAGO' },
      orderBy: { createdAt: 'desc' },
    });
    if (subAtiva) {
      return res.status(400).json({
        error: 'Você já possui uma assinatura ativa. Solicite a mudança de plano via Chamados.',
        code: 'ACTIVE_SUBSCRIPTION',
      });
    }

    // Lookup do plano pelo ID ou pelo nome (o preço vem SEMPRE do banco,
    // nunca do body — evitar price tampering)
    let plan = planId
      ? await prisma.plan.findUnique({ where: { id: planId } })
      : await prisma.plan.findFirst({ where: { nome: { contains: plano } } });

    // Se ainda não achou, tenta match exato pelo nome
    if (!plan && plano) {
      plan = await prisma.plan.findFirst({ where: { nome: plano } });
    }

    if (!plan) {
      return res.status(400).json({ error: 'Plano não encontrado.' });
    }

    // Cancela apenas assinaturas PENDENTE anteriores
    await prisma.subscription.updateMany({
      where: { clientId, statusPagamento: { in: ['PENDENTE', 'TRIAL'] } },
      data: { statusPagamento: 'CANCELADO' },
    });

    // Cria assinatura pendente com o preço oficial do plano
    const novaAssinatura = await prisma.subscription.create({
      data: {
        clientId,
        planId: plan.id,
        valorMensalidade: plan.precoMensal,
        dataVencimento: new Date(),
        statusPagamento: 'PENDENTE',
      },
    });

    // Mercado Pago (se configurado)
    const mpAccessToken = process.env.MP_ACCESS_TOKEN;
    if (!mpAccessToken) {
      return res.status(201).json({
        subscription: novaAssinatura,
        init_point: null,
        message: 'Plano registrado. Pagamento será processado manualmente.',
      });
    }
    const client = new MercadoPagoConfig({ accessToken: mpAccessToken });
    const preference = new Preference(client);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    const result = await preference.create({
      body: {
        items: [{
          id: plano || plan.nome,
          title: `Plano ${plano || plan.nome} - Lance Pelo Zap`,
          quantity: 1,
          unit_price: Number(plan.precoMensal),
          currency_id: 'BRL',
        }],
        external_reference: novaAssinatura.id,
        back_urls: {
          success: `${frontendUrl}/app/planos?status=success`,
          pending: `${frontendUrl}/app/planos?status=pending`,
          failure: `${frontendUrl}/app/planos?status=failure`,
        },
        auto_return: 'approved',
      },
    });

    return res.status(201).json({
      subscription: novaAssinatura,
      init_point: result.init_point,
    });
  }, "atualizar plano");

  // Solicitar mudança de plano via chamado
  static requestPlanChange = asyncHandler(async (req: Request, res: Response) => {
    const storeId = (req.user as any)?.storeId as string;
    const clientId = (req.user as any)?.clientId as string;
    const { planId, motivo } = req.body;

    if (!storeId || !clientId) {
      return res.status(400).json({ error: 'Usuário não vinculado a uma loja.' });
    }

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return res.status(404).json({ error: 'Plano não encontrado.' });

    const sub = await prisma.subscription.findFirst({
      where: { clientId, statusPagamento: { in: ['PAGO', 'TRIAL', 'PENDENTE'] } },
      orderBy: { createdAt: 'desc' },
    });

    // Cria chamado com dados da solicitação
    const ticket = await prisma.supportTicket.create({
      data: {
        storeId,
        assunto: `Solicitação de Mudança de Plano`,
        prioridade: 'P3',
        status: 'ABERTO',
        dadosForenses: {
          tipo: 'MUDANCA_PLANO',
          planoSolicitado: plan.nome,
          planoSolicitadoId: plan.id,
          valorSolicitado: Number(plan.precoMensal),
          planoAtual: sub?.planId || null,
          statusAtual: sub?.statusPagamento || null,
          motivo: motivo || '',
          solicitadoEm: new Date().toISOString(),
        },
      },
    });

    await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        remetente: 'CLIENTE',
        mensagem: `Solicitação de mudança para o plano "${plan.nome}" (R$ ${Number(plan.precoMensal).toFixed(2)}/mês).${motivo ? `\n\nMotivo: ${motivo}` : ''}`,
      },
    });

    return res.status(201).json({ message: 'Solicitação enviada com sucesso! Acompanhe pelo Chamados.', ticketId: ticket.id });
  }, "solicitar mudança de plano");

  // Bloquear ou desbloquear tenant (Super ADM)
  static toggleBlock = asyncHandler(async (req: Request, res: Response) => {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const id = req.params.id as string; // ID do tenant
    const { block } = req.body; // boolean

    // Aqui poderíamos ter um campo 'ativo' ou 'bloqueado' no Tenant. 
    // Por enquanto vamos atualizar o tenant nome ou adicionar lógica se tivéssemos o campo.
    // Vamos assumir que a model Tenant tem um campo ativo. Mas olhando o schema, ela só tem: id, razaoSocial, cnpj, etc.
    // O bloqueio é simulado ou podemos usar a Subscription para status.
    // Vamos alterar a Subscription mais recente para VENCIDO caso block seja true.
    
    const lastSub = await prisma.subscription.findFirst({
      where: { clientId: id },
      orderBy: { dataVencimento: 'desc' }
    });

    if (lastSub) {
      await prisma.subscription.update({
        where: { id: lastSub.id },
        data: {
          statusPagamento: block ? 'VENCIDO' : 'PAGO'
        }
      });
    }

    return res.status(200).json({ message: `Tenant ${block ? 'bloqueado' : 'desbloqueado'}` });
  }, "bloquear tenant");
}
