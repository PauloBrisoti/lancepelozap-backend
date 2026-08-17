import { getErrorMessage } from '../../lib/errors';
import { Request, Response } from 'express';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { ensureCategories, ensureWallets, getCycleRange, getEffectiveUserId } from './helpers';

export class PersonalTransactionController {
  async list(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });
      await ensureCategories(userId);
      await ensureWallets(userId);

      const { mes, ano, tipo } = req.query;
      const now = new Date();
      const filterMes = mes ? Number(mes) : now.getMonth() + 1;
      const filterAno = ano ? Number(ano) : now.getFullYear();

      const { start, end } = await getCycleRange(userId, filterMes, filterAno);
      const where: any = {
        userId,
        data: { gte: start, lt: end },
      };
      if (tipo) where.tipo = tipo;

      const transactions = await prisma.personalTransaction.findMany({
        where,
        include: {
          category: { select: { id: true, nome: true, icone: true, cor: true } },
          wallet: { select: { id: true, nome: true, icone: true } },
        },
        orderBy: { data: 'desc' },
      });

      transactions.forEach(t => logger.debug('LIST', { arg0: t.id.slice(0, 8), arg1: '| data:', arg2: t.data instanceof Date ? t.data.toISOString() : t.data, arg3: '| raw:', arg4: t.data }));

      return res.json(transactions);
    } catch (error) {
      logger.error('Erro ao listar transações PF:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });
      await ensureWallets(userId);

      const { categoryId, walletId, tipo, valor, descricao, data, dataTransacao, dataVencimento, dataCompetencia, recorrente, parcelas, observacoes, pago, formaPagamento } = req.body;

      logger.debug('Payload recebido:', { arg0: req.body });

      if (!categoryId || !tipo || !valor) {
        return res.status(400).json({ error: 'categoryId, tipo e valor são obrigatórios' });
      }

      const dataFinal = dataVencimento || dataTransacao || data;

      const transaction = await prisma.personalTransaction.create({
        data: {
          userId,
          categoryId,
          walletId: walletId || null,
          tipo,
          valor: Number(valor),
          descricao,
          data: dataFinal ? new Date(dataFinal) : new Date(),
          dataCompetencia: dataCompetencia ? new Date(dataCompetencia) : undefined,
          pago: pago ?? false,
          formaPagamento: formaPagamento || undefined,
          recorrente: recorrente ?? false,
          parcelas: parcelas != null && parcelas !== '' ? Number(parcelas) : undefined,
          observacoes: observacoes || undefined,
        },
        include: {
          category: { select: { id: true, nome: true, icone: true, cor: true } },
          wallet: { select: { id: true, nome: true, icone: true } },
        },
      });

      return res.status(201).json(transaction);
    } catch (error: unknown) {
      logger.error('Erro ao criar transação PF:', { err: getErrorMessage(error) || error });
      return res.status(400).json({ error: getErrorMessage(error) || 'Erro interno' });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      const id = req.params.id as string;
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });

      const existing = await prisma.personalTransaction.findFirst({ where: { id, userId } });
      if (!existing) return res.status(404).json({ error: 'Transação não encontrada' });

      const { categoryId, walletId, tipo, valor, descricao, dataVencimento, dataCompetencia, recorrente, parcelas, observacoes, pago, formaPagamento } = req.body;
      const transaction = await prisma.personalTransaction.update({
        where: { id },
        data: {
          ...(categoryId && { categoryId }),
          ...(walletId !== undefined && { walletId: walletId || null }),
          ...(tipo && { tipo }),
          ...(valor && { valor }),
          ...(descricao !== undefined && { descricao }),
          ...(dataVencimento != null && { data: new Date(dataVencimento) }),
          ...('data' in req.body && req.body.data != null && !dataVencimento && { data: new Date(req.body.data) }),
          ...('dataTransacao' in req.body && req.body.dataTransacao != null && !dataVencimento && { data: new Date(req.body.dataTransacao) }),
          ...(dataCompetencia != null && { dataCompetencia: new Date(dataCompetencia) }),
          ...(pago !== undefined && { pago: Boolean(pago) }),
          ...(formaPagamento !== undefined && { formaPagamento: formaPagamento || null }),
          ...(recorrente !== undefined && { recorrente }),
          ...(parcelas !== undefined && { parcelas: Number(parcelas) || null }),
          ...(observacoes !== undefined && { observacoes: observacoes || null }),
        },
        include: {
          category: { select: { id: true, nome: true, icone: true, cor: true } },
          wallet: { select: { id: true, nome: true, icone: true } },
        },
      });

      return res.json(transaction);
    } catch (error) {
      logger.error('Erro ao atualizar transação PF:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      const id = req.params.id as string;
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });

      const existing = await prisma.personalTransaction.findFirst({ where: { id, userId } });
      if (!existing) return res.status(404).json({ error: 'Transação não encontrada' });

      await prisma.personalTransaction.delete({ where: { id } });
      return res.status(204).send();
    } catch (error) {
      logger.error('Erro ao deletar transação PF:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }
}
