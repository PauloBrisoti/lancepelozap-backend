import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from "../lib/asyncHandler";
import { StockMovementService } from '../services/StockMovementService';

export class InventoryCountController {
  list = asyncHandler(async (req: Request, res: Response) => {
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
    
  }, "listar");

  create = asyncHandler(async (req: Request, res: Response) => {
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
    
  }, "criar");

  addItemByEan = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const id = req.params.id as string;
      const ean = (req.body?.ean || '').trim();

      if (!ean) return res.status(400).json({ message: 'Código de barras é obrigatório' });

      const count = await prisma.inventoryCount.findFirst({
        where: { id, storeId },
        include: { items: true },
      });

      if (!count) return res.status(404).json({ message: 'Contagem não encontrada' });
      if (count.status !== 'ABERTO') {
        return res.status(400).json({ message: 'Contagem precisa estar aberta para adicionar itens' });
      }

      const product = await prisma.product.findFirst({
        where: { storeId, codigoBarrasEan: ean },
      });

      if (!product) return res.status(404).json({ message: 'Produto não encontrado para este código de barras' });

      const existingItem = count.items.find(i => i.productId === product.id);

      let item;
      if (existingItem) {
        const novaQuantidade = Number(existingItem.quantidadeContada) + 1;
        item = await prisma.inventoryCountItem.update({
          where: { id: existingItem.id },
          data: {
            quantidadeContada: novaQuantidade,
            diferenca: novaQuantidade - Number(existingItem.quantidadeSistema),
          },
          include: { product: { select: { id: true, nome: true, codigoVisual: true } } },
        });
      } else {
        item = await prisma.inventoryCountItem.create({
          data: {
            inventoryCountId: id,
            productId: product.id,
            quantidadeSistema: Number(product.qtdEstoqueAtual),
            quantidadeContada: 1,
            diferenca: 1 - Number(product.qtdEstoqueAtual),
          },
          include: { product: { select: { id: true, nome: true, codigoVisual: true } } },
        });
      }

      res.status(201).json(item);
    
  }, "criar item by ean");

  updateItem = asyncHandler(async (req: Request, res: Response) => {
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
    
  }, "atualizar item");

  finalize = asyncHandler(async (req: Request, res: Response) => {
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
    
  }, "finalizar");

  reconcile = asyncHandler(async (req: Request, res: Response) => {
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

          const result = await StockMovementService.movimentar(tx, {
            storeId,
            productId: item.productId,
            userId,
            tipo: 'AJUSTE',
            quantidade: diferenca,
            motivo: 'ERRO_CONTAGEM',
            observacao: `Ajuste por contagem de inventário #${id.slice(0, 8)}: sistema ${item.quantidadeSistema}, contado ${item.quantidadeContada}`,
            referenciaId: id,
            skipSeProdutoInexistente: true,
          });
          if (!result) continue;
        }

        await tx.inventoryCount.update({
          where: { id },
          data: { status: 'CONCILIADO' },
        });
      });

      res.json({ message: 'Contagem conciliada com sucesso. Estoque ajustado.' });
    
  }, "reconcile");
}
