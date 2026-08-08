import { Router, Request, Response, NextFunction } from 'express';
import { SuperAdminController } from '../controllers/SuperAdminController';
import { InternalTeamController } from '../controllers/InternalTeamController';
import { PlanController } from '../controllers/PlanController';
import { requireAuth } from '../middleware/auth';
import { requireInternalTeam } from '../middleware/requireInternalTeam';
import { requireAdmin2FA } from '../middleware/requireAdmin2FA';
import { requireInternalPermission } from '../middleware/requireInternalPermission';
import { requireDestructiveConfirmation } from '../middleware/requireDestructiveConfirmation';
import { scopedClientFilter, requireScopedClientParam, requireScopedStoreParam, requireScopedUserParam, requireScopedSubscriptionParam, requireScopedInvoiceParam } from '../middleware/requireClientScope';
import { requireStrictSuperAdmin } from '../middleware/requireStrictSuperAdmin';
import { rateLimitDistributed } from '../lib/rateLimit';

const router = Router();
const superAdminController = new SuperAdminController();
const teamController = new InternalTeamController();
const planController = new PlanController();

// Broadcast de notificação limitado (10/hora por usuário) — evita spam
// in-app para todos os usuários do SaaS.
const notificationLimiter = rateLimitDistributed({
  keyPrefix: 'rl:superadmin:notif',
  limits: [{ windowMs: 60 * 60 * 1000, max: 10 }],
  keys: { ip: true, user: true },
  message: 'Limite de envio de notificações atingido (10/hora).',
});

// Todas as rotas deste arquivo requerem autenticação
router.use(requireAuth);
// 2FA obrigatório para equipe interna/SUPER_ADMIN em produção
router.use(requireAdmin2FA);

// ==========================================
// MÓDULO DE EQUIPE INTERNA (Restrito a SUPER_ADMIN real)
// ==========================================
router.get('/team/users', requireStrictSuperAdmin, teamController.listUsers.bind(teamController));
router.post('/team/invite', requireStrictSuperAdmin, teamController.inviteUser.bind(teamController));
router.patch('/team/users/:id/role', requireStrictSuperAdmin, teamController.changeRole.bind(teamController));
router.patch('/team/users/:id/expiry', requireStrictSuperAdmin, teamController.updateUserExpiry.bind(teamController));
router.delete('/team/users/:id', requireStrictSuperAdmin, teamController.revokeAccess.bind(teamController));
router.get('/team/roles', requireStrictSuperAdmin, teamController.listRoles.bind(teamController));
router.post('/team/roles', requireStrictSuperAdmin, teamController.createRole.bind(teamController));
router.put('/team/roles/:id', requireStrictSuperAdmin, teamController.updateRole.bind(teamController));
router.put('/team/roles/:id/permissions', requireStrictSuperAdmin, teamController.updateRolePermissions.bind(teamController));
router.delete('/team/roles/:id', requireStrictSuperAdmin, teamController.deleteRole.bind(teamController));

// ==========================================
// ROTAS DE MÓDULOS ESPECÍFICOS (Com RBAC)
// ==========================================

// Dashboard: métricas globais do SaaS — apenas equipe interna (papel interno
// ou SUPER_ADMIN nativo); lojistas comuns são bloqueados aqui.
router.get('/dashboard', requireInternalTeam, scopedClientFilter, superAdminController.getDashboard.bind(superAdminController));

// Módulo Clientes
router.get('/clients', requireInternalPermission('CLIENTES', 'VIEW'), scopedClientFilter, superAdminController.getAllClients.bind(superAdminController));
router.get('/clients/:id', requireInternalPermission('CLIENTES', 'VIEW'), requireScopedClientParam, superAdminController.getClientById.bind(superAdminController));
router.post('/clients', requireInternalPermission('CLIENTES', 'FULL'), superAdminController.createClient.bind(superAdminController));
router.put('/clients/:id', requireInternalPermission('CLIENTES', 'FULL'), requireScopedClientParam, superAdminController.updateClient.bind(superAdminController));
router.delete('/clients/:id', requireInternalPermission('CLIENTES', 'FULL'), requireScopedClientParam, superAdminController.deleteClient.bind(superAdminController));
router.get('/clients/:id/users', requireInternalPermission('CLIENTES', 'VIEW'), requireScopedClientParam, superAdminController.getClientUsers.bind(superAdminController));
router.get('/clients/:clientId/usage', requireInternalPermission('CLIENTES', 'VIEW'), requireScopedClientParam, superAdminController.getUsageMetrics.bind(superAdminController));
router.post('/clients/:clientId/add-pf-control', requireInternalPermission('CLIENTES', 'FULL'), requireScopedClientParam, superAdminController.addPfControl.bind(superAdminController));

