import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { parseDate } from '../lib/dateUtils';

export class ServiceOrderController {
  // ==================== SERVICE TYPES ====================

  async listServiceTypes(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const types = await prisma.serviceType.findMany({
        where: { storeId },
        orderBy: { nome: 'asc' },
      });
      res.json(types);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async createServiceType(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const { nome, descricao, precoPadrao, tempoEstimado, categoria } = req.body;
      if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

      const type = await prisma.serviceType.create({
        data: { storeId, nome, descricao, precoPadrao: precoPadrao || 0, tempoEstimado, categoria },
      });
      res.status(201).json(type);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async updateServiceType(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;
      const type = await prisma.serviceType.findFirst({ where: { id, storeId } });
      if (!type) return res.status(404).json({ error: 'Tipo de serviço não encontrado' });

      const updated = await prisma.serviceType.update({
        where: { id },
        data: req.body,
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async deleteServiceType(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;
      const type = await prisma.serviceType.findFirst({ where: { id, storeId } });
      if (!type) return res.status(404).json({ error: 'Tipo de serviço não encontrado' });

      await prisma.serviceType.delete({ where: { id } });
      res.json({ message: 'Tipo de serviço excluído' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // ==================== SERVICE ORDERS ====================

  async list(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
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
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const order = await prisma.serviceOrder.findFirst({
        where: { id, storeId },
        include: {
          customer: { select: { id: true, nomeCompleto: true, telefoneWhatsapp: true, cpf: true, enderecoCompleto: true } },
          user: { select: { id: true, nome: true } },
          items: {
            include: {
              serviceType: { select: { id: true, nome: true } },
              product: { select: { id: true, nome: true, qtdEstoqueAtual: true, precoVendaSugerido: true } },
            },
          },
        },
      });

      if (!order) return res.status(404).json({ error: 'Ordem de serviço não encontrada' });
      res.json(order);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
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
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const order = await prisma.serviceOrder.findFirst({ where: { id, storeId } });
      if (!order) return res.status(404).json({ error: 'Ordem de serviço não encontrada' });

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
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // ==================== STATUS TRANSITIONS ====================

  async startService(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const order = await prisma.serviceOrder.findFirst({ where: { id, storeId } });
      if (!order) return res.status(404).json({ error: 'Ordem não encontrada' });
      if (order.status !== 'ABERTO') return res.status(400).json({ error: 'Apenas ordens ABERTO podem iniciar' });

      const updated = await prisma.serviceOrder.update({
        where: { id },
        data: { status: 'EM_ANDAMENTO' },
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async setWaitingParts(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const order = await prisma.serviceOrder.findFirst({ where: { id, storeId } });
      if (!order) return res.status(404).json({ error: 'Ordem não encontrada' });
      if (order.status !== 'EM_ANDAMENTO') return res.status(400).json({ error: 'Apenas ordens EM_ANDAMENTO podem aguardar peças' });

      const updated = await prisma.serviceOrder.update({
        where: { id },
        data: { status: 'AGUARDANDO_PECAS' },
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async complete(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const order = await prisma.serviceOrder.findFirst({
        where: { id, storeId },
        include: { items: true },
      });
      if (!order) return res.status(404).json({ error: 'Ordem não encontrada' });
      if (!['EM_ANDAMENTO', 'AGUARDANDO_PECAS'].includes(order.status)) {
        return res.status(400).json({ error: 'Ordem precisa estar EM_ANDAMENTO ou AGUARDANDO_PECAS' });
      }

      // Deduct stock for parts
      for (const item of order.items) {
        if (item.tipo === 'PECA' && item.productId) {
          const product = await prisma.product.findUnique({ where: { id: item.productId } });
          if (product) {
            const newQty = Number(product.qtdEstoqueAtual) - Number(item.quantidade);
            await prisma.product.update({
              where: { id: product.id },
              data: { qtdEstoqueAtual: newQty },
            });
            await prisma.stockMovement.create({
              data: {
                storeId, productId: item.productId, userId: req.user?.id as string,
                tipo: 'SAIDA', quantidade: -Number(item.quantidade),
                saldoAnterior: Number(product.qtdEstoqueAtual),
                saldoPosterior: newQty,
                referenciaId: order.id,
                observacao: `Baixa por OS #${order.osNumber}`,
              },
            });
          }
        }
      }

      const updated = await prisma.serviceOrder.update({
        where: { id },
        data: { status: 'CONCLUIDO', dataConclusao: new Date() },
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async deliver(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;
      const { formaPagamento } = req.body;

      const order = await prisma.serviceOrder.findFirst({ where: { id, storeId } });
      if (!order) return res.status(404).json({ error: 'Ordem não encontrada' });
      if (order.status !== 'CONCLUIDO') return res.status(400).json({ error: 'Ordem precisa estar CONCLUIDO' });

      const updated = await prisma.serviceOrder.update({
        where: { id },
        data: { status: 'ENTREGUE', dataEntrega: new Date(), formaPagamento },
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async cancel(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const order = await prisma.serviceOrder.findFirst({ where: { id, storeId } });
      if (!order) return res.status(404).json({ error: 'Ordem não encontrada' });
      if (['ENTREGUE', 'CANCELADO'].includes(order.status)) {
        return res.status(400).json({ error: 'Ordem já finalizada não pode ser cancelada' });
      }

      const updated = await prisma.serviceOrder.update({
        where: { id },
        data: { status: 'CANCELADO' },
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // ==================== ITEMS ====================

  async addItem(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;

      const order = await prisma.serviceOrder.findFirst({ where: { id, storeId } });
      if (!order) return res.status(404).json({ error: 'Ordem não encontrada' });
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

      // Recalculate totals
      const items = await prisma.serviceOrderItem.findMany({ where: { serviceOrderId: id } });
      let maoDeObra = 0, pecas = 0;
      for (const i of items) {
        if (i.tipo === 'SERVICO') maoDeObra += Number(i.valorTotal);
        else pecas += Number(i.valorTotal);
      }
      await prisma.serviceOrder.update({
        where: { id },
        data: { maoDeObraValor: maoDeObra, pecasValor: pecas, valorTotal: maoDeObra + pecas },
      });

      res.status(201).json(item);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async removeItem(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;
      const itemId = req.params.itemId as string;

      const order = await prisma.serviceOrder.findFirst({ where: { id, storeId } });
      if (!order) return res.status(404).json({ error: 'Ordem não encontrada' });

      await prisma.serviceOrderItem.delete({ where: { id: itemId } });

      const items = await prisma.serviceOrderItem.findMany({ where: { serviceOrderId: id } });
      let maoDeObra = 0, pecas = 0;
      for (const i of items) {
        if (i.tipo === 'SERVICO') maoDeObra += Number(i.valorTotal);
        else pecas += Number(i.valorTotal);
      }
      await prisma.serviceOrder.update({
        where: { id },
        data: { maoDeObraValor: maoDeObra, pecasValor: pecas, valorTotal: maoDeObra + pecas },
      });

      res.json({ message: 'Item removido' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
