import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middleware/auth';
import { validateUpload, SPREADSHEET_KINDS } from '../lib/fileValidation';
import { PlanilhaController } from '../controllers/PlanilhaController';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const storeId = (req as any).user?.storeId || 'sem-loja';
    cb(null, `${storeId}--planilha-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Formato não suportado. Use .xlsx, .xls ou .csv'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const router = Router();
const controller = new PlanilhaController();

router.use(requireAuth);

// POST /api/planilha/preview — Preview sem salvar
router.post('/preview', upload.single('file'), validateUpload(SPREADSHEET_KINDS), controller.preview.bind(controller));

// POST /api/planilha/import — Importar com checkpoint
router.post('/import', upload.single('file'), validateUpload(SPREADSHEET_KINDS), controller.import.bind(controller));

export { router as planilhaRoutes };
