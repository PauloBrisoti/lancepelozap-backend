import { Router } from 'express';
import { InsightsController } from '../controllers/InsightsController';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requireStorePermission } from '../middleware/requireStorePermission';

export const insightsRouter = Router();

insightsRouter.use(requireAuth);
insightsRouter.use(requireWorkspaceType('PJ'));
insightsRouter.use(requireStorePermission('ver_financeiro'));

insightsRouter.get('/forecast', InsightsController.getForecast);
insightsRouter.get('/stock-recommendations', InsightsController.getStockRecommendations);
insightsRouter.get('/anomalies', InsightsController.getAnomalies);
