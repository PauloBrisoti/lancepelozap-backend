import { Router } from 'express';
import { SettingsController } from '../controllers/SettingsController';
import { requireAuth } from '../middleware/auth';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { validateEmployeeLimit } from '../middleware/validateLimits';
import { validate, createUserSchema, tenantSettingsSchema } from '../lib/validation';
import multer from 'multer';
import path from 'path';

const router = Router();
const settingsController = new SettingsController();

// Configuração de multer para imagens (PIX)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, 'pix-' + uniqueSuffix + path.extname(file.originalname))
  }
});

const uploadPix = multer({ 
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas imagens são permitidas.'));
    }
  }
});

// Configurações da Loja
router.get('/tenant', requireAuth, settingsController.getTenantSettings.bind(settingsController));
router.put('/tenant', requireAuth, validate(tenantSettingsSchema), settingsController.updateTenantSettings.bind(settingsController));
router.post('/tenant/reset-revenue', requireAuth, settingsController.resetRevenue.bind(settingsController));

// Upload do QR Code PIX
router.post('/upload-pix', requireAuth, uploadPix.single('file'), settingsController.uploadPix.bind(settingsController));

// Gestão de Usuários / Equipe
router.get('/users', requireAuth, requireStorePermission('gerenciar_funcionarios'), settingsController.getUsers.bind(settingsController));
router.post('/users', requireAuth, requireStorePermission('gerenciar_funcionarios'), validateEmployeeLimit, validate(createUserSchema), settingsController.createUser.bind(settingsController));
router.put('/users/:id', requireAuth, requireStorePermission('gerenciar_funcionarios'), settingsController.updateUser.bind(settingsController));

export { router as settingsRoutes };
