import { Router } from 'express';
import { InventoryCountController } from '../controllers/InventoryCountController';
import { requireAuth } from '../middleware/auth';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { autoAudit } from '../middleware/autoAudit';

const router = Router();
const controller = new InventoryCountController();

router.use(requireAuth);
router.use(autoAudit());

router.get('/', controller.list.bind(controller));
router.post('/',
  requireStorePermission('gerenciar_estoque'),
  controller.create.bind(controller)
);
router.post('/:id/finalize',
  requireStorePermission('gerenciar_estoque'),
  controller.finalize.bind(controller)
);
router.post('/:id/reconcile',
  requireStorePermission('gerenciar_estoque'),
  controller.reconcile.bind(controller)
);
router.put('/items/:itemId',
  requireStorePermission('gerenciar_estoque'),
  controller.updateItem.bind(controller)
);

export { router as inventoryCountRoutes };
