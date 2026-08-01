import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { ensureWallets, getEffectiveUserId } from './helpers';

export class PersonalWalletController {
  async list(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });

      await ensureWallets(userId);

      const wallets = await prisma.personalWallet.findMany({
        where: { userId },
        orderBy: { nome: 'asc' },
      });

      return res.json(wallets);
    } catch (error) {
      console.error('Erro ao listar carteiras PF:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });

      const { nome, icone, cor } = req.body;
      if (!nome) return res.status(400).json({ error: 'nome é obrigatório' });

      const wallet = await prisma.personalWallet.create({
        data: { userId, nome, icone, cor },
      });

      return res.status(201).json(wallet);
    } catch (error) {
      console.error('Erro ao criar carteira PF:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      const id = req.params.id as string;
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });

      const existing = await prisma.personalWallet.findFirst({ where: { id, userId } });
      if (!existing) return res.status(404).json({ error: 'Carteira não encontrada' });

      await prisma.personalWallet.delete({ where: { id } });
      return res.status(204).send();
    } catch (error) {
      console.error('Erro ao deletar carteira PF:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }
}
