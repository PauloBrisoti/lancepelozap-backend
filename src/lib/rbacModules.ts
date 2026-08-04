export const RBAC_MODULES = [
  'CLIENTES',
  'PLANOS_E_MODULOS',
  'ACESSO_E_LIBERACOES',
  'FINANCEIRO',
  'AUDITORIA',
  'CONFIGURACOES'
] as const;

export type RbacModule = (typeof RBAC_MODULES)[number];
