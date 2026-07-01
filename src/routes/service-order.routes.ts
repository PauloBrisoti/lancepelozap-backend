import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { ServiceOrderController } from '../controllers/ServiceOrderController';

const router = Router();
const ctrl = new ServiceOrderController();

router.use(requireAuth);

// Service Types
router.get('/service-types', ctrl.listServiceTypes.bind(ctrl));
router.post('/service-types', ctrl.createServiceType.bind(ctrl));
router.put('/service-types/:id', ctrl.updateServiceType.bind(ctrl));
router.delete('/service-types/:id', ctrl.deleteServiceType.bind(ctrl));

// Service Orders
router.get('/', ctrl.list.bind(ctrl));
router.get('/:id', ctrl.getById.bind(ctrl));
router.post('/', ctrl.create.bind(ctrl));
router.put('/:id', ctrl.update.bind(ctrl));

// Status Transitions
router.post('/:id/start', ctrl.startService.bind(ctrl));
router.post('/:id/waiting-parts', ctrl.setWaitingParts.bind(ctrl));
router.post('/:id/complete', ctrl.complete.bind(ctrl));
router.post('/:id/deliver', ctrl.deliver.bind(ctrl));
router.post('/:id/cancel', ctrl.cancel.bind(ctrl));

// Items
router.post('/:id/items', ctrl.addItem.bind(ctrl));
router.delete('/:id/items/:itemId', ctrl.removeItem.bind(ctrl));

export { router as serviceOrderRoutes };
