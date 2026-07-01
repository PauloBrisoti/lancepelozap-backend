import { Router } from 'express';
import { SupportTicketController } from '../controllers/SupportTicketController';
import { requireAuth } from '../middleware/auth';

import multer from 'multer';

const router = Router();
const supportController = new SupportTicketController();

// Configuração multer para anexos temporários locais
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

router.use(requireAuth);

// Lojista
router.post('/my', upload.single('anexo'), supportController.createTicket.bind(supportController));
router.get('/my', supportController.listMyTickets.bind(supportController));

// Super Admin
router.get('/all', supportController.listAllTickets.bind(supportController));
router.put('/:id/status', supportController.updateTicketStatus.bind(supportController));

// Comum
router.post('/:id/reply', supportController.replyTicket.bind(supportController));

export { router as supportRoutes };
