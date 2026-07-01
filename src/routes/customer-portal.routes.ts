import { Router } from 'express';
import { CustomerPortalController } from '../controllers/CustomerPortalController';

const router = Router();
const controller = new CustomerPortalController();

router.get('/:token', controller.getProfile.bind(controller));
router.put('/:token/profile', controller.updateProfile.bind(controller));
router.get('/:token/sales', controller.getSales.bind(controller));
router.get('/:token/receivables', controller.getReceivables.bind(controller));

export { router as customerPortalRoutes };
