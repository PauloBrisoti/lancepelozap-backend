import { Router } from 'express';
import { InsightsController } from '../controllers/InsightsController';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';

export const insightsRouter = Router();

insightsRouter.use(requireAuth);
insightsRouter.use(requireWorkspaceType('PJ'));

insightsRouter.get('/forecast', InsightsController.getForecast);
insightsRouter.get('/stock-recommendations', InsightsController.getStockRecommendations);
insightsRouter.get('/anomalies', InsightsController.getAnomalies);
