import { Router } from 'express';
import { SuperAdminController } from '../controllers/SuperAdminController';
import { requireAuth } from '../middleware/auth';

const router = Router();
const ctrl = new SuperAdminController();

router.use(requireAuth);

router.get('/', ctrl.listNotifications.bind(ctrl));
router.put('/:id/read', ctrl.markNotificationRead.bind(ctrl));
router.put('/read-all', ctrl.markAllNotificationsRead.bind(ctrl));

export { router as notificationRoutes };
