import { Router, Request, Response, NextFunction } from 'express';
import { SuperAdminController } from '../controllers/SuperAdminController';
import { InternalTeamController } from '../controllers/InternalTeamController';
import { PlanController } from '../controllers/PlanController';
import { requireAuth } from '../middleware/auth';
import { requireInternalPermission } from '../middleware/requireInternalPermission';

const router = Router();
const superAdminController = new SuperAdminController();
const teamController = new InternalTeamController();
const planController = new PlanController();

// Todas as rotas deste arquivo requerem autenticação
router.use(requireAuth);

const requireStrictSuperAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Acesso negado. Apenas SUPER_ADMIN.' });
  }
  next();
};

// ==========================================
// MÓDULO DE EQUIPE INTERNA (Restrito a SUPER_ADMIN real)
// ==========================================
router.get('/team/users', requireStrictSuperAdmin, teamController.listUsers.bind(teamController));
router.post('/team/invite', requireStrictSuperAdmin, teamController.inviteUser.bind(teamController));
router.patch('/team/users/:id/role', requireStrictSuperAdmin, teamController.changeRole.bind(teamController));
router.delete('/team/users/:id', requireStrictSuperAdmin, teamController.revokeAccess.bind(teamController));
router.get('/team/roles', requireStrictSuperAdmin, teamController.listRoles.bind(teamController));
router.put('/team/roles/:id/permissions', requireStrictSuperAdmin, teamController.updateRolePermissions.bind(teamController));

// ==========================================
// ROTAS DE MÓDULOS ESPECÍFICOS (Com RBAC)
// ==========================================

// Dashboard: Mínimo necessário é visualizar Clientes ou Financeiro, mas por hora vamos proteger só com a auth e o controller resolve
router.get('/dashboard', superAdminController.getDashboard.bind(superAdminController));

// Módulo Clientes
router.get('/clients', requireInternalPermission('CLIENTES', 'VIEW'), superAdminController.getAllClients.bind(superAdminController));
router.post('/clients', requireInternalPermission('CLIENTES', 'FULL'), superAdminController.createClient.bind(superAdminController));
router.put('/clients/:id', requireInternalPermission('CLIENTES', 'FULL'), superAdminController.updateClient.bind(superAdminController));
router.delete('/clients/:id', requireInternalPermission('CLIENTES', 'FULL'), superAdminController.deleteClient.bind(superAdminController));
router.get('/clients/:id/users', requireInternalPermission('CLIENTES', 'VIEW'), superAdminController.getClientUsers.bind(superAdminController));
router.get('/clients/:clientId/usage', requireInternalPermission('CLIENTES', 'VIEW'), superAdminController.getUsageMetrics.bind(superAdminController));

// Módulo Configurações (White-label, Backup, Manutenção, API Keys)
router.get('/settings', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.getSystemSettings.bind(superAdminController));
router.put('/settings', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.updateSystemSettings.bind(superAdminController));

// Anúncios in-app
router.get('/announcements', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.listAnnouncements.bind(superAdminController));
router.put('/announcements', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.saveAnnouncements.bind(superAdminController));

// Feature Flags
router.get('/feature-flags', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.getFeatureFlags.bind(superAdminController));
router.put('/feature-flags', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.saveFeatureFlags.bind(superAdminController));

// Backup
router.get('/backups', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.listBackups.bind(superAdminController));
router.post('/backup', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.triggerBackup.bind(superAdminController));
router.get('/backups/:file/download', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.downloadBackup.bind(superAdminController));
router.delete('/backups/:file', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.deleteBackup.bind(superAdminController));

// Modo Manutenção
router.get('/maintenance', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.getMaintenanceMode.bind(superAdminController));
router.put('/maintenance', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.setMaintenanceMode.bind(superAdminController));

// API Keys
router.get('/api-keys', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.listApiKeys.bind(superAdminController));
router.put('/api-keys', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.saveApiKeys.bind(superAdminController));

// Logs do Servidor
router.get('/server-logs', requireInternalPermission('AUDITORIA', 'VIEW'), superAdminController.getServerLogs.bind(superAdminController));

// Módulo Notificações
router.get('/notifications', requireInternalPermission('CONFIGURACOES', 'VIEW'), superAdminController.listNotifications.bind(superAdminController));
router.post('/notifications', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.sendNotification.bind(superAdminController));
router.put('/notifications/:id/read', superAdminController.markNotificationRead.bind(superAdminController));
router.put('/notifications/read-all', superAdminController.markAllNotificationsRead.bind(superAdminController));

// Módulo Email
router.post('/test-email', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.testEmail.bind(superAdminController));

// Módulo Relatórios Financeiros
router.get('/financial-reports', requireInternalPermission('FINANCEIRO', 'VIEW'), superAdminController.getFinancialReports.bind(superAdminController));

// Módulo Inadimplentes
router.get('/overdue', requireInternalPermission('FINANCEIRO', 'VIEW'), superAdminController.listOverdue.bind(superAdminController));

// Módulo Assinaturas e Faturas
router.get('/subscriptions/:clientId/invoices', requireInternalPermission('CLIENTES', 'VIEW'), superAdminController.getClientInvoices.bind(superAdminController));
router.put('/subscriptions/:id/cancel', requireInternalPermission('FINANCEIRO', 'FULL'), superAdminController.cancelSubscription.bind(superAdminController));
router.put('/subscriptions/:id/plan', requireInternalPermission('FINANCEIRO', 'FULL'), superAdminController.changeSubscriptionPlan.bind(superAdminController));
router.post('/subscriptions/:id/invoices', requireInternalPermission('FINANCEIRO', 'FULL'), superAdminController.generateInvoice.bind(superAdminController));
router.put('/invoices/:id/pay', requireInternalPermission('FINANCEIRO', 'FULL'), superAdminController.payInvoice.bind(superAdminController));

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
router.put('/users/:id/reset-password', requireInternalPermission('CLIENTES', 'FULL'), superAdminController.resetUserPassword.bind(superAdminController));
router.post('/users/reset-all-passwords', requireInternalPermission('CLIENTES', 'FULL'), superAdminController.resetAllUserPasswords.bind(superAdminController));

// Módulo Aprovação de Cadastros
router.get('/pending-registrations', requireInternalPermission('CLIENTES', 'VIEW'), superAdminController.listPendingRegistrations.bind(superAdminController));
router.post('/pending-registrations/:id/approve', requireInternalPermission('CLIENTES', 'FULL'), superAdminController.approveRegistration.bind(superAdminController));
router.post('/pending-registrations/:id/reject', requireInternalPermission('CLIENTES', 'FULL'), superAdminController.rejectRegistration.bind(superAdminController));

// Módulo Reset de Banco
router.post('/reset-database', requireInternalPermission('CONFIGURACOES', 'FULL'), superAdminController.resetDatabase.bind(superAdminController));

// Módulo Acesso e Liberações (Impersonation)
router.post('/impersonate/:storeId', requireInternalPermission('ACESSO_E_LIBERACOES', 'FULL'), superAdminController.impersonate.bind(superAdminController));
router.post('/revert-impersonate', superAdminController.revertImpersonation.bind(superAdminController));

export { router as superAdminRoutes };
