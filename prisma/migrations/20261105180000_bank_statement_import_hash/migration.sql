-- Deduplicação de importações: mesmo conteúdo não pode ser importado 2x na mesma loja
ALTER TABLE "bank_statement_imports" ADD COLUMN "content_hash" TEXT;

CREATE INDEX "bank_statement_imports_store_id_content_hash_idx" ON "bank_statement_imports"("store_id", "content_hash");
