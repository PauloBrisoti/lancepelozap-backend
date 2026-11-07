-- Migration: add_soft_delete_sales
-- Adiciona soft delete ao modelo Sale para conformidade com CTN art. 195
-- (guarda de documentos fiscais por 5 anos)

ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleted_by" TEXT;

-- Índice parcial: queries de produção filtram deletedAt IS NULL com alta frequência
CREATE INDEX IF NOT EXISTS "sales_store_id_deleted_at_idx"
  ON "sales" ("store_id", "deleted_at");

-- Índice para auditoria: buscar registros soft-deleted por loja
CREATE INDEX IF NOT EXISTS "sales_store_id_deleted_at_notnull_idx"
  ON "sales" ("store_id")
  WHERE "deleted_at" IS NOT NULL;

