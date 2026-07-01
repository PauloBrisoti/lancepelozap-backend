import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

export class PurchaseOrderController {
  async list(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const status = req.query.status as string | undefined;
      const search = req.query.search as string | undefined;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      const where: any = { storeId };
      if (status) where.status = status;
      if (search) {
        where.supplier = { nome: { contains: search, mode: "insensitive" } };
      }

      const [orders, total] = await Promise.all([
        prisma.purchaseOrder.findMany({
          where,
          include: {
            items: {
              include: {
                product: { select: { id: true, nome: true, codigoVisual: true } },
              },
            },
            user: { select: { id: true, nome: true } },
            supplier: { select: { id: true, nome: true, cnpjCpf: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.purchaseOrder.count({ where }),
      ]);

      res.json({ data: orders, total, page, limit });
    } catch (error) {
      console.error("Erro ao listar compras:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const order = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id as string, storeId },
        include: {
          items: {
            include: {
              product: {
                select: { id: true, nome: true, codigoVisual: true, precoCusto: true, precoVendaSugerido: true, qtdEstoqueAtual: true },
              },
            },
          },
          user: { select: { id: true, nome: true } },
          supplier: { select: { id: true, nome: true, cnpjCpf: true } },
        },
      });

      if (!order) return res.status(404).json({ message: "Pedido não encontrado" });

      res.json(order);
    } catch (error) {
      console.error("Erro ao buscar pedido:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: "Usuário ou loja não identificados" });

      const { supplierId, items, dataPrevisao, observacoes, valorDesconto } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Mínimo de 1 item no pedido" });
      }

      const lastOrder = await prisma.purchaseOrder.findFirst({
        where: { storeId },
        orderBy: { orderNumber: "desc" },
        select: { orderNumber: true },
      });
      const nextNumber = (lastOrder?.orderNumber ?? 0) + 1;

      let valorTotalBruto = 0;
      const orderItems: any[] = [];

      for (const item of items) {
        const product = await prisma.product.findFirst({
          where: { id: item.productId, storeId },
        });
        if (!product) {
          return res.status(400).json({ message: `Produto ${item.productId} não encontrado` });
        }

        const qtd = Number(item.quantidade) || 1;
        const preco = Number(item.precoUnitario) || 0;
        const total = qtd * preco;

        valorTotalBruto += total;
        orderItems.push({
          productId: product.id,
          quantidade: qtd,
          precoUnitario: preco,
          valorTotal: total,
          observacao: item.observacao || null,
        });
      }

      const desconto = Number(valorDesconto) || 0;
      const valorTotalLiquido = valorTotalBruto - desconto;

      const order = await prisma.purchaseOrder.create({
        data: {
          storeId,
          userId,
          supplierId: supplierId || null,
          orderNumber: nextNumber,
          dataPrevisao: dataPrevisao ? new Date(dataPrevisao) : null,
          valorTotalBruto,
          valorDesconto: desconto,
          valorTotalLiquido,
          observacoes: observacoes || null,
          items: { create: orderItems },
        },
        include: {
          items: {
            include: {
              product: { select: { id: true, nome: true, codigoVisual: true } },
            },
          },
          user: { select: { id: true, nome: true } },
          supplier: { select: { id: true, nome: true, cnpjCpf: true } },
        },
      });

      res.status(201).json(order);
    } catch (error) {
      console.error("Erro ao criar pedido:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const existing = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id as string, storeId },
      });
      if (!existing) return res.status(404).json({ message: "Pedido não encontrado" });
      if (existing.status !== "RASCUNHO" && existing.status !== "PENDENTE") {
        return res.status(400).json({ message: `Não é possível editar pedido com status ${existing.status}` });
      }

      const { supplierId, items, dataPrevisao, observacoes, valorDesconto: rawDesconto } = req.body;

      await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: existing.id } });

      let valorTotalBruto = 0;
      const orderItems: any[] = [];

      if (items && Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          const product = await prisma.product.findFirst({
            where: { id: item.productId, storeId },
          });
          if (!product) {
            return res.status(400).json({ message: `Produto ${item.productId} não encontrado` });
          }

          const qtd = Number(item.quantidade) || 1;
          const preco = Number(item.precoUnitario) || 0;
          const total = qtd * preco;

          valorTotalBruto += total;
          orderItems.push({
            productId: product.id,
            quantidade: qtd,
            precoUnitario: preco,
            valorTotal: total,
            observacao: item.observacao || null,
          });
        }
      }

      const desconto = Number(rawDesconto) || 0;
      const valorTotalLiquido = valorTotalBruto - desconto;

      const order = await prisma.purchaseOrder.update({
        where: { id: existing.id },
        data: {
          supplierId: supplierId !== undefined ? (supplierId || null) : existing.supplierId,
          dataPrevisao: dataPrevisao !== undefined ? (dataPrevisao ? new Date(dataPrevisao) : null) : existing.dataPrevisao,
          valorTotalBruto,
          valorDesconto: desconto,
          valorTotalLiquido,
          observacoes: observacoes !== undefined ? (observacoes || null) : existing.observacoes,
          items: { create: orderItems },
        },
          include: {
          items: {
            include: {
              product: { select: { id: true, nome: true, codigoVisual: true } },
            },
          },
          user: { select: { id: true, nome: true } },
          supplier: { select: { id: true, nome: true, cnpjCpf: true } },
        },
      });

