import { Router } from 'express';
import { ProductEntryController } from '../controllers/ProductEntryController';
import { requireAuth } from '../middleware/auth';
import { autoAudit } from '../middleware/autoAudit';
import { validate, productEntrySchema } from '../lib/validation';

const productEntryRouter = Router();
const controller = new ProductEntryController();

productEntryRouter.use(requireAuth);
productEntryRouter.use(autoAudit());

productEntryRouter.post('/', validate(productEntrySchema), controller.create);
productEntryRouter.get('/', controller.list);

export { productEntryRouter };
