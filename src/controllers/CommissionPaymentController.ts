import { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { asyncHandler } from "../lib/asyncHandler";
import { getTimezone, buildDateRange } from '../lib/dateUtils';

export class CommissionPaymentController {
  summary = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const requesterId = req.user?.id;
      const access = requesterId
        ? await prisma.storeUserAccess.findUnique({
            where: { storeId_userId: { storeId, userId: requesterId } },
            select: { role: true }
          })
        : null;
      const restricted = !!access && (access.role === 'VENDEDOR' || access.role === 'CAIXA');

      // Total pending (unpaid) commission per seller
      const pending = await prisma.saleItem.findMany({
        where: {
          sale: { storeId, status: 'FINALIZADA' },
          commissionPaidAt: null,
          comissaoVendedorValor: { gt: 0 },
          ...(restricted ? { sale: { userId: requesterId! } } : {}),
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
        where: {
          storeId,
          pagoEm: { gte: startOfMonth },
          ...(restricted ? { userId: requesterId! } : {}),
        },
        _sum: { totalValor: true },
      });

      // Grand total pending
      const totalPendente = [...pendingMap.values()].reduce((a, b) => a + b, 0);

      res.json({
        totalPendente,
        totalPagoEsteMes: Number(paidThisMonth._sum.totalValor || 0),
        porVendedor: pendingByUser,
      });
    
  }, "resumir");

  list = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const userId = req.query.userId as string | undefined;

      // VENDEDOR/CAIXA vê apenas os próprios pagamentos de comissão
      const requesterId = req.user?.id;
      const access = requesterId
        ? await prisma.storeUserAccess.findUnique({
            where: { storeId_userId: { storeId, userId: requesterId } },
            select: { role: true }
          })
        : null;
      const restricted = !!access && (access.role === 'VENDEDOR' || access.role === 'CAIXA');

      const where: any = { storeId };
      if (restricted) where.userId = requesterId;
      else if (userId) where.userId = userId;

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
    
  }, "listar");

  // Detalhe das vendas/itens que compõem a comissão pendente de um vendedor
  pendingDetail = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      let sellerId = req.query.sellerId as string | undefined;
      if (!sellerId) return res.status(400).json({ message: 'sellerId é obrigatório' });

      // VENDEDOR/CAIXA só acessa o próprio detalhe
      const requesterId = req.user?.id;
      const access = requesterId
        ? await prisma.storeUserAccess.findUnique({
            where: { storeId_userId: { storeId, userId: requesterId } },
            select: { role: true }
          })
        : null;
      if (access && (access.role === 'VENDEDOR' || access.role === 'CAIXA')) {
        sellerId = requesterId;
      }

      const items = await prisma.saleItem.findMany({
        where: {
          sale: { storeId, userId: sellerId, status: 'FINALIZADA' },
          commissionPaidAt: null,
          comissaoVendedorValor: { gt: 0 },
        },
        select: {
          id: true,
          quantidade: true,
          comissaoVendedorValor: true,
          product: { select: { nome: true } },
          sale: {
            select: { id: true, dataVenda: true, valorTotalLiquido: true, formaPagamento: true }
          },
        },
        orderBy: { sale: { dataVenda: 'desc' } },
      });

      // Agrupa por venda
      const bySale = new Map<string, { sale: any; itens: any[]; totalComissao: number }>();
      for (const item of items) {
        const saleId = item.sale.id;
        const entry = bySale.get(saleId) || { sale: item.sale, itens: [], totalComissao: 0 };
        entry.itens.push({
          id: item.id,
          produto: item.product?.nome || 'Produto Removido',
          quantidade: Number(item.quantidade),
          comissao: Number(item.comissaoVendedorValor),
        });
        entry.totalComissao += Number(item.comissaoVendedorValor);
        bySale.set(saleId, entry);
      }

      res.json({
        sellerId,
        vendas: [...bySale.values()].map(e => ({
          saleId: e.sale.id,
          dataVenda: e.sale.dataVenda,
          valorTotal: Number(e.sale.valorTotalLiquido),
          formaPagamento: e.sale.formaPagamento,
          itens: e.itens,
          totalComissao: Math.round(e.totalComissao * 100) / 100,
        })),
      });
    
  }, "pending detail");

  pay = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: 'Usuário ou loja não identificados' });

      // VENDEDOR/CAIXA não podem pagar comissões (nem as próprias)
      const access = await prisma.storeUserAccess.findUnique({
        where: { storeId_userId: { storeId, userId } },
        select: { role: true }
      });
      if (access && (access.role === 'VENDEDOR' || access.role === 'CAIXA')) {
        return res.status(403).json({ message: 'Apenas gestores podem pagar comissões' });
      }

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

      const seller = await prisma.user.findUnique({ where: { id: sellerId }, select: { nome: true } });
      const sellerNome = seller?.nome || 'Vendedor';

      const payment = await prisma.$transaction(async (tx) => {
        // Carteira para o débito (padrão: primeira carteira da loja)
        let walletId = req.body.walletId as string | undefined;
        if (!walletId) {
          const wallet = await tx.wallet.findFirst({
            where: { storeId },
            orderBy: { nome: 'asc' }
          });
          if (wallet) walletId = wallet.id;
        }
        if (!walletId) {
          const defaultWallet = await tx.wallet.create({
            data: { storeId, nome: 'Caixa Interno', tipo: 'EMPRESA', saldoAtual: 0 }
          });
          walletId = defaultWallet.id;
        }

        // Lançamento financeiro de saída (despesa com comissão)
        await tx.financialTransaction.create({
          data: {
            storeId,
            walletId,
            tipo: 'SAIDA',
            status: 'ATIVA',
            valor: totalValor,
            descricao: `Comissão paga: ${sellerNome}`,
            categoria: 'COMISSAO',
            dataTransacao: new Date(),
          }
        });

        // Debita o caixa da carteira
        await tx.wallet.update({
          where: { id: walletId },
          data: { saldoAtual: { decrement: totalValor } }
        });

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
    
  }, "pagar");
}