      res.json(order);
    } catch (error) {
      console.error("Erro ao atualizar pedido:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async updateStatus(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const { status } = req.body;
      const validStatuses = ["RASCUNHO", "PENDENTE", "CANCELADO"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: `Status inválido. Use: ${validStatuses.join(", ")}` });
      }

      const existing = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id as string, storeId },
      });
      if (!existing) return res.status(404).json({ message: "Pedido não encontrado" });
      if (existing.status === "RECEBIDO" || existing.status === "CANCELADO") {
        return res.status(400).json({ message: `Pedido ${existing.status} não pode ser alterado` });
      }

      const order = await prisma.purchaseOrder.update({
        where: { id: existing.id },
        data: { status },
        include: {
          items: {
            include: {
              product: { select: { id: true, nome: true, codigoVisual: true } },
            },
          },
        },
      });

      res.json(order);
    } catch (error) {
      console.error("Erro ao atualizar status:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async receive(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: "Usuário ou loja não identificados" });

      const existing = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id as string, storeId },
        include: { items: true },
      });
      if (!existing) return res.status(404).json({ message: "Pedido não encontrado" });
      if (existing.status === "CANCELADO") return res.status(400).json({ message: "Pedido cancelado" });
      if (existing.status === "RECEBIDO") return res.status(400).json({ message: "Pedido já totalmente recebido" });

      const { itens: receivedItems } = req.body;

      if (!receivedItems || !Array.isArray(receivedItems) || receivedItems.length === 0) {
        return res.status(400).json({ message: "Informe os itens recebidos" });
      }

      // Process each received item
      for (const received of receivedItems) {
        const orderItem = existing.items.find(i => i.id === received.itemId);
        if (!orderItem) {
          return res.status(400).json({ message: `Item ${received.itemId} não encontrado no pedido` });
        }

        const qtdReceber = Number(received.quantidadeRecebida) || 0;
        if (qtdReceber <= 0) continue;

        const novaQtdRecebida = Number(orderItem.quantidadeRecebida) + qtdReceber;
        if (novaQtdRecebida > Number(orderItem.quantidade)) {
          return res.status(400).json({
            message: `Quantidade recebida (${novaQtdRecebida}) excede a quantidade do pedido (${orderItem.quantidade}) para o item ${orderItem.id}`,
          });
        }

        // Update quantidadeRecebida on the order item
        await prisma.purchaseOrderItem.update({
          where: { id: orderItem.id },
          data: { quantidadeRecebida: novaQtdRecebida },
        });

        // Update product stock
        const product = await prisma.product.findUnique({
          where: { id: orderItem.productId },
        });
        if (!product) continue;

        const saldoAnterior = Number(product.qtdEstoqueAtual);
        const saldoPosterior = saldoAnterior + qtdReceber;

        // Calculate new average cost
        const custoAnteriorTotal = saldoAnterior * Number(product.precoCusto);
        const custoEntradaTotal = qtdReceber * Number(orderItem.precoUnitario);
        const novoCustoMedio = saldoPosterior > 0
          ? (custoAnteriorTotal + custoEntradaTotal) / saldoPosterior
          : Number(orderItem.precoUnitario);

        await prisma.product.update({
          where: { id: product.id },
          data: {
            qtdEstoqueAtual: saldoPosterior,
            precoCusto: novoCustoMedio,
          },
        });

        // Create stock movement
        await prisma.stockMovement.create({
          data: {
            storeId,
            productId: product.id,
            userId,
            tipo: "ENTRADA",
            quantidade: qtdReceber,
            saldoAnterior,
            saldoPosterior,
            referenciaId: existing.id,
            observacao: `Recebimento do pedido #${existing.orderNumber}`,
          },
        });
      }

      // Check if fully received
      const updatedItems = await prisma.purchaseOrderItem.findMany({
        where: { purchaseOrderId: existing.id },
      });
      const allReceived = updatedItems.every(
        i => Number(i.quantidadeRecebida) >= Number(i.quantidade)
      );
      const anyReceived = updatedItems.some(i => Number(i.quantidadeRecebida) > 0);

      let newStatus = existing.status;
      if (allReceived) newStatus = "RECEBIDO";
      else if (anyReceived) newStatus = "PARCIAL";

      const order = await prisma.purchaseOrder.update({
        where: { id: existing.id },
        data: { status: newStatus },
        include: {
          items: {
            include: {
              product: { select: { id: true, nome: true, codigoVisual: true, qtdEstoqueAtual: true } },
            },
          },
        },
      });

      res.json(order);
    } catch (error) {
      console.error("Erro ao receber pedido:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const existing = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id as string, storeId },
      });
      if (!existing) return res.status(404).json({ message: "Pedido não encontrado" });
      if (existing.status === "RECEBIDO" || existing.status === "PARCIAL") {
        return res.status(400).json({ message: "Pedido com itens recebidos não pode ser excluído" });
      }

      await prisma.purchaseOrder.delete({ where: { id: existing.id } });

      res.status(204).send();
    } catch (error) {
      console.error("Erro ao excluir pedido:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }
}
