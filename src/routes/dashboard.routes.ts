import { Router } from 'express';
import { DashboardController } from '../controllers/DashboardController';
import { DashboardPJController } from '../controllers/DashboardPJController';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requireStorePermission } from '../middleware/requireStorePermission';

const router = Router();

router.use(requireAuth);
router.use(requireWorkspaceType('PJ'));

router.get('/super-adm', DashboardController.getSuperAdmDashboard);
router.get('/tenant', requireStorePermission('ver_financeiro'), DashboardController.getTenantDashboard);
router.get('/pj', requireStorePermission('ver_financeiro'), DashboardPJController.getDashboardMetrics);
router.get('/pj/consolidated', requireStorePermission('ver_financeiro'), DashboardPJController.getConsolidated);
router.get('/pj/seller-performance', requireStorePermission('ver_financeiro'), DashboardPJController.getSellerPerformance);

export default router;
