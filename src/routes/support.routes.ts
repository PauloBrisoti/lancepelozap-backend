import { Router } from 'express';
import { SupportTicketController } from '../controllers/SupportTicketController';
import { requireAuth } from '../middleware/auth';
import { requireStrictSuperAdmin } from '../middleware/requireStrictSuperAdmin';
import { validateUpload, IMAGE_KINDS, DOCUMENT_KINDS, SPREADSHEET_KINDS } from '../lib/fileValidation';

import multer from 'multer';
import path from 'path';

const router = Router();
const supportController = new SupportTicketController();

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.csv', '.xlsx'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Configuração multer para anexos temporários locais
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    // SEGURANÇA: prefixo com storeId permite ao /uploads conferir o dono do arquivo
    const storeId = (req as any).user?.storeId || 'sem-loja';
    cb(null, `${storeId}--${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de arquivo não permitido: ${ext}. Use JPEG, PNG, WebP, GIF, PDF, CSV ou XLSX.`));
    }
  },
});

router.use(requireAuth);

// Lojista
router.post('/my', upload.single('anexo'), validateUpload([...IMAGE_KINDS, ...DOCUMENT_KINDS, ...SPREADSHEET_KINDS]), supportController.createTicket.bind(supportController));
router.get('/my', supportController.listMyTickets.bind(supportController));

// Super Admin
router.get('/all', requireStrictSuperAdmin, supportController.listAllTickets.bind(supportController));
router.put('/:id/status', requireStrictSuperAdmin, supportController.updateTicketStatus.bind(supportController));

// Comum
router.post('/:id/reply', supportController.replyTicket.bind(supportController));

export { router as supportRoutes };
