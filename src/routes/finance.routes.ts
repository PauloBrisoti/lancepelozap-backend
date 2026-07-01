import { Router } from 'express';
import { FinanceController } from '../controllers/FinanceController';
import { DreController } from '../controllers/DreController';
import { requireAuth } from '../middleware/auth';
import { requirePlanFeature } from '../middleware/requirePlanFeature';

import multer from 'multer';
import path from 'path';
import fs from 'fs';

const ALLOWED_MIMES = [
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'text/csv',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function sanitizeFileName(original: string): string {
  const ext = path.extname(original).toLowerCase();
  const safeName = original
    .replace(ext, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 50);
  return `${Date.now()}-${safeName}${ext}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, sanitizeFileName(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de arquivo não permitido: ${file.mimetype}. Use JPEG, PNG, WebP, PDF, XLSX ou CSV.`));
    }
  },
});

const router = Router();

router.use(requireAuth);

router.get('/dre', requirePlanFeature('financeiro'), DreController.getDre);
router.get('/dre/export', requirePlanFeature('financeiro'), DreController.exportDre);

router.get('/dashboard', FinanceController.getDashboard);
router.get('/transactions', FinanceController.getTransactions);
router.post('/transactions', requirePlanFeature('financeiro'), upload.single('comprovante'), FinanceController.addTransaction);
router.put('/transactions/:id', requirePlanFeature('financeiro'), FinanceController.updateTransaction);
router.get('/receivables', requirePlanFeature('crediario'), FinanceController.getReceivables);
router.post('/receivables/:id/pay', requirePlanFeature('crediario'), FinanceController.payReceivable);
router.post('/receivables/:id/renegotiate', requirePlanFeature('crediario'), FinanceController.renegotiateReceivable);

router.get('/payables', requirePlanFeature('financeiro'), FinanceController.getPayables);
router.post('/payables', requirePlanFeature('financeiro'), FinanceController.createPayable);
router.put('/payables/:id', requirePlanFeature('financeiro'), FinanceController.updatePayable);
router.post('/payables/:id/pay', requirePlanFeature('financeiro'), FinanceController.payPayable);

router.post('/bulk', requirePlanFeature('financeiro'), FinanceController.bulkAction);

export default router;
