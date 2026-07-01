import { Router } from 'express';
import { CatalogoController } from '../controllers/CatalogoController';

const router = Router();

// Rota PÚBLICA — sem requireAuth
router.get('/:storeId', CatalogoController.getPublicCatalog);

export { router as catalogoRoutes };
