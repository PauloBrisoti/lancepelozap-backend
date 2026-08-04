-- Permissões granulares por módulo (create/read/update/delete)
ALTER TABLE "internal_role_permissions" ADD COLUMN "actions" TEXT[] NOT NULL DEFAULT '{}';

-- Expiração de acesso para usuários internos (acesso temporário)
ALTER TABLE "users" ADD COLUMN "expires_at" TIMESTAMP(3);
