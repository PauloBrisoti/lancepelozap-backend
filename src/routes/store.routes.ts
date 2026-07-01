import { Router } from 'express';
import { StoreController } from '../controllers/StoreController';
import { requireAuth } from '../middleware/auth';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { z } from 'zod';
import { validate } from '../lib/validation';

const router = Router();
const controller = new StoreController();

const createStoreSchema = z.object({
  nomeFantasia: z.string().min(1, 'Nome da loja é obrigatório'),
  controlId: z.string().min(1, 'Controle é obrigatório'),
  cnpjCpf: z.string().optional(),
  nichoPrincipal: z.string().optional(),
  telefoneWhatsapp: z.string().optional(),
  emailContato: z.string().email().optional().or(z.literal('')),
  chavePix: z.string().optional(),
});

router.use(requireAuth);

router.get('/my', controller.listMyStores.bind(controller));
router.post('/my',
  requireStorePermission('configurar_loja'),
  validate(createStoreSchema),
  controller.createStore.bind(controller)
);
router.put('/my/:id',
  requireStorePermission('configurar_loja'),
  controller.updateStore.bind(controller)
);

export { router as storeRoutes };
