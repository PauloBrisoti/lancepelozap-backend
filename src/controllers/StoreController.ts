import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { ok, fail } from '../lib/response';
import { asyncHandler } from '../lib/asyncHandler';

export class StoreController {

  listMyStores = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, 'Usuário não identificado', 401);

    const accesses = await prisma.storeUserAccess.findMany({
      where: { userId },
      include: {
        store: {
          include: {
            control: true,
            _count: { select: { storeUsers: true, products: true, sales: true } }
          }
        }
      }
    });

    // Agrupar stores por control (formato legado: array de controls)
    const controlMap = new Map<string, any>();
    for (const acc of accesses) {
      const s = acc.store;
      if (!controlMap.has(s.controlId)) {
        controlMap.set(s.controlId, {
          id: s.control.id,
          clientId: s.control.clientId,
          nome: s.control.nome,
          tipo: s.control.tipo,
          stores: []
        });
      }
      const { control, whatsappApiKey, ...storeData } = s;
      controlMap.get(s.controlId).stores.push(storeData);
    }

    return ok(res, Array.from(controlMap.values()));
  }, "listar lojas");

  createStore = asyncHandler(async (req: Request, res: Response) => {
    const clientId = req.user?.clientId;
    const userId = req.user?.id;
    if (!clientId || !userId) return fail(res, 'Cliente não identificado', 401);

    const { nomeFantasia, controlId: controlIdInput, cnpjCpf, nichoPrincipal, telefoneWhatsapp, emailContato, chavePix } = req.body;

    if (!nomeFantasia) {
      return fail(res, 'Nome da loja é obrigatório', 400);
    }

    // Auto-resolve controlId: se não enviado, usa o primeiro control do cliente
    let controlId = controlIdInput;
    if (!controlId) {
      const firstControl = await prisma.control.findFirst({
        where: { clientId },
        orderBy: { createdAt: 'asc' }
      });
      if (firstControl) {
        controlId = firstControl.id;
      } else {
        // Se não existir nenhum control, cria um default
        const newControl = await prisma.control.create({
          data: { clientId, nome: 'Controle Principal', tipo: 'PJ' }
        });
        controlId = newControl.id;
      }
    }

    // Verificar se o control pertence ao cliente
    const control = await prisma.control.findFirst({
      where: { id: controlId, clientId }
    });

    if (!control) {
      return fail(res, 'Controle não encontrado ou não pertence a este cliente', 404);
    }

    // Validar limite do plano (soma de todas as lojas do cliente)
    const sub = await prisma.subscription.findFirst({
      where: { clientId, statusPagamento: { in: ['PAGO', 'PENDENTE', 'TRIAL'] } },
      include: { plan: true }
    });

    if (sub) {
      const totalStores = await prisma.store.count({
        where: { control: { clientId } }
      });
      if (totalStores >= sub.plan.maxStores) {
        return fail(res, `Limite de ${sub.plan.maxStores} lojas atingido para o seu plano. Faça upgrade do plano.`, 403);
      }
    }

    const store = await prisma.store.create({
      data: {
        controlId,
        nomeFantasia,
        cnpjCpf: cnpjCpf || null,
        nichoPrincipal: nichoPrincipal || null,
        telefoneWhatsapp: telefoneWhatsapp || null,
        emailContato: emailContato || null,
        chavePix: chavePix || null,
        status: 'ATIVO',
        storeUsers: {
          create: {
            userId,
            role: 'GERENTE',
            permiteVendaPrazo: true,
            limiteDescontoMaximo: 100,
          }
        }
      },
      include: {
        _count: { select: { storeUsers: true, products: true, sales: true } }
      }
    });

    // Registrar auditoria
    await prisma.auditLog.create({
      data: {
        storeId: store.id,
        userId,
        acao: 'CRIAR_LOJA',
        tabelaAfetada: 'stores',
        dadosNovos: { nomeFantasia, controlId, clientId }
      }
    });

    // Atualizar JWT com a nova loja no allowedStoreIds
    const userAccesses = await prisma.storeUserAccess.findMany({
      where: { userId }
    });
    const allowedStoreIds = userAccesses.map(a => a.storeId);
    const JWT_SECRET = process.env.JWT_SECRET;
    if (JWT_SECRET) {
      const newToken = jwt.sign(
        {
          id: req.user!.id,
          storeId: req.user!.storeId || store.id,
          allowedStoreIds,
          clientId,
          role: req.user!.role,
          internalRoleId: (req.user as any).internalRoleId,
          tv: (req.user as any).tv
        },
        JWT_SECRET,
        { expiresIn: "12h" }
      );
      res.cookie('authToken', newToken, {
        httpOnly: true,
        path: '/',
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 12 * 60 * 60 * 1000,
      });
    }

    return ok(res, store, 201);
  }, "criar loja");

  updateStore = asyncHandler(async (req: Request, res: Response) => {
    const clientId = req.user?.clientId as string;
    const storeId = req.params.id as string;
    const userId = req.user?.id as string;
    if (!clientId || !userId || !storeId) return fail(res, 'Cliente ou loja não identificado', 401);

    const store = await prisma.store.findFirst({
      where: { id: storeId, control: { clientId } }
    });

    if (!store) return fail(res, 'Loja não encontrada', 404);

    const body = req.body as Record<string, string | undefined>;
    const nomeFantasia = body.nomeFantasia;
    const cnpjCpf = body.cnpjCpf;
    const nichoPrincipal = body.nichoPrincipal;
    const telefoneWhatsapp = body.telefoneWhatsapp;
    const emailContato = body.emailContato;
    const chavePix = body.chavePix;
    const status = body.status;

    const updated = await prisma.store.update({
      where: { id: storeId },
      data: {
        nomeFantasia: nomeFantasia ?? store.nomeFantasia,
        cnpjCpf: cnpjCpf ?? store.cnpjCpf,
        nichoPrincipal: nichoPrincipal ?? store.nichoPrincipal,
        telefoneWhatsapp: telefoneWhatsapp ?? store.telefoneWhatsapp,
        emailContato: emailContato ?? store.emailContato,
        chavePix: chavePix ?? store.chavePix,
        status: status ?? store.status,
      }
    });

    await prisma.auditLog.create({
      data: {
        storeId, userId,
        acao: 'ATUALIZAR_LOJA',
        tabelaAfetada: 'stores',
        dadosAntigos: { nomeFantasia: store.nomeFantasia, status: store.status },
        dadosNovos: { nomeFantasia, cnpjCpf, nichoPrincipal, telefoneWhatsapp, emailContato, chavePix, status }
      }
    });

    // SEGURANÇA: nunca ecoar credenciais de integração (whatsappApiKey)
    const { whatsappApiKey, ...safeUpdated } = updated as any;
    return ok(res, safeUpdated);
  }, "atualizar loja");

  updateCardBehavior = asyncHandler(async (req: Request, res: Response) => {
    const clientId = req.user?.clientId as string;
    const storeId = req.params.id as string;
    if (!clientId || !storeId) return fail(res, 'Loja não identificada', 401);

    const store = await prisma.store.findFirst({
      where: { id: storeId, control: { clientId } }
    });

    if (!store) return fail(res, 'Loja não encontrada', 404);

    const { cartaoImediato } = req.body as { cartaoImediato?: boolean };
    if (typeof cartaoImediato !== 'boolean') return fail(res, 'cartaoImediato deve ser boolean', 400);

    const updated = await prisma.store.update({
      where: { id: storeId },
      data: { cartaoImediato }
    });

    return ok(res, { cartaoImediato: updated.cartaoImediato });
  }, "atualizar comportamento de cartão");

  updateFiscalMonthStart = asyncHandler(async (req: Request, res: Response) => {
    const storeId = req.params.id as string;
    const store = await prisma.store.findFirst({ where: { id: storeId, control: { clientId: req.user?.clientId as string } } });
    if (!store) return fail(res, 'Loja não encontrada', 404);
    const { diaInicioMes } = req.body as { diaInicioMes?: number };
    if (typeof diaInicioMes !== 'number' || diaInicioMes < 1 || diaInicioMes > 28) {
      return fail(res, 'diaInicioMes deve ser um número entre 1 e 28', 400);
    }
    const updated = await prisma.store.update({ where: { id: storeId }, data: { diaInicioMes } });
    return ok(res, { diaInicioMes: updated.diaInicioMes });
  }, "atualizar dia de início do mês");

  getFiscalConfig = asyncHandler(async (req: Request, res: Response) => {
    const storeId = req.params.id as string;
    const store = await prisma.store.findFirst({ where: { id: storeId, control: { clientId: req.user?.clientId as string } } });
    if (!store) return fail(res, 'Loja não encontrada', 404);
    return ok(res, { diaInicioMes: store.diaInicioMes });
  }, "buscar config fiscal");

  getDashboardConfig = asyncHandler(async (req: Request, res: Response) => {
    const storeId = req.params.id as string;
    const store = await prisma.store.findFirst({ where: { id: storeId, control: { clientId: req.user?.clientId as string } } });
    if (!store) return fail(res, 'Loja não encontrada', 404);

    const cards = store.dashboardCards ? JSON.parse(store.dashboardCards) : null;
    return ok(res, { cards });
  }, "buscar config do dashboard");

  updateDashboardConfig = asyncHandler(async (req: Request, res: Response) => {
    const storeId = req.params.id as string;
    const store = await prisma.store.findFirst({ where: { id: storeId, control: { clientId: req.user?.clientId as string } } });
    if (!store) return fail(res, 'Loja não encontrada', 404);

    const { cards } = req.body as { cards: string[] };
    if (!Array.isArray(cards)) return fail(res, 'cards deve ser um array de strings', 400);

    const updated = await prisma.store.update({
      where: { id: storeId },
      data: { dashboardCards: JSON.stringify(cards) }
    });

    return ok(res, { cards: JSON.parse(updated.dashboardCards!) });
  }, "atualizar config do dashboard");
}
