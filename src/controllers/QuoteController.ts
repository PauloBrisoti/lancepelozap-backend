import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { parseDate } from "../lib/dateUtils";

export class QuoteController {
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

      const [quotes, total] = await Promise.all([
        prisma.quote.findMany({
          where,
          include: {
            items: { include: { product: { select: { nome: true, codigoVisual: true } } } },
            customer: { select: { id: true, nomeCompleto: true, telefoneWhatsapp: true } },
            user: { select: { id: true, nome: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.quote.count({ where }),
      ]);

      res.json({ data: quotes, total, page, limit });
    } catch (error) {
      console.error("Erro ao listar orçamentos:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const quote = await prisma.quote.findFirst({
        where: { id: req.params.id as string, storeId },
        include: {
          items: {
            include: {
              product: { select: { id: true, nome: true, codigoVisual: true, precoCusto: true, precoVendaSugerido: true } },
            },
          },
          customer: { select: { id: true, nomeCompleto: true, telefoneWhatsapp: true, cpf: true } },
          user: { select: { id: true, nome: true } },
        },
      });

      if (!quote) return res.status(404).json({ message: "Orçamento não encontrado" });

      res.json(quote);
    } catch (error) {
      console.error("Erro ao buscar orçamento:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: "Usuário ou loja não identificados" });

      const { customerId, items, observacoes, validade } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Mínimo de 1 item no orçamento" });
      }

      const lastQuote = await prisma.quote.findFirst({
        where: { storeId },
        orderBy: { quoteNumber: "desc" },
        select: { quoteNumber: true },
      });
      const nextNumber = (lastQuote?.quoteNumber ?? 0) + 1;

      let valorTotalBruto = 0;
      const quoteItems: any[] = [];

      for (const item of items) {
        const product = await prisma.product.findFirst({
          where: { id: item.productId, storeId },
        });
        if (!product) {
          return res.status(400).json({ message: `Produto ${item.productId} não encontrado` });
        }

        const qtd = Number(item.quantidade) || 1;
        const preco = Number(item.precoUnitario) || Number(product.precoVendaSugerido);
        const total = qtd * preco;

        valorTotalBruto += total;
        quoteItems.push({
          productId: product.id,
          quantidade: qtd,
          precoUnitario: preco,
          valorTotal: total,
          observacao: item.observacao || null,
        });
      }

      const valorDesconto = Number(req.body.valorDesconto) || 0;
      const valorTotalLiquido = valorTotalBruto - valorDesconto;

      const quote = await prisma.quote.create({
        data: {
          storeId,
          userId,
          customerId: customerId || null,
          quoteNumber: nextNumber,
          valorTotalBruto,
          valorDesconto,
          valorTotalLiquido,
          observacoes: observacoes || null,
          validade: parseDate(validade),
          items: { create: quoteItems },
        },
        include: {
          items: {
            include: {
              product: { select: { id: true, nome: true, codigoVisual: true } },
            },
          },
          customer: { select: { id: true, nomeCompleto: true } },
          user: { select: { id: true, nome: true } },
        },
      });

      res.status(201).json(quote);
    } catch (error) {
      console.error("Erro ao criar orçamento:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const existing = await prisma.quote.findFirst({
        where: { id: req.params.id as string, storeId },
      });
      if (!existing) return res.status(404).json({ message: "Orçamento não encontrado" });
      if (existing.status !== "RASCUNHO" && existing.status !== "ENVIADO") {
        return res.status(400).json({ message: `Não é possível editar orçamento com status ${existing.status}` });
      }

      const { customerId, items, observacoes, validade, valorDesconto: rawDesconto } = req.body;

      await prisma.quoteItem.deleteMany({ where: { quoteId: existing.id } });

      let valorTotalBruto = 0;
      const quoteItems: any[] = [];

      if (items && Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          const product = await prisma.product.findFirst({
            where: { id: item.productId, storeId },
          });
          if (!product) {
            return res.status(400).json({ message: `Produto ${item.productId} não encontrado` });
          }

          const qtd = Number(item.quantidade) || 1;
          const preco = Number(item.precoUnitario) || Number(product.precoVendaSugerido);
          const total = qtd * preco;

          valorTotalBruto += total;
          quoteItems.push({
            productId: product.id,
            quantidade: qtd,
            precoUnitario: preco,
            valorTotal: total,
            observacao: item.observacao || null,
          });
        }
      }

      const valorDesconto = Number(rawDesconto) || 0;
      const valorTotalLiquido = valorTotalBruto - valorDesconto;

      const quote = await prisma.quote.update({
        where: { id: existing.id },
        data: {
          customerId: customerId !== undefined ? (customerId || null) : existing.customerId,
          valorTotalBruto,
          valorDesconto,
          valorTotalLiquido,
          observacoes: observacoes !== undefined ? (observacoes || null) : existing.observacoes,
          validade: validade !== undefined ? (validade ? parseDate(validade) : null) : existing.validade,
          items: { create: quoteItems },
        },
        include: {
          items: {
            include: {
              product: { select: { id: true, nome: true, codigoVisual: true } },
            },
          },
          customer: { select: { id: true, nomeCompleto: true } },
          user: { select: { id: true, nome: true } },
        },
      });

      res.json(quote);
    } catch (error) {
      console.error("Erro ao atualizar orçamento:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async updateStatus(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const { status } = req.body;
      const validStatuses = ["RASCUNHO", "ENVIADO", "APROVADO", "CANCELADO", "VENCIDO"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: `Status inválido. Use: ${validStatuses.join(", ")}` });
      }

      const existing = await prisma.quote.findFirst({
        where: { id: req.params.id as string, storeId },
      });
      if (!existing) return res.status(404).json({ message: "Orçamento não encontrado" });
      if (existing.status === "CONVERTIDO" || existing.status === "CANCELADO") {
        return res.status(400).json({ message: `Orçamento ${existing.status} não pode ser alterado` });
      }

      const quote = await prisma.quote.update({
        where: { id: existing.id },
        data: { status },
        include: {
          items: {
            include: {
              product: { select: { id: true, nome: true, codigoVisual: true } },
            },
          },
          customer: { select: { id: true, nomeCompleto: true } },
        },
      });

      res.json(quote);
    } catch (error) {
      console.error("Erro ao atualizar status do orçamento:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const existing = await prisma.quote.findFirst({
        where: { id: req.params.id as string, storeId },
      });
      if (!existing) return res.status(404).json({ message: "Orçamento não encontrado" });
      if (existing.status === "CONVERTIDO") {
        return res.status(400).json({ message: "Orçamento convertido em venda não pode ser excluído" });
      }

