import { Router } from 'express';
import { SupplierController } from '../controllers/SupplierController';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { autoAudit } from '../middleware/autoAudit';

const router = Router();
const controller = new SupplierController();

router.use(requireAuth);
router.use(requireWorkspaceType('PJ'));
router.use(autoAudit());

router.get('/', controller.list.bind(controller));
router.get('/:id', controller.getById.bind(controller));
router.post('/',
  requireStorePermission('gerenciar_estoque'),
  controller.create.bind(controller)
);
router.put('/:id',
  requireStorePermission('gerenciar_estoque'),
  controller.update.bind(controller)
);
router.delete('/:id',
  requireStorePermission('gerenciar_estoque'),
  controller.remove.bind(controller)
);

export { router as supplierRoutes };
