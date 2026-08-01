import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

router.get('/plans', async (_req: Request, res: Response) => {
  try {
    const plans = await prisma.plan.findMany({
      select: { id: true, nome: true, precoMensal: true, maxEmployees: true, maxStores: true },
      orderBy: { precoMensal: 'asc' }
    });
    return res.json(plans);
  } catch (error) {
    console.error('Erro ao listar planos públicos:', error);
    return res.status(500).json({ error: 'Erro ao carregar planos' });
  }
});

export { router as publicRoutes };
