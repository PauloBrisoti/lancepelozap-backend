import { Router } from 'express';
import { WebhookController } from '../controllers/WebhookController';
import { WuzapiController } from '../controllers/WuzapiController';

const router = Router();

// Rota pública, não pode ter middleware de autenticação JWT
router.post('/mercadopago', WebhookController.handleMercadoPago);

// Webhook receptor da WuzAPI (mensagens recebidas + status)
// Precisa de body raw para validação HMAC — express.raw() já aplicado no app.ts
router.post('/wuzapi', WuzapiController.handleWebhook);

export { router as webhookRoutes };
