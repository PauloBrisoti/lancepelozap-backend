import { Router } from 'express';
import { SubscriptionController } from '../controllers/SubscriptionController';
import { requireAuth } from '../middleware/auth';
import { autoAudit } from '../middleware/autoAudit';

const router = Router();

router.use(requireAuth);
router.use(autoAudit());

router.get('/all', SubscriptionController.listAll);
router.get('/me', SubscriptionController.getMySubscription);
router.post('/plan', SubscriptionController.updatePlan);
router.put('/:id/toggle-block', SubscriptionController.toggleBlock);

export default router;
