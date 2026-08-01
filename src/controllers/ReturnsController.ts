import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { ReturnsService, ReturnsServiceError } from '../services/ReturnsService';

export class ReturnsController {
  async list(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const status = req.query.status as string | undefined;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      const where: any = { storeId };
      if (status) where.status = status;

      const [returns, total] = await Promise.all([
        prisma.productReturn.findMany({
          where,
          include: {
            items: {
              include: { product: { select: { id: true, nome: true, codigoVisual: true } } },
            },
            sale: { select: { id: true, dataVenda: true, valorTotalLiquido: true } },
            customer: { select: { id: true, nomeCompleto: true } },
            user: { select: { id: true, nome: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.productReturn.count({ where }),
      ]);

      res.json({ data: returns, total, page, limit });
    } catch (error) {
      console.error("Erro ao listar devoluções:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const ret = await prisma.productReturn.findFirst({
        where: { id: req.params.id as string, storeId },
        include: {
          items: {
            include: {
              product: { select: { id: true, nome: true, codigoVisual: true, precoCusto: true } },
            },
          },
          sale: {
            select: { id: true, dataVenda: true, valorTotalLiquido: true, formaPagamento: true },
          },
          customer: { select: { id: true, nomeCompleto: true } },
          user: { select: { id: true, nome: true } },
        },
      });

      if (!ret) return res.status(404).json({ message: "Devolução não encontrada" });

      res.json(ret);
    } catch (error) {
      console.error("Erro ao buscar devolução:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: "Usuário ou loja não identificados" });

      const { saleId, items, motivo } = req.body;

      if (!saleId) return res.status(400).json({ message: "Venda é obrigatória" });
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Mínimo de 1 item para devolução" });
      }

      // Verify sale exists and belongs to store
      const sale = await prisma.sale.findFirst({ where: { id: saleId, storeId } });
      if (!sale) return res.status(404).json({ message: "Venda não encontrada" });
      if (sale.status === "CANCELADA") return res.status(400).json({ message: "Venda cancelada não pode ter devolução" });

      // Check for existing returns on this sale
      const existingReturns = await prisma.productReturn.findMany({
        where: { saleId, status: { in: ["PENDENTE", "APROVADO"] } },
        include: { items: true },
      });

      let valorTotal = 0;
      const returnItems: any[] = [];

      for (const item of items) {
        const saleItem = await prisma.saleItem.findFirst({
          where: { id: item.saleItemId, saleId },
          include: { product: true },
        });
        if (!saleItem) {
          return res.status(400).json({ message: `Item ${item.saleItemId} não encontrado na venda` });
        }

        const qtdOriginal = Number(saleItem.quantidade);
        const qtdDevolver = Number(item.quantidade) || 1;

        // Check how many of this item have already been returned
        const alreadyReturned = existingReturns
          .flatMap(r => r.items)
          .filter(i => i.productId === saleItem.productId)
          .reduce((acc, i) => acc + Number(i.quantidade), 0);

        if (qtdDevolver + alreadyReturned > qtdOriginal) {
          return res.status(400).json({
            message: `Quantidade devolvida (${qtdDevolver}) + já devolvida (${alreadyReturned}) excede a quantidade original (${qtdOriginal}) para ${saleItem.product.nome}`,
          });
        }

        const preco = Number(saleItem.precoUnitarioVendido);
        const total = qtdDevolver * preco;
        valorTotal += total;

        returnItems.push({
          productId: saleItem.productId,
          quantidade: qtdDevolver,
          precoUnitario: preco,
          valorTotal: total,
        });
      }

      const ret = await prisma.productReturn.create({
        data: {
          storeId,
          saleId,
          userId,
          customerId: sale.customerId,
          motivo: motivo || null,
          valorTotal,
          status: "PENDENTE",
          items: { create: returnItems },
        },
        include: {
          items: {
            include: { product: { select: { id: true, nome: true, codigoVisual: true } } },
          },
          sale: { select: { id: true, dataVenda: true } },
          customer: { select: { id: true, nomeCompleto: true } },
          user: { select: { id: true, nome: true } },
        },
      });

      res.status(201).json(ret);
    } catch (error) {
      console.error("Erro ao criar devolução:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async approve(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const ret = await prisma.productReturn.findFirst({
        where: { id: req.params.id as string, storeId },
      });
      if (!ret) return res.status(404).json({ message: "Devolução não encontrada" });
      if (ret.status !== "PENDENTE") {
        return res.status(400).json({ message: `Não é possível aprovar devolução com status ${ret.status}` });
      }

      const updated = await prisma.productReturn.update({
        where: { id: ret.id },
        data: { status: "APROVADO" },
        include: {
          items: {
            include: { product: { select: { id: true, nome: true, codigoVisual: true } } },
          },
        },
      });

      res.json(updated);
    } catch (error) {
      console.error("Erro ao aprovar devolução:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async reject(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const motivoRejeicao = req.body?.motivoRejeicao;

      const ret = await prisma.productReturn.findFirst({
        where: { id: req.params.id as string, storeId },
      });
      if (!ret) return res.status(404).json({ message: "Devolução não encontrada" });
      if (ret.status !== "PENDENTE") {
        return res.status(400).json({ message: `Não é possível rejeitar devolução com status ${ret.status}` });
      }

      const updated = await prisma.productReturn.update({
        where: { id: ret.id },
        data: {
          status: "REJEITADO",
          motivo: motivoRejeicao ? `${ret.motivo || ""} | Rejeitado: ${motivoRejeicao}` : ret.motivo,
        },
        include: {
          items: {
            include: { product: { select: { id: true, nome: true, codigoVisual: true } } },
          },
        },
      });

      res.json(updated);
    } catch (error) {
      console.error("Erro ao rejeitar devolução:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async complete(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: "Usuário ou loja não identificados" });

      const returnId = req.params.id as string;
      const updated = await ReturnsService.completeReturn(storeId, userId, returnId);

      res.json(updated);
    } catch (error: any) {
      if (error instanceof ReturnsServiceError) {
        return res.status(error.httpCode).json({ message: error.message });
      }
      console.error("Erro ao concluir devolução:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }
}
