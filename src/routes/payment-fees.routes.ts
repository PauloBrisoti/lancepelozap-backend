import { Router } from 'express';
import { PaymentMethodFeeController } from '../controllers/PaymentMethodFeeController';
import { requireAuth } from '../middleware/auth';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { autoAudit } from '../middleware/autoAudit';
import { z } from 'zod';
import { validate } from '../lib/validation';

const router = Router();
const controller = new PaymentMethodFeeController();

const feeSchema = z.object({
  formaPagamento: z.enum(['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'CREDIARIO']),
  parcelas: z.number().int().positive().default(1),
  taxaPercentual: z.number().min(0).default(0),
  taxaFixa: z.number().min(0).default(0),
  prazoRecebimento: z.number().int().min(0).default(0),
});

const feeUpdateSchema = z.object({
  formaPagamento: z.enum(['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'CREDIARIO']).optional(),
  parcelas: z.number().int().positive().optional(),
  taxaPercentual: z.number().min(0).optional(),
  taxaFixa: z.number().min(0).optional(),
  prazoRecebimento: z.number().int().min(0).optional(),
});

router.use(requireAuth);
router.use(autoAudit());

router.get('/', controller.list.bind(controller));
router.post('/',
  requireStorePermission('gerenciar_financeiro'),
  validate(feeSchema),
  controller.create.bind(controller)
);
router.put('/:id',
  requireStorePermission('gerenciar_financeiro'),
  validate(feeUpdateSchema),
  controller.update.bind(controller)
);
router.delete('/:id',
  requireStorePermission('configurar_loja'),
  controller.remove.bind(controller)
);

export { router as paymentFeesRoutes };
