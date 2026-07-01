import { Router } from 'express';
import { DashboardController } from '../controllers/DashboardController';
import { DashboardPJController } from '../controllers/DashboardPJController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/tenant', requireAuth, DashboardController.getTenantDashboard);
router.get('/super-adm', requireAuth, DashboardController.getSuperAdmDashboard);
router.get('/pj', requireAuth, DashboardPJController.getDashboardMetrics);
router.get('/pj/consolidated', requireAuth, DashboardPJController.getConsolidated);

export default router;
