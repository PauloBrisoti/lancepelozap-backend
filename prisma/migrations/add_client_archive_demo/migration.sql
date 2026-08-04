-- Arquivamento (soft delete) e flag de demonstração para clientes
ALTER TABLE "clients" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "clients" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