// Módulo Configurações (White-label, Backup, Manutenção, API Keys)
router.get('/settings', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.getSystemSettings.bind(superAdminController));
router.put('/settings', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.updateSystemSettings.bind(superAdminController));
router.get('/settings/lockdown', requireStrictSuperAdmin, superAdminController.getLockdown.bind(superAdminController));
router.put('/settings/lockdown', requireStrictSuperAdmin, requireDestructiveConfirmation, superAdminController.setLockdown.bind(superAdminController));

// Anúncios in-app
router.get('/announcements', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.listAnnouncements.bind(superAdminController));
router.put('/announcements', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.saveAnnouncements.bind(superAdminController));

// Feature Flags
router.get('/feature-flags', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.getFeatureFlags.bind(superAdminController));
router.put('/feature-flags', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.saveFeatureFlags.bind(superAdminController));

// Backup
router.get('/backups', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.listBackups.bind(superAdminController));
router.post('/backup', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.triggerBackup.bind(superAdminController));
router.get('/backups/:file/download', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.downloadBackup.bind(superAdminController));
router.delete('/backups/:file', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.deleteBackup.bind(superAdminController));

// Modo Manutenção
router.get('/maintenance', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.getMaintenanceMode.bind(superAdminController));
router.put('/maintenance', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.setMaintenanceMode.bind(superAdminController));

// API Keys
router.get('/api-keys', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.listApiKeys.bind(superAdminController));
router.put('/api-keys', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.saveApiKeys.bind(superAdminController));

// Logs do Servidor
router.get('/server-logs', requireInternalPermission('AUDITORIA', 'VIEW'), superAdminController.getServerLogs.bind(superAdminController));

// Módulo Notificações
router.get('/notifications', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.listNotifications.bind(superAdminController));
router.post('/notifications', requireInternalPermission('CONFIGURACOES', 'FULL'), notificationLimiter, superAdminController.sendNotification.bind(superAdminController));
router.put('/notifications/:id/read', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.markNotificationRead.bind(superAdminController));
router.put('/notifications/read-all', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.markAllNotificationsRead.bind(superAdminController));

// Módulo Email
router.post('/test-email', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.testEmail.bind(superAdminController));

// Módulo Relatórios Financeiros
router.get('/financial-reports', requireInternalPermission('FINANCEIRO', 'VIEW'), superAdminController.getFinancialReports.bind(superAdminController));

// Módulo Inadimplentes
router.get('/overdue', requireInternalPermission('FINANCEIRO', 'VIEW'), superAdminController.listOverdue.bind(superAdminController));
router.post('/trigger-billing', requireInternalPermission('FINANCEIRO', 'FULL'), superAdminController.triggerBilling.bind(superAdminController));

// ==========================================
// VARRE DURA FINANCEIRA (dry-run → confirmação → execução)
// ==========================================
router.get('/scan/plan', requireInternalPermission('FINANCEIRO', 'VIEW'), superAdminController.getScanPlan.bind(superAdminController));
router.post('/scan/execute', requireInternalPermission('FINANCEIRO', 'FULL'), requireDestructiveConfirmation, superAdminController.executeScan.bind(superAdminController));
router.get('/scan/runs', requireInternalPermission('FINANCEIRO', 'VIEW'), superAdminController.getScanRuns.bind(superAdminController));

// Módulo Assinaturas e Faturas
router.get('/subscriptions/:clientId/invoices', requireInternalPermission('CLIENTES', 'VIEW'), requireScopedClientParam, superAdminController.getClientInvoices.bind(superAdminController));
router.put('/subscriptions/:id/cancel', requireInternalPermission('FINANCEIRO', 'FULL'), requireScopedSubscriptionParam, superAdminController.cancelSubscription.bind(superAdminController));
router.put('/subscriptions/:id/plan', requireInternalPermission('FINANCEIRO', 'FULL'), requireScopedSubscriptionParam, superAdminController.changeSubscriptionPlan.bind(superAdminController));
router.post('/subscriptions/:id/invoices', requireInternalPermission('FINANCEIRO', 'FULL'), requireScopedSubscriptionParam, superAdminController.generateInvoice.bind(superAdminController));
router.put('/invoices/:id/pay', requireInternalPermission('FINANCEIRO', 'FULL'), requireScopedInvoiceParam, superAdminController.payInvoice.bind(superAdminController));

