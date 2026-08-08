import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

type StockMovementTipo = 'ENTRADA' | 'SAIDA' | 'AJUSTE';

interface MovimentarParams {
  storeId: string;
  productId: string;
  userId: string;
  tipo: 'ENTRADA' | 'SAIDA' | 'AJUSTE' | 'TRANSFERENCIA_ORIGEM' | 'TRANSFERENCIA_DESTINO';
  /** Positiva para ENTRADA/SAIDA/TRANSFERENCIAS; delta COM SINAL para AJUSTE. */
  quantidade: number;
  motivo?: string | null;
  observacao?: string;
  referenciaId?: string;
  /** Se o produto não existir, retorna undefined em vez de lançar erro. */
  skipSeProdutoInexistente?: boolean;
  /** Default: false para SAIDA/TRANSFERENCIA_ORIGEM (lança se saldo ficar negativo), true para os demais. */
  permitirEstoqueNegativo?: boolean;
}

export class StockMovementService {
  static async registrar(params: {
    storeId: string;
    productId: string;
    userId: string;
    tipo: StockMovementTipo;
    quantidade: number;
    saldoAnterior: number;
    observacao?: string;
    referenciaId?: string;
  }) {
    const saldoPosterior = params.tipo === 'ENTRADA'
      ? params.saldoAnterior + params.quantidade
      : params.saldoAnterior - params.quantidade;

    return prisma.stockMovement.create({
      data: {
        storeId: params.storeId,
        productId: params.productId,
        userId: params.userId,
        tipo: params.tipo,
        quantidade: Math.abs(params.quantidade),
        saldoAnterior: params.saldoAnterior,
        saldoPosterior,
        referenciaId: params.referenciaId || null,
        observacao: params.observacao || null,
      },
    });
  }

  /**
   * Fluxo atômico "atualizar estoque do produto + registrar movimento" que se
   * repetia em 9 pontos do código (vendas, transferências, contagem, ajustes,
   * devoluções, OS, financeiro). Deve ser chamado dentro de uma transação.
   * Retorna `{ product, saldoAnterior, saldoPosterior }` ou `undefined` quando
   * o produto não existe e `skipSeProdutoInexistente` é true.
   */
  static async movimentar(tx: Prisma.TransactionClient, params: MovimentarParams) {
    const product = await tx.product.findUnique({ where: { id: params.productId } });
    if (!product) {
      if (params.skipSeProdutoInexistente) return undefined;
      throw new Error(`Produto não encontrado: ${params.productId}`);
    }

    const saldoAnterior = Number(product.qtdEstoqueAtual);
    const incrementa = params.tipo === 'ENTRADA' || params.tipo === 'TRANSFERENCIA_DESTINO';
    const decrementa = params.tipo === 'SAIDA' || params.tipo === 'TRANSFERENCIA_ORIGEM';
    const delta = incrementa
      ? Math.abs(params.quantidade)
      : decrementa
        ? -Math.abs(params.quantidade)
        : params.quantidade; // AJUSTE: delta já vem com sinal
    const saldoPosterior = saldoAnterior + delta;

    const permiteNegativo = params.permitirEstoqueNegativo ??
      (params.tipo !== 'SAIDA' && params.tipo !== 'TRANSFERENCIA_ORIGEM');

    if (!permiteNegativo && saldoPosterior < 0) {
      throw new Error(`Estoque insuficiente de ${product.nome}: disponível ${saldoAnterior}, enviando ${Math.abs(delta)}`);
    }

    await tx.product.update({
      where: { id: product.id },
      data: { qtdEstoqueAtual: saldoPosterior },
    });

    await tx.stockMovement.create({
      data: {
        storeId: params.storeId,
        productId: params.productId,
        userId: params.userId,
        tipo: params.tipo,
        quantidade: Math.abs(params.quantidade),
        saldoAnterior,
        saldoPosterior,
        motivo: params.motivo || null,
        observacao: params.observacao || null,
        referenciaId: params.referenciaId || null,
      },
    });

    return { product, saldoAnterior, saldoPosterior };
  }

  static async listar(params: {
    storeId: string;
    productId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = { storeId: params.storeId };
    if (params.productId) where.productId = params.productId;

    const [records, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          product: { select: { id: true, nome: true } },
          user: { select: { id: true, nome: true } },
        },
      }),
      prisma.stockMovement.count({ where }),
    ]);

    return { records, total, page, limit };
  }
}
