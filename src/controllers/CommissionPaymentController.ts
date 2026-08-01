import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { getTimezone, buildDateRange } from '../lib/dateUtils';

export class CommissionPaymentController {
  async summary(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      // Total pending (unpaid) commission per seller
      const pending = await prisma.saleItem.findMany({
        where: {
          sale: { storeId, status: 'FINALIZADA' },
          commissionPaidAt: null,
          comissaoVendedorValor: { gt: 0 },
        },
        include: {
          sale: { select: { userId: true } },
        },
      });

      // Aggregate pending by user
      const pendingMap = new Map<string, number>();
      for (const item of pending) {
        const uid = item.sale.userId;
        pendingMap.set(uid, (pendingMap.get(uid) || 0) + Number(item.comissaoVendedorValor));
      }

      // Get user details for pending sellers
      const userIds = [...pendingMap.keys()];
      const users = userIds.length > 0
        ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, nome: true } })
        : [];
      const userMap = new Map(users.map(u => [u.id, u.nome]));

      const pendingByUser = [...pendingMap.entries()].map(([userId, total]) => ({
        userId,
        nome: userMap.get(userId) || 'Desconhecido',
        totalPendente: total,
      }));

      // Total paid this month
      const { firstDay: startOfMonth } = buildDateRange();

      const paidThisMonth = await prisma.commissionPayment.aggregate({
        where: { storeId, pagoEm: { gte: startOfMonth } },
        _sum: { totalValor: true },
      });

      // Grand total pending
      const totalPendente = [...pendingMap.values()].reduce((a, b) => a + b, 0);

      res.json({
        totalPendente,
        totalPagoEsteMes: Number(paidThisMonth._sum.totalValor || 0),
        porVendedor: pendingByUser,
      });
    } catch (error: any) {
      console.error('Erro ao buscar resumo de comissões:', error);
      res.status(500).json({ message: error.message || 'Erro interno' });
    }
  }

  async list(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const userId = req.query.userId as string | undefined;

      const where: any = { storeId };
      if (userId) where.userId = userId;

      const [data, total] = await Promise.all([
        prisma.commissionPayment.findMany({
          where,
          include: {
            user: { select: { id: true, nome: true } },
          },
          orderBy: { pagoEm: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.commissionPayment.count({ where }),
      ]);

      res.json({ data, total, page, limit });
    } catch (error: any) {
      console.error('Erro ao listar pagamentos:', error);
      res.status(500).json({ message: error.message || 'Erro interno' });
    }
  }

  async pay(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: 'Usuário ou loja não identificados' });

      const { sellerId, dataFim } = req.body;
      if (!sellerId) return res.status(400).json({ message: 'sellerId é obrigatório' });

      const endDate = dataFim
        ? fromZonedTime(`${dataFim}T23:59:59.999`, getTimezone())
        : toZonedTime(new Date(), getTimezone());

      // Find all unpaid commission items for this seller up to dataFim
      const items = await prisma.saleItem.findMany({
        where: {
          sale: {
            storeId,
            userId: sellerId,
            status: 'FINALIZADA',
            dataVenda: { lte: endDate },
          },
          commissionPaidAt: null,
          comissaoVendedorValor: { gt: 0 },
        },
        include: {
          sale: { select: { dataVenda: true } },
        },
      });

      if (items.length === 0) {
        return res.status(400).json({ message: 'Nenhuma comissão pendente para este vendedor no período' });
      }

      const totalValor = items.reduce((acc, item) => acc + Number(item.comissaoVendedorValor), 0);
      const minDate = items.reduce((earliest, item) =>
        item.sale.dataVenda < earliest ? item.sale.dataVenda : earliest,
        items[0].sale.dataVenda,
      );

      const payment = await prisma.$transaction(async (tx) => {
        // Create payment record
        const p = await tx.commissionPayment.create({
          data: {
            storeId,
            userId: sellerId,
            totalValor,
            dataInicio: minDate,
            dataFim: endDate,
            status: 'PAGO',
          },
          include: {
            user: { select: { id: true, nome: true } },
          },
        });

        // Mark all items as paid
        await tx.saleItem.updateMany({
          where: { id: { in: items.map(i => i.id) } },
          data: { commissionPaidAt: new Date() },
        });

        return p;
      });

      res.status(201).json(payment);
    } catch (error: any) {
      console.error('Erro ao pagar comissões:', error);
      res.status(500).json({ message: error.message || 'Erro interno' });
    }
  }
}
