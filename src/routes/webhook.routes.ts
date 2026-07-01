import { Router } from 'express';
import { WebhookController } from '../controllers/WebhookController';

const router = Router();

// Rota pública, não pode ter middleware de autenticação JWT
router.post('/mercadopago', WebhookController.handleMercadoPago);

export { router as webhookRoutes };
