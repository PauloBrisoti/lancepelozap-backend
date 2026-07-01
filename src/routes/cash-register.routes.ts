import { Router } from 'express';
import { CashRegisterController } from '../controllers/CashRegisterController';
import { requireAuth } from '../middleware/auth';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { autoAudit } from '../middleware/autoAudit';
import { z } from 'zod';
import { validate } from '../lib/validation';

const router = Router();
const controller = new CashRegisterController();

const openSchema = z.object({
  valorTrocoInicial: z.number().min(0, 'Valor do troco inicial deve ser >= 0'),
});

const closeSchema = z.object({
  valorTotalFechamento: z.number().min(0, 'Valor de fechamento deve ser >= 0'),
});

const transactionSchema = z.object({
  tipo: z.enum(['SANGRIA', 'SUPRIMENTO']),
  valor: z.number().positive('Valor deve ser positivo'),
  descricao: z.string().optional(),
});

router.use(requireAuth);
router.use(autoAudit());

router.post('/open',
  requireStorePermission('abrir_caixa'),
  validate(openSchema),
  controller.open.bind(controller)
);

router.post('/close',
  requireStorePermission('fechar_caixa'),
  validate(closeSchema),
  controller.close.bind(controller)
);

router.get('/current', controller.getCurrent.bind(controller));

router.get('/:id/summary', controller.getSummary.bind(controller));

router.get('/history', controller.getHistory.bind(controller));

router.post('/transaction',
  requireStorePermission('gerenciar_caixa'),
  validate(transactionSchema),
  controller.addTransaction.bind(controller)
);

export { router as cashRegisterRoutes };
