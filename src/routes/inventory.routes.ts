import { Router } from 'express';
import { InventoryAdjustmentController } from '../controllers/InventoryAdjustmentController';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { autoAudit } from '../middleware/autoAudit';
import { z } from 'zod';
import { validate } from '../lib/validation';

const router = Router();
const controller = new InventoryAdjustmentController();

const adjustSchema = z.object({
  productId: z.string().min(1),
  novaQuantidade: z.number().min(0, 'Quantidade não pode ser negativa'),
  motivo: z.enum(['PERDA', 'QUEBRA', 'ROUBO', 'ERRO_CONTAGEM', 'DEVOLUCAO', 'OUTRO']).optional(),
  observacao: z.string().optional(),
});

router.use(requireAuth);
router.use(requireWorkspaceType('PJ'));
router.use(autoAudit());

router.get('/alerts', controller.getAlerts.bind(controller));
router.get('/movements', controller.listMovements.bind(controller));
router.post('/adjust',
  requireStorePermission('gerenciar_estoque'),
  validate(adjustSchema),
  controller.adjustStock.bind(controller)
);

export { router as inventoryRoutes };
