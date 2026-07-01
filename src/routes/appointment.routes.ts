import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { AppointmentController } from '../controllers/AppointmentController';

const router = Router();
const ctrl = new AppointmentController();

router.use(requireAuth);

// Professionals
router.get('/professionals', ctrl.listProfessionals.bind(ctrl));
router.post('/professionals', ctrl.createProfessional.bind(ctrl));
router.put('/professionals/:id', ctrl.updateProfessional.bind(ctrl));
router.delete('/professionals/:id', ctrl.deleteProfessional.bind(ctrl));

// Appointments
router.get('/', ctrl.list.bind(ctrl));
router.get('/:id', ctrl.getById.bind(ctrl));
router.post('/', ctrl.create.bind(ctrl));
router.put('/:id', ctrl.update.bind(ctrl));
router.delete('/:id', ctrl.delete.bind(ctrl));

// Status transitions
router.post('/:id/confirm', ctrl.confirm.bind(ctrl));
router.post('/:id/start', ctrl.start.bind(ctrl));
router.post('/:id/complete', ctrl.complete.bind(ctrl));
router.post('/:id/cancel', ctrl.cancel.bind(ctrl));
router.post('/:id/no-show', ctrl.noShow.bind(ctrl));

export { router as appointmentRoutes };
