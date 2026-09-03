import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { SubscriptionController } from '../controllers/SubscriptionController';
import { requireAuth } from '../middleware/auth';
import { requireStrictSuperAdmin } from '../middleware/requireStrictSuperAdmin';
import { autoAudit } from '../middleware/autoAudit';
import { validateUpload, IMAGE_KINDS, DOCUMENT_KINDS } from '../lib/fileValidation';
import { rateLimitDistributed, limitFor } from '../lib/rateLimit';

const router = Router();

// Rate limiting específico do envio de comprovantes (anti-DoS / anti-flood
// de arquivos falsos): 5/min e 15/hora por usuário + IP.
const pixProofLimiter = rateLimitDistributed({
  keyPrefix: 'pix-proof',
  keys: { ip: true, user: true },
  limits: [
    { windowMs: 60 * 1000, max: limitFor(5) },
    { windowMs: 60 * 60 * 1000, max: limitFor(15) },
  ],
  message: 'Muitos envios de comprovante. Tente novamente em instantes.',
});

// Upload de comprovante (jpg/png/pdf, máx. 5MB) salvo fora da raiz pública
// (backend/uploads/pix-proofs), com nome randomizado e validação de magic
// bytes no middleware validateUpload. O arquivo é servido exclusivamente
// pelo endpoint autenticado GET /payment-proofs/:id/file.
const pixProofStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'pix-proofs');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `pix-proof-${crypto.randomBytes(12).toString('hex')}${ext}`);
  },
});

const pixProofUpload = multer({
  storage: pixProofStorage,
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      const err = new Error('Formato não suportado. Use .jpg, .png ou .pdf');
      (err as Error & { status: number }).status = 400;
      cb(err);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

router.use(requireAuth);
router.use(autoAudit());

router.get('/all', requireStrictSuperAdmin, SubscriptionController.listAll);
router.get('/me', SubscriptionController.getMySubscription);
router.post('/plan', SubscriptionController.updatePlan);
router.post('/change-request', SubscriptionController.requestPlanChange);
router.put('/:id/toggle-block', requireStrictSuperAdmin, SubscriptionController.toggleBlock);

// ==========================================
// RENOVAÇÃO MANUAL VIA PIX
// ==========================================
router.get('/pix-config', SubscriptionController.getPixConfig);
router.post('/payment-proof', pixProofLimiter, pixProofUpload.single('file'), validateUpload([...IMAGE_KINDS, ...DOCUMENT_KINDS].filter(k => k === 'jpeg' || k === 'png' || k === 'pdf')), SubscriptionController.submitPaymentProof);
router.get('/payment-proofs', SubscriptionController.getMyPaymentProofs);
router.get('/payment-proofs/:id/file', SubscriptionController.getPaymentProofFile);

export default router;