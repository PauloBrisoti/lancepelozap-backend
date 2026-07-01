import { Router } from 'express';
import { ImportController } from '../controllers/ImportController';
import { LegacyImportController } from '../controllers/LegacyImportController';
import { PdfCatalogController } from '../controllers/PdfCatalogController';
import { requireAuth } from '../middleware/auth';
import multer from 'multer';
import path from 'path';

const router = Router();
const importController = new ImportController();

// Configuração do multer temporária para CSV
const upload = multer({ 
  dest: 'uploads/temp/',
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.csv', '.xlsx', '.pdf'];
    const isAllowed = allowedExtensions.some(ext => file.originalname.toLowerCase().endsWith(ext));
    if (isAllowed || file.mimetype.includes('csv') || file.mimetype.includes('excel') || file.mimetype.includes('spreadsheetml') || file.mimetype.includes('pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos CSV, Excel (.xlsx) ou PDF são permitidos.'));
    }
  }
});

import { SmartImportController } from '../controllers/SmartImportController';

router.use(requireAuth);

router.post('/clientes', upload.single('file'), importController.importCustomers.bind(importController));
router.post('/produtos', upload.single('file'), importController.importProducts.bind(importController));
router.post('/legacy', upload.single('file'), LegacyImportController.importLegacy);
router.post('/pdf-catalog', upload.single('file'), PdfCatalogController.importPdfCatalog);
router.post('/smart', upload.single('file'), SmartImportController.importSmart);
router.post('/smart/hard-reset', SmartImportController.hardReset);

export { router as importRoutes };
