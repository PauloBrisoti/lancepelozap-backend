import { Router } from 'express';
import { CommissionPaymentController } from '../controllers/CommissionPaymentController';
import { requireAuth } from '../middleware/auth';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { autoAudit } from '../middleware/autoAudit';

const router = Router();
const controller = new CommissionPaymentController();

router.use(requireAuth);
router.use(autoAudit());

router.get('/summary', controller.summary.bind(controller));
router.get('/', controller.list.bind(controller));
router.post('/',
  requireStorePermission('gerenciar_funcionarios'),
  controller.pay.bind(controller)
);

export { router as commissionPaymentRoutes };
