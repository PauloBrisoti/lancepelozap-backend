import { Router } from 'express';
import { FinanceController } from '../controllers/FinanceController';
import { DreController } from '../controllers/DreController';
import { BankStatementController } from '../controllers/BankStatementController';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requirePlanFeature } from '../middleware/requirePlanFeature';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { validateUpload, IMAGE_KINDS, DOCUMENT_KINDS, SPREADSHEET_KINDS } from '../lib/fileValidation';
import { validate, payReceivableSchema, renegotiateSchema, bulkActionSchema } from '../lib/validation';

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
  destination: (_req, _file, cb) => {
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

const statementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv' || ext === '.ofx') {
      cb(null, true);
      return;
    }
    const error: any = new Error('Tipo de arquivo não permitido. Envie um extrato .csv ou .ofx.');
    error.status = 400;
    cb(error);
  },
});

const router = Router();

router.use(requireAuth);

router.get('/dashboard', requireStorePermission('gerenciar_financeiro'), FinanceController.getDashboard);

router.use(requireWorkspaceType('PJ'));

router.get('/categories', requireStorePermission('gerenciar_financeiro'), FinanceController.listCategories);
router.post('/categories', requireStorePermission('gerenciar_financeiro'), FinanceController.createCategory);
router.get('/wallets', requireStorePermission('gerenciar_financeiro'), FinanceController.listWallets);

router.get('/dre', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), DreController.getDre);
router.get('/dre/export', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), DreController.exportDre);
router.get('/transactions', requireStorePermission('gerenciar_financeiro'), FinanceController.getTransactions);
router.post('/transactions', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), upload.single('comprovante'), validateUpload([...IMAGE_KINDS, ...DOCUMENT_KINDS, ...SPREADSHEET_KINDS]), FinanceController.addTransaction);
router.put('/transactions/:id', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), FinanceController.updateTransaction);

router.get('/bank-statements', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), BankStatementController.listImports);
router.post('/bank-statements/import', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), statementUpload.single('file'), BankStatementController.importStatement);
router.get('/bank-statements/:importId/items', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), BankStatementController.listItems);
router.delete('/bank-statements/:importId', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), BankStatementController.deleteImport);
router.patch('/bank-statements/items/:itemId', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), BankStatementController.updateItem);
router.post('/bank-statements/items/:itemId/link', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), BankStatementController.linkItem);
router.post('/bank-statements/items/:itemId/unlink', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), BankStatementController.unlinkItem);
router.post('/bank-statements/reconcile', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), BankStatementController.reconcile);
router.post('/bank-statements/:importId/reconcile', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), BankStatementController.reconcile);

router.get('/receivables', requirePlanFeature('crediario'), FinanceController.getReceivables);
router.post('/receivables/:id/pay', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('crediario'), validate(payReceivableSchema), FinanceController.payReceivable);
router.post('/receivables/:id/renegotiate', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('crediario'), validate(renegotiateSchema), FinanceController.renegotiateReceivable);
router.patch('/receivables/:id/date', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('crediario'), FinanceController.updateReceivableDate);

router.get('/payables', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), FinanceController.getPayables);
router.post('/payables', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), FinanceController.createPayable);
router.put('/payables/:id', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), FinanceController.updatePayable);
router.post('/payables/:id/pay', requireStorePermission('gerenciar_financeiro'), requirePlanFeature('financeiro'), FinanceController.payPayable);
router.post('/bulk', requireStorePermission('gerenciar_financeiro'), validate(bulkActionSchema), FinanceController.bulkAction);



export default router;
