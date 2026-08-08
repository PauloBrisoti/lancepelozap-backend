import { Router } from 'express';
import { FinanceController } from '../controllers/FinanceController';
import { DreController } from '../controllers/DreController';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requirePlanFeature } from '../middleware/requirePlanFeature';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { validateUpload, IMAGE_KINDS, DOCUMENT_KINDS, SPREADSHEET_KINDS } from '../lib/fileValidation';

import multer from 'multer';
import path from 'path';
import fs from 'fs';

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.xlsx', '.csv'];

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
    // SEGURANÇA: prefixo com storeId permite ao /uploads conferir o dono do arquivo
    const storeId = (req as any).user?.storeId || 'sem-loja';
    cb(null, `${storeId}--${sanitizeFileName(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de arquivo não permitido: ${ext}. Use JPEG, PNG, WebP, PDF, XLSX ou CSV.`));
    }
  },
});

const router = Router();

router.use(requireAuth);

router.get('/dashboard', requireStorePermission('gerenciar_financeiro'), FinanceController.getDashboard);

router.use(requireWorkspaceType('PJ'));

router.get('/categories', requireStorePermission('gerenciar_financeiro'), FinanceController.listCategories);
router.post('/categories', requireStorePermission('gerenciar_financeiro'), FinanceController.createCategory);

router.get('/dre', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), DreController.getDre);
router.get('/dre/export', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), DreController.exportDre);
router.get('/transactions', requireStorePermission('gerenciar_financeiro'), FinanceController.getTransactions);
router.post('/transactions', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), upload.single('comprovante'), validateUpload([...IMAGE_KINDS, ...DOCUMENT_KINDS, ...SPREADSHEET_KINDS]), FinanceController.addTransaction);
router.put('/transactions/:id', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), FinanceController.updateTransaction);
router.get('/receivables', requirePlanFeature('crediario'), FinanceController.getReceivables);
router.post('/receivables/:id/pay', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('crediario'), FinanceController.payReceivable);
router.post('/receivables/:id/renegotiate', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('crediario'), FinanceController.renegotiateReceivable);

router.get('/payables', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), FinanceController.getPayables);
router.post('/payables', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), FinanceController.createPayable);
router.put('/payables/:id', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), FinanceController.updatePayable);
router.post('/payables/:id/pay', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), FinanceController.payPayable);

router.post('/bulk', requireStorePermission('gerenciar_financeiro'), FinanceController.bulkAction);

export default router;
