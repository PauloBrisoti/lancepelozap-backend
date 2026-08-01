import { Router } from 'express';
import { DashboardController } from '../controllers/DashboardController';
import { DashboardPJController } from '../controllers/DashboardPJController';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';

const router = Router();

router.use(requireAuth);
router.use(requireWorkspaceType('PJ'));

router.get('/tenant', DashboardController.getTenantDashboard);
router.get('/super-adm', DashboardController.getSuperAdmDashboard);
router.get('/pj', DashboardPJController.getDashboardMetrics);
router.get('/pj/consolidated', DashboardPJController.getConsolidated);

export default router;
