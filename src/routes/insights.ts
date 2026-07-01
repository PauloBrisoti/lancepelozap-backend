import { Router } from 'express';
import { InsightsController } from '../controllers/InsightsController';
import { requireAuth } from '../middleware/auth';

export const insightsRouter = Router();

insightsRouter.get('/forecast', requireAuth, InsightsController.getForecast);
insightsRouter.get('/stock-recommendations', requireAuth, InsightsController.getStockRecommendations);
insightsRouter.get('/anomalies', requireAuth, InsightsController.getAnomalies);
