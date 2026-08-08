import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requirePlanFeature } from '../middleware/requirePlanFeature';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { ServiceOrderController } from '../controllers/ServiceOrderController';

const router = Router();
const ctrl = new ServiceOrderController();

router.use(requireAuth);
router.use(requireWorkspaceType('PJ'));
router.use(requirePlanFeature('ordem_servico'));

// Service Types
router.get('/service-types', ctrl.listServiceTypes);
router.post('/service-types', requireStorePermission('gerenciar_clientes'), ctrl.createServiceType);
router.put('/service-types/:id', requireStorePermission('gerenciar_clientes'), ctrl.updateServiceType);
router.delete('/service-types/:id', requireStorePermission('gerenciar_clientes'), ctrl.deleteServiceType);

// Service Orders
router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);
router.post('/', requireStorePermission('gerenciar_clientes'), ctrl.create);
router.put('/:id', requireStorePermission('gerenciar_clientes'), ctrl.update);

// Status Transitions
router.post('/:id/start', requireStorePermission('gerenciar_clientes'), ctrl.startService);
router.post('/:id/waiting-parts', requireStorePermission('gerenciar_clientes'), ctrl.setWaitingParts);
router.post('/:id/complete', requireStorePermission('gerenciar_clientes'), ctrl.complete);
router.post('/:id/deliver', requireStorePermission('gerenciar_clientes'), ctrl.deliver);
router.post('/:id/cancel', requireStorePermission('gerenciar_clientes'), ctrl.cancel);

// Items
router.post('/:id/items', requireStorePermission('gerenciar_clientes'), ctrl.addItem);
router.delete('/:id/items/:itemId', requireStorePermission('gerenciar_clientes'), ctrl.removeItem);

export { router as serviceOrderRoutes };
