import { Router, Request, Response } from 'express';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { InviteController } from '../controllers/InviteController';

const router = Router();
const inviteController = new InviteController();

router.get('/plans', async (_req: Request, res: Response) => {
  try {
    const plans = await prisma.plan.findMany({
      select: { id: true, nome: true, precoMensal: true, maxEmployees: true, maxStores: true },
      orderBy: { precoMensal: 'asc' }
    });
    return res.json(plans);
  } catch (error) {
    logger.error('Erro ao listar planos públicos:', error);
    return res.status(500).json({ error: 'Erro ao carregar planos' });
  }
});

// Rotas de convite (públicas - sem autenticação)
router.get('/invite/validate', inviteController.validateToken);
router.post('/invite/accept', inviteController.acceptInvite);

export { router as publicRoutes };
