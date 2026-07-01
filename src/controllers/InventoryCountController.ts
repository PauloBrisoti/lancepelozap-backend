import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export class InventoryCountController {
  async list(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const counts = await prisma.inventoryCount.findMany({
        where: { storeId },
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, nome: true } },
          _count: { select: { items: true } },
        },
      });

      res.json(counts);
    } catch (error: any) {
      console.error('Erro ao listar contagens:', error);
      res.status(500).json({ message: error.message || 'Erro ao listar contagens' });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: 'Usuário ou loja não identificados' });

      const products = await prisma.product.findMany({
        where: { storeId, status: 'ATIVO' },
        select: { id: true, nome: true, qtdEstoqueAtual: true },
      });

      const count = await prisma.inventoryCount.create({
        data: {
          storeId,
          userId,
          items: {
            create: products.map(p => ({
              productId: p.id,
              quantidadeSistema: Number(p.qtdEstoqueAtual),
              quantidadeContada: Number(p.qtdEstoqueAtual),
              diferenca: 0,
            })),
          },
        },
        include: {
          items: {
            include: { product: { select: { id: true, nome: true, codigoVisual: true } } },
          },
        },
      });

      res.status(201).json(count);
    } catch (error: any) {
      console.error('Erro ao criar contagem:', error);
      res.status(500).json({ message: error.message || 'Erro ao criar contagem' });
    }
  }

  async updateItem(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const itemId = req.params.itemId as string;
      const { quantidadeContada, observacao } = req.body;

      const item = await prisma.inventoryCountItem.findFirst({
        where: { id: itemId },
        include: { count: { select: { storeId: true, status: true } } },
      });

      if (!item || item.count.storeId !== storeId) {
        return res.status(404).json({ message: 'Item não encontrado' });
      }
      if (item.count.status !== 'ABERTO') {
        return res.status(400).json({ message: 'Contagem precisa estar aberta para editar itens' });
      }

      const qtdSistema = Number(item.quantidadeSistema);
      const qtdContada = quantidadeContada !== undefined ? Number(quantidadeContada) : qtdSistema;
      const diferenca = qtdContada - qtdSistema;

      const updated = await prisma.inventoryCountItem.update({
        where: { id: itemId },
        data: { quantidadeContada: qtdContada, diferenca, observacao },
        include: { product: { select: { id: true, nome: true, codigoVisual: true } } },
      });

      res.json(updated);
    } catch (error: any) {
      console.error('Erro ao atualizar item da contagem:', error);
      res.status(500).json({ message: error.message || 'Erro ao atualizar item' });
    }
  }

  async finalize(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: 'Usuário ou loja não identificados' });

      const id = req.params.id as string;
      const count = await prisma.inventoryCount.findFirst({
        where: { id, storeId },
        include: { items: true },
      });

      if (!count) return res.status(404).json({ message: 'Contagem não encontrada' });
      if (count.status !== 'ABERTO') {
        return res.status(400).json({ message: 'Contagem já finalizada ou conciliada' });
      }

      await prisma.inventoryCount.update({
        where: { id },
        data: { status: 'FINALIZADO' },
      });

      res.json({ message: 'Contagem finalizada. Pendente de conciliação.' });
    } catch (error: any) {
      console.error('Erro ao finalizar contagem:', error);
      res.status(500).json({ message: error.message || 'Erro ao finalizar contagem' });
    }
  }

  async reconcile(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: 'Usuário ou loja não identificados' });

      const id = req.params.id as string;
      const count = await prisma.inventoryCount.findFirst({
        where: { id, storeId },
        include: { items: true },
      });

      if (!count) return res.status(404).json({ message: 'Contagem não encontrada' });
      if (count.status !== 'FINALIZADO') {
        return res.status(400).json({ message: 'Contagem precisa estar finalizada para conciliar' });
      }

      await prisma.$transaction(async (tx) => {
        for (const item of count.items) {
          const diferenca = Number(item.diferenca);
          if (diferenca === 0) continue;

          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (!product) continue;

          const saldoAnterior = Number(product.qtdEstoqueAtual);
          const saldoPosterior = saldoAnterior + diferenca;

          await tx.product.update({
            where: { id: item.productId },
            data: { qtdEstoqueAtual: saldoPosterior },
          });

          await tx.stockMovement.create({
            data: {
              storeId,
              productId: item.productId,
              userId,
              tipo: 'AJUSTE',
              quantidade: Math.abs(diferenca),
              saldoAnterior,
              saldoPosterior,
              motivo: 'ERRO_CONTAGEM',
              observacao: `Ajuste por contagem de inventário #${id.slice(0, 8)}: sistema ${item.quantidadeSistema}, contado ${item.quantidadeContada}`,
              referenciaId: id,
            },
          });
        }

        await tx.inventoryCount.update({
          where: { id },
          data: { status: 'CONCILIADO' },
        });
      });

      res.json({ message: 'Contagem conciliada com sucesso. Estoque ajustado.' });
    } catch (error: any) {
      console.error('Erro ao conciliar contagem:', error);
      res.status(500).json({ message: error.message || 'Erro ao conciliar contagem' });
    }
  }
}
