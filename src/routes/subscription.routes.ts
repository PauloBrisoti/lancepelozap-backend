import { Router } from 'express';
import { SubscriptionController } from '../controllers/SubscriptionController';
import { requireAuth } from '../middleware/auth';
import { requireStrictSuperAdmin } from '../middleware/requireStrictSuperAdmin';
import { autoAudit } from '../middleware/autoAudit';

const router = Router();

router.use(requireAuth);
router.use(autoAudit());

router.get('/all', requireStrictSuperAdmin, SubscriptionController.listAll);
router.get('/me', SubscriptionController.getMySubscription);
router.post('/plan', SubscriptionController.updatePlan);
router.post('/change-request', SubscriptionController.requestPlanChange);
router.put('/:id/toggle-block', requireStrictSuperAdmin, SubscriptionController.toggleBlock);

export default router;
