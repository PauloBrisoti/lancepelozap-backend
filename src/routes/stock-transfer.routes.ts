import { Router } from 'express';
import { StockTransferController } from '../controllers/StockTransferController';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { requirePlanFeature } from '../middleware/requirePlanFeature';
import { autoAudit } from '../middleware/autoAudit';

const router = Router();
const controller = new StockTransferController();

router.use(requireAuth);
router.use(requireWorkspaceType('PJ'));
router.use(requirePlanFeature('transferencia_estoque'));
router.use(autoAudit());

router.get('/', controller.list.bind(controller));
router.post('/',
  requireStorePermission('gerenciar_estoque'),
  controller.create.bind(controller)
);
router.post('/:id/send',
  requireStorePermission('gerenciar_estoque'),
  controller.send.bind(controller)
);
router.post('/:id/receive',
  requireStorePermission('gerenciar_estoque'),
  controller.receive.bind(controller)
);
router.post('/:id/cancel',
  requireStorePermission('gerenciar_estoque'),
  controller.cancel.bind(controller)
);

export { router as stockTransferRoutes };
