import { Router } from 'express';
import { ProductEntryController } from '../controllers/ProductEntryController';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { autoAudit } from '../middleware/autoAudit';
import { validate, productEntrySchema } from '../lib/validation';

const productEntryRouter = Router();
const controller = new ProductEntryController();

productEntryRouter.use(requireAuth);
productEntryRouter.use(requireWorkspaceType('PJ'));
productEntryRouter.use(autoAudit());

productEntryRouter.post('/', requireStorePermission('gerenciar_estoque'), validate(productEntrySchema), controller.create);
productEntryRouter.get('/', controller.list);

export { productEntryRouter };
