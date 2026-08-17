import { Router } from 'express';
import { ImportController } from '../controllers/ImportController';
import { LegacyImportController } from '../controllers/LegacyImportController';
import { PdfCatalogController } from '../controllers/PdfCatalogController';
import { requireAuth } from '../middleware/auth';
import { validateUpload, SPREADSHEET_KINDS, DOCUMENT_KINDS } from '../lib/fileValidation';
import multer from 'multer';

const router = Router();
const importController = new ImportController();

// Configuração do multer temporária para CSV
const upload = multer({ 
  dest: 'uploads/temp/',
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (_req, file, cb) => {
    const allowedExtensions = ['.csv', '.xlsx', '.pdf'];
    const isAllowed = allowedExtensions.some(ext => file.originalname.toLowerCase().endsWith(ext));
    if (isAllowed) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos CSV, Excel (.xlsx) ou PDF são permitidos.'));
    }
  }
});

import { SmartImportController } from '../controllers/SmartImportController';
import { rateLimitDistributed, limitFor } from '../lib/rateLimit';

router.use(requireAuth);

// Rotas que consomem IA (Gemini = custo por chamada): limite apertado,
// distribuído, por IP e por usuário, nas janelas de minuto e hora.
const aiLimiter = rateLimitDistributed({
  keyPrefix: 'import-ai',
  keys: { ip: true, user: true },
  limits: [
    { windowMs: 60 * 1000, max: limitFor(5) },
    { windowMs: 60 * 60 * 1000, max: limitFor(20) },
  ],
  message: "Limite de importações inteligentes atingido. Tente novamente mais tarde.",
});

router.post('/clientes', upload.single('file'), validateUpload(SPREADSHEET_KINDS), importController.importCustomers.bind(importController));
router.post('/produtos', upload.single('file'), validateUpload(SPREADSHEET_KINDS), importController.importProducts.bind(importController));
router.post('/legacy', upload.single('file'), validateUpload(SPREADSHEET_KINDS), LegacyImportController.importLegacy);
router.post('/pdf-catalog', aiLimiter, upload.single('file'), validateUpload(DOCUMENT_KINDS), PdfCatalogController.importPdfCatalog);
router.post('/smart', aiLimiter, upload.single('file'), validateUpload([...SPREADSHEET_KINDS, ...DOCUMENT_KINDS]), SmartImportController.importSmart);
router.post('/smart/hard-reset', aiLimiter, SmartImportController.hardReset);

export { router as importRoutes };
