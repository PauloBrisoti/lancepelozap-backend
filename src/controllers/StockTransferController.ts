import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export class StockTransferController {
  async list(req: Request, res: Response) {
    try {
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
    } catch (error: any) {
      console.error('Erro ao listar transferências:', error);
      res.status(500).json({ message: error.message || 'Erro ao listar transferências' });
    }
  }

  async create(req: Request, res: Response) {
    try {
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

      const destStore = await prisma.store.findFirst({ where: { id: destinationStoreId } });
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
    } catch (error: any) {
      console.error('Erro ao criar transferência:', error);
      res.status(500).json({ message: error.message || 'Erro ao criar transferência' });
    }
  }

  async receive(req: Request, res: Response) {
    try {
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
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (!product) continue;

          const qtdRecebida = Number(item.quantidade);
          const saldoAnterior = Number(product.qtdEstoqueAtual);
          const saldoPosterior = saldoAnterior + qtdRecebida;

          await tx.product.update({
            where: { id: item.productId },
            data: { qtdEstoqueAtual: saldoPosterior },
          });

          await tx.stockMovement.create({
            data: {
              storeId,
              productId: item.productId,
              userId,
              tipo: 'TRANSFERENCIA_DESTINO',
              quantidade: qtdRecebida,
              saldoAnterior,
              saldoPosterior,
              referenciaId: id,
              observacao: `Recebido da transferência #${id.slice(0, 8)}`,
            },
          });

          await tx.stockTransferItem.update({
            where: { id: item.id },
            data: { quantidadeRecebida: qtdRecebida },
          });
        }

        await tx.stockTransfer.update({
          where: { id },
          data: { status: 'RECEBIDO' },
        });
      });

      res.json({ message: 'Transferência recebida com sucesso' });
    } catch (error: any) {
      console.error('Erro ao receber transferência:', error);
      res.status(500).json({ message: error.message || 'Erro ao receber transferência' });
    }
  }

  async send(req: Request, res: Response) {
    try {
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
          const product = await tx.product.findFirst({
            where: { id: item.productId, storeId },
          });
          if (!product) continue;

          const qtdSaida = Number(item.quantidade);
          const saldoAnterior = Number(product.qtdEstoqueAtual);
          if (saldoAnterior < qtdSaida) {
            throw new Error(`Estoque insuficiente de ${product.nome}: disponível ${saldoAnterior}, enviando ${qtdSaida}`);
          }
          const saldoPosterior = saldoAnterior - qtdSaida;

          await tx.product.update({
            where: { id: item.productId },
            data: { qtdEstoqueAtual: saldoPosterior },
          });

          await tx.stockMovement.create({
            data: {
              storeId,
              productId: item.productId,
              userId,
              tipo: 'TRANSFERENCIA_ORIGEM',
              quantidade: qtdSaida,
              saldoAnterior,
              saldoPosterior,
              referenciaId: id,
              observacao: `Enviado para transferência #${id.slice(0, 8)}`,
            },
          });
        }

        await tx.stockTransfer.update({
          where: { id },
          data: { status: 'ENVIADO' },
        });
      });

      res.json({ message: 'Transferência enviada com sucesso' });
    } catch (error: any) {
      console.error('Erro ao enviar transferência:', error);
      res.status(500).json({ message: error.message || 'Erro ao enviar transferência' });
    }
  }

  async cancel(req: Request, res: Response) {
    try {
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
    } catch (error: any) {
      console.error('Erro ao cancelar transferência:', error);
      res.status(500).json({ message: error.message || 'Erro ao cancelar transferência' });
    }
  }
}
