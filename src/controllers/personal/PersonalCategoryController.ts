import { Request, Response } from 'express';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { ensureCategories, getEffectiveUserId } from './helpers';

export class PersonalCategoryController {
  async list(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });

      await ensureCategories(userId);

      const categories = await prisma.personalCategory.findMany({
        where: { userId },
        orderBy: { nome: 'asc' },
      });

      return res.json(categories);
    } catch (error) {
      logger.error('Erro ao listar categorias PF:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });

      const { nome, tipo, icone, cor } = req.body;
      if (!nome || !tipo) return res.status(400).json({ error: 'nome e tipo são obrigatórios' });

      const category = await prisma.personalCategory.create({
        data: { userId, nome, tipo, icone, cor },
      });

      return res.status(201).json(category);
    } catch (error) {
      logger.error('Erro ao criar categoria PF:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      const id = req.params.id as string;
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });

      const existing = await prisma.personalCategory.findFirst({ where: { id, userId } });
      if (!existing) return res.status(404).json({ error: 'Categoria não encontrada' });

      const { nome, tipo, icone, cor } = req.body;
      const category = await prisma.personalCategory.update({
        where: { id },
        data: { ...(nome && { nome }), ...(tipo && { tipo }), ...(icone !== undefined && { icone }), ...(cor !== undefined && { cor }) },
      });

      return res.json(category);
    } catch (error) {
      logger.error('Erro ao atualizar categoria PF:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      const id = req.params.id as string;
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });

      const existing = await prisma.personalCategory.findFirst({ where: { id, userId } });
      if (!existing) return res.status(404).json({ error: 'Categoria não encontrada' });

      await prisma.personalCategory.delete({ where: { id } });
      return res.status(204).send();
    } catch (error) {
      logger.error('Erro ao deletar categoria PF:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }
}
