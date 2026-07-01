import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export class CommissionRuleController {
  async list(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const rules = await prisma.commissionRule.findMany({
        where: { storeId },
        include: {
          user: { select: { id: true, nome: true } },
          category: { select: { id: true, nome: true } },
        },
        orderBy: { id: 'asc' },
      });

      res.json(rules);
    } catch (error: any) {
      console.error('Erro ao listar regras de comissão:', error);
      res.status(500).json({ message: error.message || 'Erro ao listar regras' });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { userId, categoryId, percentual } = req.body;

      if (!userId || percentual === undefined) {
        return res.status(400).json({ message: 'userId e percentual são obrigatórios' });
      }

      const user = await prisma.storeUserAccess.findUnique({
        where: { storeId_userId: { storeId, userId } }
      });
      if (!user) return res.status(400).json({ message: 'Usuário não encontrado nesta loja' });

      const rule = await prisma.commissionRule.create({
        data: {
          storeId,
          userId,
          categoryId: categoryId || null,
          percentual: Number(percentual),
          ativo: true,
        },
        include: {
          user: { select: { id: true, nome: true } },
          category: { select: { id: true, nome: true } },
        },
      });

      res.status(201).json(rule);
    } catch (error: any) {
      console.error('Erro ao criar regra de comissão:', error);
      res.status(500).json({ message: error.message || 'Erro ao criar regra' });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { id } = req.params;
      const { percentual, categoryId, ativo } = req.body;

      const existing = await prisma.commissionRule.findFirst({
        where: { id: String(id), storeId }
      });
      if (!existing) return res.status(404).json({ message: 'Regra não encontrada' });

      const updated = await prisma.commissionRule.update({
        where: { id: String(id) },
        data: {
          percentual: percentual !== undefined ? Number(percentual) : undefined,
          categoryId: categoryId !== undefined ? categoryId : undefined,
          ativo: ativo !== undefined ? ativo : undefined,
        },
        include: {
          user: { select: { id: true, nome: true } },
          category: { select: { id: true, nome: true } },
        },
      });

      res.json(updated);
    } catch (error: any) {
      console.error('Erro ao atualizar regra de comissão:', error);
      res.status(500).json({ message: error.message || 'Erro ao atualizar regra' });
    }
  }

  async remove(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { id } = req.params;
      const existing = await prisma.commissionRule.findFirst({
        where: { id: String(id), storeId }
      });
      if (!existing) return res.status(404).json({ message: 'Regra não encontrada' });

      await prisma.commissionRule.delete({ where: { id: String(id) } });

      res.json({ message: 'Regra removida com sucesso' });
    } catch (error: any) {
      console.error('Erro ao remover regra de comissão:', error);
      res.status(500).json({ message: error.message || 'Erro ao remover regra' });
    }
  }
}
