import { Router } from 'express';
import { CommissionRuleController } from '../controllers/CommissionRuleController';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requireStorePermission } from '../middleware/requireStorePermission';
import { requirePlanFeature } from '../middleware/requirePlanFeature';
import { autoAudit } from '../middleware/autoAudit';
import { z } from 'zod';
import { validate } from '../lib/validation';

const router = Router();
const controller = new CommissionRuleController();

const ruleSchema = z.object({
  userId: z.string().min(1, 'Usuário é obrigatório'),
  categoryId: z.string().optional().nullable(),
  percentual: z.number().min(0, 'Percentual deve ser >= 0').max(100, 'Percentual deve ser <= 100'),
  ativo: z.boolean().optional().default(true),
});

const ruleUpdateSchema = z.object({
  percentual: z.number().min(0).max(100).optional(),
  categoryId: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
});

router.use(requireAuth);
router.use(requireWorkspaceType('PJ'));
router.use(requirePlanFeature('comissoes'));
router.use(autoAudit());

router.get('/', controller.list.bind(controller));
router.post('/',
  requireStorePermission('gerenciar_funcionarios'),
  validate(ruleSchema),
  controller.create.bind(controller)
);
router.put('/:id',
  requireStorePermission('gerenciar_funcionarios'),
  validate(ruleUpdateSchema),
  controller.update.bind(controller)
);
router.delete('/:id',
  requireStorePermission('gerenciar_funcionarios'),
  controller.remove.bind(controller)
);

export { router as commissionRoutes };
