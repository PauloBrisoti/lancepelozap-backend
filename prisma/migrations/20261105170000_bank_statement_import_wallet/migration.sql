-- Conciliação bancária: vincula a importação a uma carteira/conta específica
ALTER TABLE "bank_statement_imports" ADD COLUMN "wallet_id" TEXT;

CREATE INDEX "bank_statement_imports_wallet_id_idx" ON "bank_statement_imports"("wallet_id");

ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
