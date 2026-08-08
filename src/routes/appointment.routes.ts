import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { AppointmentController } from '../controllers/AppointmentController';

const router = Router();
const ctrl = new AppointmentController();

router.use(requireAuth);
router.use(requireWorkspaceType('PJ'));

// Professionals
router.get('/professionals', ctrl.listProfessionals);
router.post('/professionals', requireStorePermission('gerenciar_clientes'), ctrl.createProfessional);
router.put('/professionals/:id', requireStorePermission('gerenciar_clientes'), ctrl.updateProfessional);
router.delete('/professionals/:id', requireStorePermission('gerenciar_clientes'), ctrl.deleteProfessional);

// Appointments
router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);
router.post('/', requireStorePermission('gerenciar_clientes'), ctrl.create);
router.put('/:id', requireStorePermission('gerenciar_clientes'), ctrl.update);
router.delete('/:id', requireStorePermission('gerenciar_clientes'), ctrl.delete);

// Status transitions
router.post('/:id/confirm', requireStorePermission('gerenciar_clientes'), ctrl.confirm);
router.post('/:id/start', requireStorePermission('gerenciar_clientes'), ctrl.start);
router.post('/:id/complete', requireStorePermission('gerenciar_clientes'), ctrl.complete);
router.post('/:id/cancel', requireStorePermission('gerenciar_clientes'), ctrl.cancel);
router.post('/:id/no-show', requireStorePermission('gerenciar_clientes'), ctrl.noShow);

export { router as appointmentRoutes };
