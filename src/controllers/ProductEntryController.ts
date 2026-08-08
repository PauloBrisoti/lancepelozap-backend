import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { StockMovementService } from "../services/StockMovementService";
import { asyncHandler, getStoreId } from "../lib/asyncHandler";

export class ProductEntryController {
  list = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);

    const entries = await prisma.productEntry.findMany({
      where: { storeId },
      include: {
        items: {
          include: {
            product: {
              select: { nome: true, codigoVisual: true }
            }
          }
        },
        supplier: { select: { id: true, nome: true } }
      },
      orderBy: { dataEntrada: 'desc' }
    });

    res.json(entries);
  }, "listar entradas de produto");

  create = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const userId = req.user?.id as string;
    if (!userId) {
      return res.status(401).json({ message: "Usuário ou loja não identificados" });
    }

    const { fornecedor, supplierId, valorFreteTotal, itens } = req.body;

    if (!itens || itens.length === 0) {
      return res.status(400).json({ message: "É necessário informar pelo menos um item" });
    }

    // Calculation Engine
    let valorTotalProdutos = 0;

    // Calculate total base cost
    for (const item of itens) {
      valorTotalProdutos += Number(item.custoFornecedor) * Number(item.quantidade);
    }

    const frete = Number(valorFreteTotal) || 0;

    const result = await prisma.$transaction(async (tx) => {
      const entryItemsData: any[] = [];

      for (const item of itens) {
        const product = await tx.product.findFirst({
          where: { id: item.productId, storeId }
        });

        if (!product) {
          throw new Error(`Produto não encontrado: ${item.productId}`);
        }

        const custoItemTotal = Number(item.custoFornecedor) * Number(item.quantidade);

        // Proportional freight based on item value vs total value
        const proportion = valorTotalProdutos > 0 ? (custoItemTotal / valorTotalProdutos) : 0;
        const freteRateadoItemTotal = frete * proportion;
        const freteRateadoUnitario = Number(item.quantidade) > 0 ? (freteRateadoItemTotal / Number(item.quantidade)) : 0;

        const custoUnitarioFinal = Number(item.custoFornecedor) + freteRateadoUnitario;

        entryItemsData.push({
          productId: item.productId,
          quantidade: Number(item.quantidade),
          custoFornecedor: Number(item.custoFornecedor),
          freteRateado: freteRateadoUnitario,
          custoUnitarioFinal: custoUnitarioFinal
        });

        // Update Product Stock and Cost
        const qtdAnterior = Number(product.qtdEstoqueAtual);
        const custoAnterior = Number(product.precoCusto);

        const novaQtd = qtdAnterior + Number(item.quantidade);

        // Calculate weighted average cost
        let novoPrecoCusto = custoUnitarioFinal;
        if (novaQtd > 0 && qtdAnterior >= 0) {
          const valorEstoqueAnterior = qtdAnterior * custoAnterior;
          const valorEntrada = Number(item.quantidade) * custoUnitarioFinal;
          novoPrecoCusto = (valorEstoqueAnterior + valorEntrada) / novaQtd;
        }

        await tx.product.update({
          where: { id: product.id },
          data: {
            qtdEstoqueAtual: novaQtd,
            precoCusto: novoPrecoCusto,
            // Ao dar entrada, limpa a previsão de chegada pois o produto já chegou
            status: 'ATIVO',
            previsaoChegada: null,
            dataPedido: null
          }
        });

        // Record stock movement
        await StockMovementService.registrar({
          storeId,
          productId: product.id,
          userId,
          tipo: 'ENTRADA',
          quantidade: Number(item.quantidade),
          saldoAnterior: qtdAnterior,
          observacao: `Entrada por compra - ${fornecedor || 'sem fornecedor'}`,
        });
      }

      const entry = await tx.productEntry.create({
        data: {
          storeId,
          fornecedor,
          supplierId: supplierId || null,
          valorTotalProdutos,
          valorFreteTotal: frete,
          valorOutrosCustos: 0,
          items: {
            create: entryItemsData
          }
        },
        include: {
          items: true
        }
      });

      return entry;
    });

    res.status(201).json(result);
  }, "criar entrada de produto");
}
