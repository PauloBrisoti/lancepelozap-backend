import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { PersonalTransactionController } from '../controllers/personal/PersonalTransactionController';
import { PersonalCategoryController } from '../controllers/personal/PersonalCategoryController';
import { PersonalDashboardController } from '../controllers/personal/PersonalDashboardController';
import { PersonalAIAnalysisController } from '../controllers/personal/PersonalAIAnalysisController';
import { PersonalWalletController } from '../controllers/personal/PersonalWalletController';

const router = Router();
router.use(requireAuth);

const transactionCtrl = new PersonalTransactionController();
const categoryCtrl = new PersonalCategoryController();
const dashboardCtrl = new PersonalDashboardController();
const aiCtrl = new PersonalAIAnalysisController();
const walletCtrl = new PersonalWalletController();

// Dashboard
router.get('/dashboard', dashboardCtrl.dashboard.bind(dashboardCtrl));
router.get('/budgets', dashboardCtrl.budgetSummary.bind(dashboardCtrl));
router.post('/budgets', dashboardCtrl.upsertBudget.bind(dashboardCtrl));

// Transactions
router.get('/transactions', transactionCtrl.list.bind(transactionCtrl));
router.post('/transactions', transactionCtrl.create.bind(transactionCtrl));
router.put('/transactions/:id', transactionCtrl.update.bind(transactionCtrl));
router.delete('/transactions/:id', transactionCtrl.delete.bind(transactionCtrl));

// Categories
router.get('/categories', categoryCtrl.list.bind(categoryCtrl));
router.post('/categories', categoryCtrl.create.bind(categoryCtrl));
router.put('/categories/:id', categoryCtrl.update.bind(categoryCtrl));
router.delete('/categories/:id', categoryCtrl.delete.bind(categoryCtrl));

// AI Analysis
router.get('/ai-analysis', aiCtrl.analysis.bind(aiCtrl));

// Cycle Config
router.get('/cycle-config', dashboardCtrl.getCycleConfig.bind(dashboardCtrl));
router.put('/cycle-config', dashboardCtrl.updateCycleConfig.bind(dashboardCtrl));

// Wallets
router.get('/wallets', walletCtrl.list.bind(walletCtrl));
router.post('/wallets', walletCtrl.create.bind(walletCtrl));
router.delete('/wallets/:id', walletCtrl.delete.bind(walletCtrl));

export { router as personalFinanceRoutes };
