import { Router } from 'express';
import { WuzapiController } from '../controllers/WuzapiController';
import { WhatsAppConfigController } from '../controllers/WhatsAppConfigController';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Rotas protegidas (requerem JWT)
router.use(requireAuth);

// Gerenciamento de sessões
router.post('/sessions', WuzapiController.createSession);
router.get('/sessions', WuzapiController.listSessions);
router.get('/sessions/:id/status', WuzapiController.getStatus);
router.get('/sessions/:id/qr', WuzapiController.getQRCode);
router.post('/sessions/:id/logout', WuzapiController.logout);
router.delete('/sessions/:id', WuzapiController.deleteSession);

// Envio de mensagens
router.post('/send', WuzapiController.sendText);
router.post('/check-number', WuzapiController.checkNumber);

// Configuração WhatsApp da loja
router.get('/config', WhatsAppConfigController.getConfig);
router.put('/config', WhatsAppConfigController.updateConfig);

// Regras de cobrança
router.get('/config/rules', WhatsAppConfigController.getRules);
router.post('/config/rules', WhatsAppConfigController.createRule);
router.put('/config/rules/:ruleId', WhatsAppConfigController.updateRule);
router.delete('/config/rules/:ruleId', WhatsAppConfigController.deleteRule);

// Logs de mensagens
router.get('/logs', WhatsAppConfigController.getLogs);

export { router as wuzapiRoutes };
