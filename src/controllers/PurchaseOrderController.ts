import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

// Contrato de Requisitos - Motor Financeiro (seção 3 e 2.4)
// Âncora o dia do vencimento ao dia de faturamento do cartão (sem estourar o mês)
function clampDay(date: Date, day: number): Date {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const d = new Date(date);
  d.setDate(Math.min(day, lastDay));
  return d;
}

// Primeiro vencimento: usa o informado ou deriva da data da compra + dia do cartão
function firstDueDate(compraDate: Date, primeiroVencimento?: string, cardDay?: number): Date {
  let d: Date;
  if (primeiroVencimento) {
    d = new Date(primeiroVencimento + "T00:00:00");
    if (cardDay) d = clampDay(d, cardDay);
  } else if (cardDay) {
    d = clampDay(new Date(compraDate), cardDay);
    if (d.getTime() < compraDate.getTime()) {
      d.setMonth(d.getMonth() + 1);
      d = clampDay(d, cardDay);
    }
  } else {
    d = new Date(compraDate);
  }
  return d;
}

export class PurchaseOrderController {
  async listCreditCards(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const cards = await prisma.creditCard.findMany({
        where: { storeId, ativo: true },
        orderBy: { nome: "asc" },
      });
      res.json(cards);
    } catch (error) {
      console.error("Erro ao listar cartões:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

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
            customer: { select: { id: true, nomeCompleto: true, telefoneWhatsapp: true } },
            accountsPayable: { select: { status: true }, where: { status: { not: "CANCELADO" } } },
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
          customer: { select: { id: true, nomeCompleto: true, telefoneWhatsapp: true } },
          accountsPayable: { orderBy: { numeroParcela: "asc" } },
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

      const { supplierId, customerId, items, dataPedido, dataPrevisao, observacoes, valorDesconto, valorVenda, valorEntrada, walletIdEntrada, numeroParcelas, creditCardId, primeiroVencimento, formaPagamento, valorFrete } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Mínimo de 1 item no pedido" });
      }

      // Data da compra (competência) — editável para lançamento retroativo (contrato 2.4).
      // A data do lançamento (createdAt) é automática e imutável.
      const compraDate = dataPedido ? new Date(String(dataPedido) + "T00:00:00") : new Date();
      if (isNaN(compraDate.getTime())) {
        return res.status(400).json({ message: "Data da compra inválida" });
      }

      const forma = (formaPagamento || (Number(numeroParcelas) > 1 ? "PARCELADO_FORNECEDOR" : "A_VISTA")) as string;
      if (!["A_VISTA", "PARCELADO_FORNECEDOR", "CARTAO_CREDITO"].includes(forma)) {
        return res.status(400).json({ message: "Forma de pagamento inválida. Use: A_VISTA, PARCELADO_FORNECEDOR ou CARTAO_CREDITO" });
      }

      let card: any = null;
      if (forma === "CARTAO_CREDITO") {
        if (!creditCardId) {
          return res.status(400).json({ message: "Selecione o cartão de crédito da loja" });
        }
        card = await prisma.creditCard.findFirst({ where: { id: creditCardId, storeId } });
        if (!card) {
          return res.status(400).json({ message: "Cartão de crédito não encontrado" });
        }
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
      const entradaValor = Number(valorEntrada) || 0;
      const parcelasTotal = Math.max(1, Number(numeroParcelas) || 1);
      const freteValor = Number(valorFrete) || 0;

      // A_VISTA: saída imediata do caixa. Parcelado/Cartão: saída ZERO no ato (contrato 3.2).
      const pagamentoAVista = forma === "A_VISTA" ? valorTotalLiquido : 0;
      const valorPagoAgora = pagamentoAVista || entradaValor;

      if (forma === "A_VISTA" && !walletIdEntrada) {
        return res.status(400).json({ message: "Selecione a carteira de pagamento" });
      }
      if (forma === "A_VISTA" && parcelasTotal > 1) {
        return res.status(400).json({ message: "À vista não admite parcelas" });
      }
      if (forma !== "A_VISTA" && !primeiroVencimento && forma === "PARCELADO_FORNECEDOR" && parcelasTotal > 1) {
        return res.status(400).json({ message: "Informe o primeiro vencimento" });
      }

      const firstDue = firstDueDate(compraDate, primeiroVencimento, forma === "CARTAO_CREDITO" ? card.diaVencimento : undefined);
      if (firstDue.getTime() < compraDate.getTime()) {
        return res.status(400).json({ message: "Primeiro vencimento não pode ser anterior à data da compra" });
      }

      const order = await prisma.purchaseOrder.create({
        data: {
          storeId,
          userId,
          supplierId: supplierId || null,
          customerId: customerId || null,
          orderNumber: nextNumber,
          dataPedido: compraDate,
          dataPrevisao: dataPrevisao ? new Date(dataPrevisao) : null,
          formaPagamento: forma,
          valorFrete: freteValor,
          valorTotalBruto,
          valorDesconto: desconto,
          valorTotalLiquido,
          valorVenda: valorVenda ? Number(valorVenda) : null,
          valorEntrada: entradaValor > 0 ? entradaValor : null,
          walletIdEntrada: walletIdEntrada || null,
          numeroParcelas: parcelasTotal > 1 ? parcelasTotal : null,
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
          customer: { select: { id: true, nomeCompleto: true, telefoneWhatsapp: true } },
        },
      });

      if (valorPagoAgora > 0 && walletIdEntrada) {
        const wallet = await prisma.wallet.findFirst({
          where: { id: walletIdEntrada, storeId },
        });
        if (!wallet) {
          return res.status(400).json({ message: "Carteira nao encontrada" });
        }
        if (Number(wallet.saldoAtual) < valorPagoAgora) {
          return res.status(400).json({ message: "Saldo insuficiente na carteira" });
        }

        await prisma.wallet.update({
          where: { id: walletIdEntrada },
          data: { saldoAtual: { decrement: valorPagoAgora } },
        });

        await prisma.financialTransaction.create({
          data: {
            storeId,
            walletId: walletIdEntrada,
            tipo: "SAIDA",
            valor: valorPagoAgora,
            descricao: pagamentoAVista
              ? "Pagamento do pedido #" + nextNumber
              : "Entrada do pedido #" + nextNumber,
            categoria: "PAGAMENTO_FORNECEDOR",
            supplierId: supplierId || null,
            dataTransacao: compraDate,
            status: "ATIVA",
          },
        });

        await prisma.accountPayable.create({
          data: {
            storeId,
            descricao: pagamentoAVista
              ? "Pagamento do pedido #" + nextNumber
              : "Entrada do pedido #" + nextNumber,
            supplierId: supplierId || null,
            creditCardId: creditCardId || null,
            purchaseOrderId: order.id,
            numeroParcela: 1,
            totalParcelas: parcelasTotal,
            dataVencimento: compraDate,
            valor: valorPagoAgora,
            status: "PAGO",
          },
        });
      }

      const remaining = Number(order.valorTotalLiquido) - valorPagoAgora;
      if (remaining > 0) {
        const startIndex = entradaValor > 0 ? 2 : 1;
        const numParcelas = parcelasTotal - startIndex + 1;
        const installmentValue = Math.round((remaining / numParcelas) * 100) / 100;
        const ultimaParcelaValue = Math.round((remaining - installmentValue * (numParcelas - 1)) * 100) / 100;
        for (let i = startIndex; i <= parcelasTotal; i++) {
          const dueDate = new Date(firstDue);
          dueDate.setMonth(dueDate.getMonth() + (i - startIndex));
          const finalDue = forma === "CARTAO_CREDITO" ? clampDay(dueDate, card.diaVencimento) : dueDate;
          await prisma.accountPayable.create({
            data: {
              storeId,
              descricao: (parcelasTotal > 1 ? "Parcela " + i + "/" + parcelasTotal + " do pedido #" + nextNumber : "Pagamento do pedido #" + nextNumber),
              supplierId: supplierId || null,
              creditCardId: creditCardId || null,
              purchaseOrderId: order.id,
              numeroParcela: i,
              totalParcelas: parcelasTotal,
              dataVencimento: finalDue,
              valor: i === parcelasTotal ? ultimaParcelaValue : installmentValue,
              status: "PENDENTE",
            },
          });
        }
      }

      if (customerId) {
        for (const item of items) {
          await prisma.product.update({
            where: { id: item.productId },
            data: {
              status: "ENCOMENDA",
              dataPedido: new Date(),
              previsaoChegada: dataPrevisao ? new Date(dataPrevisao) : undefined,
            },
          });
        }
      }

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

      const { supplierId, customerId, items, dataPrevisao, observacoes, valorDesconto: rawDesconto, valorVenda } = req.body;

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
          customerId: customerId !== undefined ? (customerId || null) : existing.customerId,
          dataPrevisao: dataPrevisao !== undefined ? (dataPrevisao ? new Date(dataPrevisao) : null) : existing.dataPrevisao,
          valorTotalBruto,
          valorDesconto: desconto,
          valorTotalLiquido,
          valorVenda: valorVenda !== undefined ? Number(valorVenda) : existing.valorVenda,
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
          customer: { select: { id: true, nomeCompleto: true, telefoneWhatsapp: true } },
        },
      });

      const finalCustomerId = customerId !== undefined ? customerId : existing.customerId;
      if (finalCustomerId && items && Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          await prisma.product.update({
            where: { id: item.productId },
            data: {
              status: "ENCOMENDA",
              dataPedido: new Date(),
              previsaoChegada: dataPrevisao ? new Date(dataPrevisao) : undefined,
            },
          });
        }
      }

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

      if (status === "CANCELADO" && existing.status !== "CANCELADO") {
        await prisma.accountPayable.updateMany({
          where: { purchaseOrderId: existing.id },
          data: { status: "CANCELADO" },
        });

        // Refund valorEntrada if there was a down payment
        if (existing.valorEntrada && existing.walletIdEntrada) {
          const refundValue = Number(existing.valorEntrada);
          const wallet = await prisma.wallet.findFirst({
            where: { id: existing.walletIdEntrada, storeId },
          });
          if (wallet) {
            await prisma.wallet.update({
              where: { id: existing.walletIdEntrada },
              data: { saldoAtual: { increment: refundValue } },
            });
            await prisma.financialTransaction.create({
              data: {
                storeId,
                walletId: existing.walletIdEntrada,
                tipo: "ENTRADA",
                valor: refundValue,
                descricao: "Estorno entrada pedido #" + existing.orderNumber,
                categoria: "ESTORNO",
                status: "ATIVA",
              },
            });
          }
        }
      }

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

      const isCustomerOrder = Boolean(existing.customerId);

      // Frete de compra agrega ao custo do estoque (contrato 2.2) — rateio proporcional ao valor recebido
      const freteValor = Number(existing.valorFrete) || 0;
      let totalRecebidoValor = 0;
      for (const received of receivedItems) {
        const orderItem = existing.items.find(i => i.id === received.itemId);
        if (!orderItem) continue;
        const qtdReceber = Number(received.quantidadeRecebida) || 0;
        if (qtdReceber <= 0) continue;
        totalRecebidoValor += qtdReceber * Number(orderItem.precoUnitario);
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

        if (isCustomerOrder) {
          // Customer-specific order: reserve product, don't add to general stock
          await prisma.product.update({
            where: { id: product.id },
            data: {
              status: "ENCOMENDA",
              dataPedido: existing.dataPedido,
              previsaoChegada: existing.dataPrevisao,
            },
          });
          // Still record a stock movement for audit, but stock didn't change
          await prisma.stockMovement.create({
            data: {
              storeId,
              productId: product.id,
              userId,
              tipo: "ENTRADA",
              quantidade: qtdReceber,
              saldoAnterior: Number(product.qtdEstoqueAtual),
              saldoPosterior: Number(product.qtdEstoqueAtual),
              referenciaId: existing.id,
              observacao: `Encomenda para cliente #${existing.orderNumber}`,
            },
          });
        } else {
          const saldoAnterior = Number(product.qtdEstoqueAtual);
          const saldoPosterior = saldoAnterior + qtdReceber;

          // Calculate new average cost (frete de compra capitalizado no custo de aquisição)
          const freteShare = totalRecebidoValor > 0
            ? (qtdReceber * Number(orderItem.precoUnitario) / totalRecebidoValor) * freteValor
            : 0;
          const custoAnteriorTotal = saldoAnterior * Number(product.precoCusto);
          const custoEntradaTotal = qtdReceber * Number(orderItem.precoUnitario) + freteShare;
          const novoCustoMedio = saldoPosterior > 0
            ? (custoAnteriorTotal + custoEntradaTotal) / saldoPosterior
            : Number(orderItem.precoUnitario) + (qtdReceber > 0 ? freteShare / qtdReceber : 0);

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

  async revert(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: "Usuário ou loja não identificados" });

      const existing = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id as string, storeId },
        include: {
          items: true,
          accountsPayable: { select: { id: true, status: true } },
        },
      });
      if (!existing) return res.status(404).json({ message: "Pedido não encontrado" });
      if (existing.status !== "RECEBIDO" && existing.status !== "PARCIAL") {
        return res.status(400).json({ message: "Apenas pedidos com status RECEBIDO ou PARCIAL podem ser revertidos" });
      }

      await prisma.$transaction(async (tx) => {
        // 1. Validate current stock >= received quantity for each item
        for (const item of existing.items) {
          const qtdRecebida = Number(item.quantidadeRecebida);
          if (qtdRecebida <= 0) continue;

          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (!product) throw new Error("Produto nao encontrado: " + item.productId);

          const estoqueAtual = Number(product.qtdEstoqueAtual);
          if (estoqueAtual < qtdRecebida) {
            throw new Error("Operacao negada: Estoque atual de " + product.id + " (" + estoqueAtual + ") insuficiente para reverter " + qtdRecebida + " unidades.");
          }

          // Desfaz a média ponderada calculada no receive(): reconstitui o custo
          // que existia antes daquela entrada, a partir do custo médio atual.
          const saldoPosterior = estoqueAtual;
          const saldoAnteriorAoRecebimento = saldoPosterior - qtdRecebida;
          const custoEntradaTotal = qtdRecebida * Number(item.precoUnitario);
          const custoMedioAtual = Number(product.precoCusto);
          const custoAnteriorReconstituido = saldoAnteriorAoRecebimento > 0
            ? (custoMedioAtual * saldoPosterior - custoEntradaTotal) / saldoAnteriorAoRecebimento
            : custoMedioAtual;

          // 2. Decrement stock and restore the pre-receipt weighted average cost
          await tx.product.update({
            where: { id: item.productId },
            data: {
              qtdEstoqueAtual: { decrement: qtdRecebida },
              precoCusto: Math.max(0, custoAnteriorReconstituido),
            },
          });

          // 3. Record stock movement
          await tx.stockMovement.create({
            data: {
              storeId,
              productId: item.productId,
              userId,
              tipo: "SAIDA",
              quantidade: qtdRecebida,
              saldoAnterior: estoqueAtual,
              saldoPosterior: estoqueAtual - qtdRecebida,
              referenciaId: existing.id,
              observacao: "Reversao do recebimento do pedido #" + existing.orderNumber,
            },
          });

          // 4. Reset quantidadeRecebida on the order item
          await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: { quantidadeRecebida: 0 },
          });
        }

        // 5. Cancel all non-canceled payables
        await tx.accountPayable.updateMany({
          where: { purchaseOrderId: existing.id, status: { not: "CANCELADO" } },
          data: { status: "CANCELADO" },
        });

        // 6. Refund valorEntrada if applicable
        if (existing.valorEntrada && existing.walletIdEntrada) {
          const refundValue = Number(existing.valorEntrada);
          await tx.wallet.update({
            where: { id: existing.walletIdEntrada },
            data: { saldoAtual: { increment: refundValue } },
          });
          await tx.financialTransaction.create({
            data: {
              storeId,
              walletId: existing.walletIdEntrada,
              tipo: "ENTRADA",
              valor: refundValue,
              descricao: "Estorno reversao pedido #" + existing.orderNumber,
              categoria: "ESTORNO",
              status: "ATIVA",
            },
          });
        }

        // 7. Update purchase order status to RASCUNHO
        await tx.purchaseOrder.update({
          where: { id: existing.id },
          data: { status: "RASCUNHO" },
        });
      });

      const order = await prisma.purchaseOrder.findFirst({
        where: { id: existing.id },
        include: {
          items: {
            include: {
              product: { select: { id: true, nome: true, codigoVisual: true, qtdEstoqueAtual: true } },
            },
          },
        },
      });

      res.json(order);
    } catch (error: any) {
      console.error("Erro ao reverter pedido:", error);
      if (error.message && error.message.startsWith("Operacao negada:")) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  // Faturas do cartão (contrato 3.3): parcelas abertas agrupadas por cartão + mês de vencimento
  async cardInvoices(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const cards = await prisma.creditCard.findMany({
        where: { storeId, ativo: true },
        orderBy: { nome: "asc" },
      });

      const payables = await prisma.accountPayable.findMany({
        where: { storeId, creditCardId: { not: null }, status: { in: ["PENDENTE"] } },
        orderBy: { dataVencimento: "asc" },
        include: { purchaseOrder: { select: { orderNumber: true } } },
      });

      const invoices: any[] = [];
      for (const card of cards) {
        const doCard = payables.filter(p => p.creditCardId === card.id);
        const byMonth = new Map<string, any>();
        for (const p of doCard) {
          const mes = `${p.dataVencimento.getFullYear()}-${String(p.dataVencimento.getMonth() + 1).padStart(2, "0")}`;
          const entry = byMonth.get(mes) || { mes, total: 0, parcelas: 0, vencimento: p.dataVencimento };
          entry.total += Number(p.valor);
          entry.parcelas += 1;
          if (p.dataVencimento.getTime() > entry.vencimento.getTime()) entry.vencimento = p.dataVencimento;
          byMonth.set(mes, entry);
        }
        const meses = Array.from(byMonth.values()).sort((a, b) => a.mes.localeCompare(b.mes));
        if (meses.length > 0) {
          invoices.push({ card: { id: card.id, nome: card.nome, bandeira: card.bandeira, diaVencimento: card.diaVencimento }, meses });
        }
      }

      res.json(invoices);
    } catch (error) {
      console.error("Erro ao listar faturas:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  // Baixa em lote da fatura (contrato 3.3): paga todas as parcelas pendentes do cartão no mês
  async payCardInvoice(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Loja não identificada" });

      const cardId = req.params.id as string;
      const { mes, walletId } = req.body;

      if (!mes || !/^\d{4}-\d{2}$/.test(String(mes))) {
        return res.status(400).json({ message: "Informe o mês da fatura (AAAA-MM)" });
      }
      if (!walletId) {
        return res.status(400).json({ message: "Selecione a carteira para pagamento" });
      }

      const card = await prisma.creditCard.findFirst({ where: { id: cardId, storeId } });
      if (!card) return res.status(404).json({ message: "Cartão não encontrado" });

      const wallet = await prisma.wallet.findFirst({ where: { id: walletId, storeId } });
      if (!wallet) return res.status(400).json({ message: "Carteira não encontrada" });

      const [ano, m] = String(mes).split("-").map(Number);
      const payables = await prisma.accountPayable.findMany({
        where: { storeId, creditCardId: cardId, status: "PENDENTE" },
      });
      const daFatura = payables.filter(p => {
        return p.dataVencimento.getFullYear() === ano && p.dataVencimento.getMonth() + 1 === m;
      });

      if (daFatura.length === 0) {
        return res.status(400).json({ message: "Nenhuma parcela pendente para esta fatura" });
      }

      const total = daFatura.reduce((acc, p) => acc + Number(p.valor), 0);
      if (Number(wallet.saldoAtual) < total) {
        return res.status(400).json({ message: `Saldo insuficiente na carteira: necessário R$ ${total.toFixed(2)}` });
      }

      await prisma.$transaction(async (tx) => {
        for (const p of daFatura) {
          await tx.financialTransaction.create({
            data: {
              storeId,
              walletId,
              tipo: "SAIDA",
              valor: Number(p.valor),
              descricao: `Pagamento fatura ${card.nome} ${mes} — ${p.descricao}`,
              categoria: "PAGAMENTO_CARTAO",
              supplierId: p.supplierId || undefined,
              status: "ATIVA",
            },
          });
          await tx.accountPayable.update({
            where: { id: p.id },
            data: { status: "PAGO" },
          });
          await tx.wallet.update({
            where: { id: walletId },
            data: { saldoAtual: { decrement: Number(p.valor) } },
          });
        }
      });

      res.json({ message: `Fatura ${mes} paga (${daFatura.length} parcelas, R$ ${total.toFixed(2)})` });
    } catch (error) {
      console.error("Erro ao pagar fatura:", error);
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

      // Contrato 3.5: compra com parcela paga não pode ser excluída — só compensada
      const parcelaPaga = await prisma.accountPayable.findFirst({
        where: { purchaseOrderId: existing.id, status: "PAGO" },
        select: { id: true },
      });
      if (parcelaPaga) {
        return res.status(400).json({ message: "Pedido com parcela paga não pode ser excluído — cancele as parcelas antes ou registre um ajuste" });
      }

      await prisma.purchaseOrder.delete({ where: { id: existing.id } });

      res.status(204).send();
    } catch (error) {
      console.error("Erro ao excluir pedido:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }
}
