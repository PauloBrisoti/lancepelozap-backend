import { prisma } from '../lib/prisma';

type StockMovementTipo = 'ENTRADA' | 'SAIDA' | 'AJUSTE';

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
