import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import { asyncHandler } from '../lib/asyncHandler';

export class SubscriptionController {
  
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
