import { Router } from 'express';
import { AccountingController } from '../controllers/AccountingController';
import { requireAuth } from '../middleware/auth';
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requireStorePermission } from '../middleware/requireStorePermission';

const router = Router();

router.use(requireAuth);
router.use(requireWorkspaceType('PJ'));

// 1. Plano de Contas
router.get(
  '/chart-of-accounts',
  requireStorePermission('gerenciar_financeiro'),
  AccountingController.listAccounts
);
router.post(
  '/chart-of-accounts',
  requireStorePermission('gerenciar_financeiro'),
  AccountingController.createAccount
);

// 2. Partidas Dobradas (Lançamentos Contábeis)
router.get(
  '/journal-entries',
  requireStorePermission('gerenciar_financeiro'),
  AccountingController.listJournalEntries
);
router.post(
  '/journal-entries',
  requireStorePermission('gerenciar_financeiro'),
  AccountingController.createManualEntry
);

// 3. Fechamento de Período Contábil (Governança e Blindagem Fiscal)
router.get(
  '/period-closes',
  requireStorePermission('gerenciar_financeiro'),
  AccountingController.listPeriodCloses
);
router.post(
  '/period-closes',
  requireStorePermission('gerenciar_financeiro'),
  AccountingController.closePeriod
);
router.post(
  '/period-closes/reopen',
  requireStorePermission('gerenciar_financeiro'),
  AccountingController.reopenPeriod
);

// 4. Retenções Fiscais (IRRF, ISS, PIS, COFINS, etc.)
router.get(
  '/tax-retentions',
  requireStorePermission('gerenciar_financeiro'),
  AccountingController.listTaxRetentions
);
router.post(
  '/tax-retentions',
  requireStorePermission('gerenciar_financeiro'),
  AccountingController.createTaxRetention
);

export default router;

