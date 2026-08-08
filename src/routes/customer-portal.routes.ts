import { Router } from 'express';
import { CustomerPortalController } from '../controllers/CustomerPortalController';
import rateLimit from 'express-rate-limit';

const router = Router();
const controller = new CustomerPortalController();

// SEGURANÇA: o token do link é trocado por uma sessão curta — nunca fica na URL.
// O POST /session tem limite de tentativas para dificultar "adivinhação" de tokens.
const sessionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { message: 'Muitas tentativas. Tente novamente em instantes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/session', sessionLimiter, controller.createSession.bind(controller));
router.get('/profile', controller.getProfile.bind(controller));
router.put('/profile', controller.updateProfile.bind(controller));
router.get('/sales', controller.getSales.bind(controller));
router.get('/receivables', controller.getReceivables.bind(controller));

export { router as customerPortalRoutes };
