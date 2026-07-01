import { Router } from 'express';
import { BiController } from '../controllers/BiController';
import { requireAuth } from '../middleware/auth';
import { autoAudit } from '../middleware/autoAudit';

const router = Router();
const controller = new BiController();

router.use(requireAuth);
router.use(autoAudit());

router.get('/comparativo', controller.comparativo.bind(controller));
router.get('/abc-curve', controller.abcCurve.bind(controller));
router.get('/profitability', controller.profitability.bind(controller));
router.get('/sales-heatmap', controller.salesHeatmap.bind(controller));
router.get('/top-flop', controller.topFlop.bind(controller));

export { router as biRoutes };
