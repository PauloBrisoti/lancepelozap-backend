import { Request, Response } from 'express';
import { ServiceOrder, ServiceOrderItem } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { parseDate } from '../lib/dateUtils';
import { asyncHandler, getStoreId, HttpError } from '../lib/asyncHandler';
import { findOwnedOrThrow, transitionStatus } from '../lib/statusTransition';
import { rejectUnknownFields } from '../lib/bodyValidation';
import { StockMovementService } from '../services/StockMovementService';

export class ServiceOrderController {
  // ==================== SERVICE TYPES ====================

  listServiceTypes = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const types = await prisma.serviceType.findMany({
      where: { storeId },
      orderBy: { nome: 'asc' },
    });
    res.json(types);
  }, "listar tipos de serviço");

  createServiceType = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const { nome, descricao, precoPadrao, tempoEstimado, categoria } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

    const type = await prisma.serviceType.create({
      data: { storeId, nome, descricao, precoPadrao: precoPadrao || 0, tempoEstimado, categoria },
    });
    res.status(201).json(type);
  }, "criar tipo de serviço");

  updateServiceType = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;
    await findOwnedOrThrow(prisma.serviceType, id, storeId, 'Tipo de serviço não encontrado');

    // SEGURANÇA: allow-list explícita + rejeição de campos desconhecidos.
    const extra = rejectUnknownFields(req.body, ['nome', 'descricao', 'precoPadrao', 'tempoEstimado', 'categoria', 'ativo']);
    if (extra) return res.status(400).json({ error: `Campos não permitidos: ${extra.join(', ')}` });

    const { nome, descricao, precoPadrao, tempoEstimado, categoria, ativo } = req.body;
    const data: Record<string, unknown> = {};

    if (nome !== undefined) {
      if (typeof nome !== 'string' || !nome.trim()) return res.status(400).json({ error: 'Nome inválido' });
      data.nome = nome.trim();
    }
    if (descricao !== undefined) data.descricao = typeof descricao === 'string' ? descricao : String(descricao);
    if (precoPadrao !== undefined) {
      const v = Number(precoPadrao);
      if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'Preço padrão inválido' });
      data.precoPadrao = v;
    }
    if (tempoEstimado !== undefined) {
      const v = Number(tempoEstimado);
      if (!Number.isInteger(v) || v <= 0) return res.status(400).json({ error: 'Tempo estimado inválido' });
      data.tempoEstimado = v;
    }
    if (categoria !== undefined) data.categoria = typeof categoria === 'string' ? categoria : String(categoria);
    if (ativo !== undefined) {
      if (typeof ativo !== 'boolean') return res.status(400).json({ error: 'ativo deve ser booleano' });
      data.ativo = ativo;
    }

    const updated = await prisma.serviceType.update({
      where: { id },
      data,
    });
    res.json(updated);
  }, "atualizar tipo de serviço");

  deleteServiceType = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;
    await findOwnedOrThrow(prisma.serviceType, id, storeId, 'Tipo de serviço não encontrado');

    await prisma.serviceType.delete({ where: { id } });
    res.json({ message: 'Tipo de serviço excluído' });
  }, "excluir tipo de serviço");

  // ==================== SERVICE ORDERS ====================

  list = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const { status, limit = '50', offset = '0' } = req.query;

    const where: any = { storeId };
    if (status) where.status = status as string;

    const orders = await prisma.serviceOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
      include: {
        customer: { select: { id: true, nomeCompleto: true, telefoneWhatsapp: true } },
        user: { select: { id: true, nome: true } },
        items: {
          include: {
            serviceType: { select: { id: true, nome: true } },
            product: { select: { id: true, nome: true, qtdEstoqueAtual: true } },
          },
        },
      },
    });

    res.json(orders);
  }, "listar ordens de serviço");

  getById = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;

    const order = await findOwnedOrThrow(
      prisma.serviceOrder,
      id,
      storeId,
      'Ordem de serviço não encontrada',
      {
        customer: { select: { id: true, nomeCompleto: true, telefoneWhatsapp: true, cpf: true, enderecoCompleto: true } },
        user: { select: { id: true, nome: true } },
        items: {
          include: {
            serviceType: { select: { id: true, nome: true } },
            product: { select: { id: true, nome: true, qtdEstoqueAtual: true, precoVendaSugerido: true } },
          },
        },
      },
    );

    res.json(order);
  }, "buscar ordem de serviço");

  create = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const userId = req.user?.id as string;
    const {
      customerId, descricao, observacoes, dataPrevisao,
      modeloEquipamento, numeroSerie, garantiaDias,
      items = [],
    } = req.body;

    if (!customerId) return res.status(400).json({ error: 'Cliente é obrigatório' });

    // Generate sequential OS number
    const lastOS = await prisma.serviceOrder.findFirst({
      where: { storeId },
      orderBy: { osNumber: 'desc' },
      select: { osNumber: true },
    });
    const osNumber = (lastOS?.osNumber || 0) + 1;

    // Calculate totals
    let maoDeObraValor = 0;
    let pecasValor = 0;

    for (const item of items) {
      const total = Number(item.quantidade || 1) * Number(item.precoUnitario || 0);
      if (item.tipo === 'SERVICO') maoDeObraValor += total;
      else if (item.tipo === 'PECA') pecasValor += total;
    }

    const valorTotal = maoDeObraValor + pecasValor;

    const order = await prisma.serviceOrder.create({
      data: {
        storeId, userId, customerId, osNumber,
        descricao, observacoes, dataPrevisao: parseDate(dataPrevisao),
        modeloEquipamento, numeroSerie, garantiaDias,
        maoDeObraValor, pecasValor, valorTotal,
        items: {
          create: items.map((item: any) => ({
            serviceTypeId: item.serviceTypeId || null,
            productId: item.productId || null,
            tipo: item.tipo || 'SERVICO',
            descricao: item.descricao,
            quantidade: item.quantidade || 1,
            precoUnitario: item.precoUnitario || 0,
            valorTotal: (Number(item.quantidade || 1) * Number(item.precoUnitario || 0)),
          })),
        },
      },
      include: {
        customer: { select: { id: true, nomeCompleto: true } },
        items: true,
      },
    });

    res.status(201).json(order);
  }, "criar ordem de serviço");

  update = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;

    await findOwnedOrThrow(prisma.serviceOrder, id, storeId, 'Ordem de serviço não encontrada');

    const {
      descricao, observacoes, dataPrevisao,
      modeloEquipamento, numeroSerie, garantiaDias,
    } = req.body;

    const updated = await prisma.serviceOrder.update({
      where: { id },
      data: {
        descricao, observacoes,
        dataPrevisao: dataPrevisao ? parseDate(dataPrevisao) : undefined,
        modeloEquipamento, numeroSerie, garantiaDias,
      },
    });

    res.json(updated);
  }, "atualizar ordem de serviço");

  // ==================== STATUS TRANSITIONS ====================

  startService = asyncHandler(async (req: Request, res: Response) => {
    const updated = await transitionStatus({
      model: prisma.serviceOrder,
      id: req.params.id as string,
      storeId: getStoreId(req),
      notFoundMessage: 'Ordem não encontrada',
      allowedFrom: ['ABERTO'],
      invalidMessage: 'Apenas ordens ABERTO podem iniciar',
      to: 'EM_ANDAMENTO',
    });
    res.json(updated);
  }, "iniciar ordem de serviço");

  setWaitingParts = asyncHandler(async (req: Request, res: Response) => {
    const updated = await transitionStatus({
      model: prisma.serviceOrder,
      id: req.params.id as string,
      storeId: getStoreId(req),
      notFoundMessage: 'Ordem não encontrada',
      allowedFrom: ['EM_ANDAMENTO'],
      invalidMessage: 'Apenas ordens EM_ANDAMENTO podem aguardar peças',
      to: 'AGUARDANDO_PECAS',
    });
    res.json(updated);
  }, "aguardar peças");

  complete = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;

    const order = await findOwnedOrThrow<ServiceOrder & { items: ServiceOrderItem[] }>(
      prisma.serviceOrder,
      id,
      storeId,
      'Ordem não encontrada',
      { items: true },
    );
    if (!['EM_ANDAMENTO', 'AGUARDANDO_PECAS'].includes(order.status)) {
      throw new HttpError('Ordem precisa estar EM_ANDAMENTO ou AGUARDANDO_PECAS', 400);
    }

    // Deduct stock for parts
    for (const item of order.items) {
      if (item.tipo === 'PECA' && item.productId) {
        await StockMovementService.movimentar(prisma, {
          storeId,
          productId: item.productId,
          userId: req.user?.id as string,
          tipo: 'SAIDA',
          quantidade: Number(item.quantidade),
          referenciaId: order.id,
          observacao: `Baixa por OS #${order.osNumber}`,
          skipSeProdutoInexistente: true,
        });
      }
    }

    const updated = await prisma.serviceOrder.update({
      where: { id },
      data: { status: 'CONCLUIDO', dataConclusao: new Date() },
    });
    res.json(updated);
  }, "concluir ordem de serviço");

  deliver = asyncHandler(async (req: Request, res: Response) => {
    const { formaPagamento } = req.body;
    const updated = await transitionStatus({
      model: prisma.serviceOrder,
      id: req.params.id as string,
      storeId: getStoreId(req),
      notFoundMessage: 'Ordem não encontrada',
      allowedFrom: ['CONCLUIDO'],
      invalidMessage: 'Ordem precisa estar CONCLUIDO',
      to: 'ENTREGUE',
      extraData: { dataEntrega: new Date(), formaPagamento },
    });
    res.json(updated);
  }, "entregar ordem de serviço");

  cancel = asyncHandler(async (req: Request, res: Response) => {
    const updated = await transitionStatus({
      model: prisma.serviceOrder,
      id: req.params.id as string,
      storeId: getStoreId(req),
      notFoundMessage: 'Ordem não encontrada',
      allowedFrom: ['ABERTO', 'EM_ANDAMENTO', 'AGUARDANDO_PECAS', 'CONCLUIDO'],
      invalidMessage: 'Ordem já finalizada não pode ser cancelada',
      to: 'CANCELADO',
    });
    res.json(updated);
  }, "cancelar ordem de serviço");

  // ==================== ITEMS ====================

  addItem = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;

    const order = await findOwnedOrThrow<ServiceOrder>(prisma.serviceOrder, id, storeId, 'Ordem não encontrada');
    if (order.status !== 'ABERTO' && order.status !== 'EM_ANDAMENTO') {
      return res.status(400).json({ error: 'Ordem precisa estar ABERTO ou EM_ANDAMENTO' });
    }

    const { serviceTypeId, productId, tipo, descricao, quantidade, precoUnitario } = req.body;
    if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });

    const qty = Number(quantidade || 1);
    const price = Number(precoUnitario || 0);
    const total = qty * price;

    const item = await prisma.serviceOrderItem.create({
      data: {
        serviceOrderId: id, serviceTypeId, productId,
        tipo: tipo || 'SERVICO', descricao, quantidade: qty,
        precoUnitario: price, valorTotal: total,
      },
    });

    await recalcTotals(id);

    res.status(201).json(item);
  }, "adicionar item à ordem de serviço");

  removeItem = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;
    const itemId = req.params.itemId as string;

    await findOwnedOrThrow(prisma.serviceOrder, id, storeId, 'Ordem não encontrada');

    await prisma.serviceOrderItem.delete({ where: { id: itemId } });

    await recalcTotals(id);

    res.json({ message: 'Item removido' });
  }, "remover item da ordem de serviço");
}

/** Recalcula e persiste os totais de mão de obra/peças de uma ordem de serviço. */
async function recalcTotals(serviceOrderId: string) {
  const items = await prisma.serviceOrderItem.findMany({ where: { serviceOrderId } });
  let maoDeObra = 0, pecas = 0;
  for (const i of items) {
    if (i.tipo === 'SERVICO') maoDeObra += Number(i.valorTotal);
    else pecas += Number(i.valorTotal);
  }
  await prisma.serviceOrder.update({
    where: { id: serviceOrderId },
    data: { maoDeObraValor: maoDeObra, pecasValor: pecas, valorTotal: maoDeObra + pecas },
  });
}
