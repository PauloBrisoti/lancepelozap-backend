import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requirePlanFeature } from '../middleware/requirePlanFeature';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { WhatsAppController } from '../controllers/WhatsAppController';
import { rateLimitDistributed, limitFor } from '../lib/rateLimit';

const router = Router();
const ctrl = new WhatsAppController();

// Rate limit para endpoints que consomem API externa (WhatsApp = pago).
// Distribuído: por IP e por usuário, janelas de minuto e hora.
const whatsappLimiter = rateLimitDistributed({
  keyPrefix: 'whatsapp-send',
  keys: { ip: true, user: true },
  limits: [
    { windowMs: 60 * 1000, max: limitFor(10) },
    { windowMs: 60 * 60 * 1000, max: limitFor(120) },
  ],
  message: "Muitas requisições. Aguarde um momento.",
});

const campaignLimiter = rateLimitDistributed({
  keyPrefix: 'whatsapp-campaign',
  keys: { ip: true, user: true },
  limits: [{ windowMs: 60 * 60 * 1000, max: limitFor(5) }],
  message: "Limite de campanhas atingido. Tente novamente mais tarde.",
});

router.use(requireAuth);
router.use(requireWorkspaceType('PJ'));
router.use(requirePlanFeature('whatsapp'));

// Config (chave de API = credencial: só quem gerencia a loja altera)
router.get('/config', ctrl.getConfig.bind(ctrl));
router.put('/config', requireStorePermission('configurar_loja'), ctrl.updateConfig.bind(ctrl));
router.post('/test', requireStorePermission('gerenciar_clientes'), whatsappLimiter, ctrl.testConnection.bind(ctrl));

// Send (com rate limit)
router.post('/send', requireStorePermission('gerenciar_clientes'), whatsappLimiter, ctrl.sendMessage.bind(ctrl));
router.post('/send-portal-link', requireStorePermission('gerenciar_clientes'), whatsappLimiter, ctrl.sendPortalLink.bind(ctrl));

// Campaign (rate limit mais restritivo)
router.post('/campaign', requireStorePermission('gerenciar_clientes'), campaignLimiter, ctrl.sendCampaign.bind(ctrl));

// Templates
router.get('/templates', ctrl.listTemplates.bind(ctrl));
router.post('/templates', requireStorePermission('gerenciar_clientes'), ctrl.createTemplate.bind(ctrl));
router.put('/templates/:id', requireStorePermission('gerenciar_clientes'), ctrl.updateTemplate.bind(ctrl));
router.delete('/templates/:id', requireStorePermission('gerenciar_clientes'), ctrl.deleteTemplate.bind(ctrl));

// QR Code (conexão da API = configuração da loja)
router.post('/qrcode', requireStorePermission('configurar_loja'), ctrl.getQRCode.bind(ctrl));
router.get('/qrcode/status', ctrl.getQRCodeStatus.bind(ctrl));

// Logs
router.get('/logs', ctrl.listLogs.bind(ctrl));

export { router as whatsappRoutes };