// Módulo Features por Loja
router.get('/stores/:storeId/features', requireInternalPermission('CLIENTES', 'VIEW'), requireScopedStoreParam, superAdminController.updateStoreFeatures.bind(superAdminController));
router.put('/stores/:storeId/features', requireInternalPermission('CLIENTES', 'FULL'), requireScopedStoreParam, superAdminController.updateStoreFeatures.bind(superAdminController));

// Módulo Planos
router.get('/plans', requireInternalPermission('PLANOS_E_MODULOS', 'VIEW'), planController.list.bind(planController));
router.post('/plans', requireInternalPermission('PLANOS_E_MODULOS', 'FULL'), planController.create.bind(planController));
router.put('/plans/:id', requireInternalPermission('PLANOS_E_MODULOS', 'FULL'), planController.update.bind(planController));
router.delete('/plans/:id', requireInternalPermission('PLANOS_E_MODULOS', 'FULL'), planController.delete.bind(planController));

// Módulo Monitoramento
router.get('/system-status', requireInternalPermission('AUDITORIA', 'VIEW'), superAdminController.getSystemStatus.bind(superAdminController));

// Módulo Auditoria
router.get('/audit-logs', requireInternalPermission('AUDITORIA', 'VIEW'), superAdminController.getAuditLogs.bind(superAdminController));

// Módulo Usuários e Senhas
router.get('/users/all', requireInternalPermission('CLIENTES', 'VIEW'), superAdminController.listAllUsers.bind(superAdminController));
router.put('/users/:id', requireInternalPermission('CLIENTES', 'FULL'), requireScopedUserParam, superAdminController.updateUser.bind(superAdminController));
router.put('/users/:id/reset-password', requireInternalPermission('CLIENTES', 'FULL'), requireScopedUserParam, superAdminController.resetUserPassword.bind(superAdminController));
router.post('/users/reset-all-passwords', requireStrictSuperAdmin, requireInternalPermission('CLIENTES', 'FULL'), requireDestructiveConfirmation, superAdminController.resetAllUserPasswords.bind(superAdminController));
router.delete('/users/:id', requireInternalPermission('CLIENTES', 'FULL'), requireScopedUserParam, superAdminController.deleteUser.bind(superAdminController));

// Módulo Aprovação de Cadastros
router.get('/pending-registrations', requireInternalPermission('CLIENTES', 'VIEW'), superAdminController.listPendingRegistrations.bind(superAdminController));
router.post('/pending-registrations/:id/approve', requireInternalPermission('CLIENTES', 'FULL'), requireScopedClientParam, superAdminController.approveRegistration.bind(superAdminController));
router.post('/pending-registrations/:id/reject', requireInternalPermission('CLIENTES', 'FULL'), requireScopedClientParam, superAdminController.rejectRegistration.bind(superAdminController));

// Módulo Reset de Banco
router.post('/reset-database', requireStrictSuperAdmin, requireInternalPermission('CONFIGURACOES', 'FULL'), requireDestructiveConfirmation, superAdminController.resetDatabase.bind(superAdminController));

// Módulo Acesso e Liberações (Impersonation)
router.post('/impersonate/:storeId', requireInternalPermission('ACESSO_E_LIBERACOES', 'FULL'), requireScopedStoreParam, superAdminController.impersonate.bind(superAdminController));
router.post('/revert-impersonate', superAdminController.revertImpersonation.bind(superAdminController));
router.get('/impersonation-logs', requireInternalPermission('ACESSO_E_LIBERACOES', 'VIEW'), superAdminController.getImpersonationLogs.bind(superAdminController));
router.post('/clients/:id/restore', requireInternalPermission('CLIENTES', 'FULL'), requireScopedClientParam, superAdminController.restoreClient.bind(superAdminController));
router.post('/clients/:id/purge', requireStrictSuperAdmin, requireInternalPermission('CLIENTES', 'FULL'), requireScopedClientParam, superAdminController.purgeClient.bind(superAdminController));

export { router as superAdminRoutes };
