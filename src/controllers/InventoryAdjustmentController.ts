import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export class InventoryAdjustmentController {
  async listMovements(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const productId = req.query.productId as string | undefined;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 50;

      const where: any = { storeId };
      if (productId) where.productId = productId;

      const [records, total] = await Promise.all([
        prisma.stockMovement.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            product: { select: { id: true, nome: true, codigoVisual: true } },
            user: { select: { id: true, nome: true } },
          },
        }),
        prisma.stockMovement.count({ where }),
      ]);

      res.json({ records, total, page, limit });
    } catch (error: any) {
      console.error('Erro ao listar movimentações:', error);
      res.status(500).json({ message: error.message || 'Erro ao listar movimentações' });
    }
  }

  async adjustStock(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      const userId = req.user?.id;
      if (!storeId || !userId) return res.status(401).json({ message: 'Usuário ou loja não identificados' });

      const { productId, novaQuantidade, motivo, observacao } = req.body;
      if (!productId || novaQuantidade === undefined) {
        return res.status(400).json({ message: 'productId e novaQuantidade são obrigatórios' });
      }

      const product = await prisma.product.findFirst({
        where: { id: productId, storeId }
      });
      if (!product) return res.status(404).json({ message: 'Produto não encontrado' });

      const qtdAtual = Number(product.qtdEstoqueAtual);
      const qtdNova = Number(novaQuantidade);
      const diferenca = qtdNova - qtdAtual;

      if (diferenca === 0) {
        return res.status(400).json({ message: 'A quantidade informada é igual à atual' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id: productId },
          data: { qtdEstoqueAtual: qtdNova },
        });

        await tx.stockMovement.create({
          data: {
            storeId,
            productId,
            userId,
            tipo: 'AJUSTE',
            quantidade: Math.abs(diferenca),
            saldoAnterior: qtdAtual,
            saldoPosterior: qtdNova,
            motivo: motivo || null,
            observacao: observacao || `Ajuste manual: ${qtdAtual} → ${qtdNova}`,
          },
        });
      });

      res.json({
        message: 'Estoque ajustado com sucesso',
        produto: product.nome,
        quantidadeAnterior: qtdAtual,
        quantidadeNova: qtdNova,
      });
    } catch (error: any) {
      console.error('Erro ao ajustar estoque:', error);
      res.status(500).json({ message: error.message || 'Erro ao ajustar estoque' });
    }
  }

  async getAlerts(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const products = await prisma.$queryRaw<Array<{
        id: string; nome: string; qtd_estoque_atual: number;
        estoque_minimo: number; image_url: string | null; categoria: string;
      }>>`
        SELECT p.id, p.nome, p.qtd_estoque_atual, p.estoque_minimo, p.image_url,
               COALESCE(c.nome, '') as categoria
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.store_id = ${storeId}
          AND p.status = 'ATIVO'
          AND p.qtd_estoque_atual <= p.estoque_minimo
        ORDER BY p.qtd_estoque_atual ASC
      `;

      const mapped = products.map(p => ({
        id: p.id,
        nome: p.nome,
        qtdEstoqueAtual: Number(p.qtd_estoque_atual),
        estoqueMinimo: Number(p.estoque_minimo),
        imageUrl: p.image_url,
        categoria: p.categoria,
      }));

      res.json({ count: mapped.length, products: mapped });
    } catch (error: any) {
      console.error('Erro ao buscar alertas de estoque:', error);
      res.status(500).json({ message: error.message || 'Erro ao buscar alertas' });
    }
  }
}
