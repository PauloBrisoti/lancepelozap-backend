import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { WhatsAppController } from '../controllers/WhatsAppController';
import rateLimit from 'express-rate-limit';

const router = Router();
const ctrl = new WhatsAppController();

// Rate limit para endpoints que consomem API externa (WhatsApp = pago)
const whatsappLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // máximo 10 chamadas por minuto
  message: { error: "Muitas requisições. Aguarde um momento." },
  standardHeaders: true,
  legacyHeaders: false,
});

const campaignLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5, // máximo 5 campanhas por hora
  message: { error: "Limite de campanhas atingido. Tente novamente mais tarde." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(requireAuth);

// Config
router.get('/config', ctrl.getConfig.bind(ctrl));
router.put('/config', ctrl.updateConfig.bind(ctrl));
router.post('/test', whatsappLimiter, ctrl.testConnection.bind(ctrl));

// Send (com rate limit)
router.post('/send', whatsappLimiter, ctrl.sendMessage.bind(ctrl));
router.post('/send-portal-link', whatsappLimiter, ctrl.sendPortalLink.bind(ctrl));

// Campaign (rate limit mais restritivo)
router.post('/campaign', campaignLimiter, ctrl.sendCampaign.bind(ctrl));

// Templates
router.get('/templates', ctrl.listTemplates.bind(ctrl));
router.post('/templates', ctrl.createTemplate.bind(ctrl));
router.put('/templates/:id', ctrl.updateTemplate.bind(ctrl));
router.delete('/templates/:id', ctrl.deleteTemplate.bind(ctrl));

// QR Code
router.post('/qrcode', ctrl.getQRCode.bind(ctrl));
router.get('/qrcode/status', ctrl.getQRCodeStatus.bind(ctrl));

// Logs
router.get('/logs', ctrl.listLogs.bind(ctrl));

export { router as whatsappRoutes };
