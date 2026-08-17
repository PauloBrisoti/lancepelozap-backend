import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from "../lib/asyncHandler";
import { StockMovementService } from '../services/StockMovementService';

export class StockTransferController {
  list = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const transfers = await prisma.stockTransfer.findMany({
        where: {
          OR: [{ originStoreId: storeId }, { destinationStoreId: storeId }],
        },
        orderBy: { createdAt: 'desc' },
        include: {
          originStore: { select: { id: true, nomeFantasia: true } },
          destinationStore: { select: { id: true, nomeFantasia: true } },
          user: { select: { id: true, nome: true } },
          items: {
            include: { product: { select: { id: true, nome: true, codigoVisual: true } } },
          },
        },
      });

      res.json(transfers);
    
  }, "listar");

  create = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: 'Usuário ou loja não identificados' });

      const { destinationStoreId, items, observacao } = req.body;
      if (!destinationStoreId || !items?.length) {
        return res.status(400).json({ message: 'destinationStoreId e items são obrigatórios' });
      }
      if (destinationStoreId === storeId) {
        return res.status(400).json({ message: 'A loja de destino deve ser diferente da origem' });
      }

      const originStore = await prisma.store.findUnique({
        where: { id: storeId },
        select: { controlId: true },
      });
      if (!originStore) return res.status(401).json({ message: 'Loja de origem não encontrada' });

      const destStore = await prisma.store.findFirst({
        where: { id: destinationStoreId, controlId: originStore.controlId },
      });
      if (!destStore) return res.status(404).json({ message: 'Loja de destino não encontrada' });

      for (const item of items) {
        const product = await prisma.product.findFirst({
          where: { id: item.productId, storeId },
        });
        if (!product) {
          return res.status(404).json({ message: `Produto ${item.productId} não encontrado` });
        }
        if (Number(product.qtdEstoqueAtual) < Number(item.quantidade)) {
          return res.status(400).json({
            message: `Estoque insuficiente de ${product.nome}: disponível ${product.qtdEstoqueAtual}, solicitado ${item.quantidade}`,
          });
        }
      }

      const transfer = await prisma.stockTransfer.create({
        data: {
          originStoreId: storeId,
          destinationStoreId,
          userId,
          observacao,
          items: {
            create: items.map((i: any) => ({
              productId: i.productId,
              quantidade: i.quantidade,
            })),
          },
        },
        include: {
          items: {
            include: { product: { select: { id: true, nome: true } } },
          },
          originStore: { select: { id: true, nomeFantasia: true } },
          destinationStore: { select: { id: true, nomeFantasia: true } },
        },
      });

      res.status(201).json(transfer);
    
  }, "criar");

  receive = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: 'Usuário ou loja não identificados' });

      const id = req.params.id as string;
      const transfer = await prisma.stockTransfer.findFirst({
        where: { id, destinationStoreId: storeId },
        include: { items: true },
      });

      if (!transfer) return res.status(404).json({ message: 'Transferência não encontrada' });
      if (transfer.status !== 'ENVIADO') {
        return res.status(400).json({ message: 'Transferência precisa estar como ENVIADO para ser recebida' });
      }

      await prisma.$transaction(async (tx) => {
        for (const item of transfer.items) {
          const result = await StockMovementService.movimentar(tx, {
            storeId,
            productId: item.productId,
            userId,
            tipo: 'TRANSFERENCIA_DESTINO',
            quantidade: Number(item.quantidade),
            referenciaId: id,
            observacao: `Recebido da transferência #${id.slice(0, 8)}`,
            skipSeProdutoInexistente: true,
          });
          if (!result) continue;

          await tx.stockTransferItem.update({
            where: { id: item.id },
            data: { quantidadeRecebida: Number(item.quantidade) },
          });
        }

        await tx.stockTransfer.update({
          where: { id },
          data: { status: 'RECEBIDO' },
        });
      });

      res.json({ message: 'Transferência recebida com sucesso' });
    
  }, "registrar recebimento");

  send = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const userId = req.user?.id as string;
      if (!storeId || !userId) return res.status(401).json({ message: 'Usuário ou loja não identificados' });

      const id = req.params.id as string;
      const transfer = await prisma.stockTransfer.findFirst({
        where: { id, originStoreId: storeId },
        include: { items: true },
      });

      if (!transfer) return res.status(404).json({ message: 'Transferência não encontrada' });
      if (transfer.status !== 'PENDENTE') {
        return res.status(400).json({ message: 'Transferência precisa estar como PENDENTE para ser enviada' });
      }

      await prisma.$transaction(async (tx) => {
        for (const item of transfer.items) {
          const result = await StockMovementService.movimentar(tx, {
            storeId,
            productId: item.productId,
            userId,
            tipo: 'TRANSFERENCIA_ORIGEM',
            quantidade: Number(item.quantidade),
            referenciaId: id,
            observacao: `Enviado para transferência #${id.slice(0, 8)}`,
          });
          if (!result) continue;
        }

        await tx.stockTransfer.update({
          where: { id },
          data: { status: 'ENVIADO' },
        });
      });

      res.json({ message: 'Transferência enviada com sucesso' });
    
  }, "enviar");

  cancel = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const id = req.params.id as string;
      const transfer = await prisma.stockTransfer.findFirst({
        where: { id, originStoreId: storeId },
      });

      if (!transfer) return res.status(404).json({ message: 'Transferência não encontrada' });
      if (transfer.status !== 'PENDENTE') {
        return res.status(400).json({ message: 'Só é possível cancelar transferências pendentes' });
      }

      await prisma.stockTransfer.update({
        where: { id },
        data: { status: 'CANCELADO' },
      });

      res.json({ message: 'Transferência cancelada' });
    
  }, "cancelar");
}