      await prisma.quote.delete({ where: { id: existing.id } });

      res.status(204).send();
    } catch (error) {
      console.error("Erro ao excluir orçamento:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async convertToSale(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: "Usuário ou loja não identificados" });

      const quote = await prisma.quote.findFirst({
        where: { id: req.params.id as string, storeId },
        include: { items: true },
      });
      if (!quote) return res.status(404).json({ message: "Orçamento não encontrado" });
      if (quote.status === "CONVERTIDO") return res.status(400).json({ message: "Orçamento já convertido" });
      if (quote.status === "CANCELADO") return res.status(400).json({ message: "Orçamento cancelado não pode ser convertido" });

      const {
        formaPagamento = "PIX",
        valorSinal = 0,
        numeroParcelas = 1,
        cashRegisterId,
        valorDesconto: extraDesconto = 0,
      } = req.body;

      const totalDesconto = Number(quote.valorDesconto) + Number(extraDesconto);
      const valorFinalLiquido = Number(quote.valorTotalBruto) - totalDesconto;

      const sale = await prisma.sale.create({
        data: {
          storeId,
          cashRegisterId: cashRegisterId || null,
          userId,
          customerId: quote.customerId,
          dataVenda: new Date(),
          valorTotalBruto: quote.valorTotalBruto,
          valorDesconto: totalDesconto,
          valorTotalLiquido: valorFinalLiquido,
          formaPagamento,
          valorSinal,
          numeroParcelas,
          status: "FINALIZADA",
          observacoes: quote.observacoes,
          saleItems: {
            create: quote.items.map((item: any) => ({
              productId: item.productId,
              quantidade: item.quantidade,
              precoUnitarioVendido: item.precoUnitario,
              custoUnitarioHistorico: 0,
            })),
          },
        },
        include: {
          saleItems: {
            include: {
              product: { select: { id: true, nome: true } },
            },
          },
          customer: { select: { id: true, nomeCompleto: true } },
        },
      });

      await prisma.quote.update({
        where: { id: quote.id },
        data: { status: "CONVERTIDO" },
      });

      res.status(201).json({ sale, quoteId: quote.id });
    } catch (error) {
      console.error("Erro ao converter orçamento em venda:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }
}
