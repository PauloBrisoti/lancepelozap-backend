import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middleware/auth';
import { PlanilhaController } from '../controllers/PlanilhaController';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `planilha-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
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
router.post('/preview', upload.single('file'), controller.preview.bind(controller));

// POST /api/planilha/import — Importar com checkpoint
router.post('/import', upload.single('file'), controller.import.bind(controller));

export { router as planilhaRoutes };
