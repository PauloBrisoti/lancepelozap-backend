-- Conciliação bancária: importações de extrato e itens pendentes
CREATE TABLE "bank_statement_imports" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "banco" TEXT NOT NULL,

    CONSTRAINT "bank_statement_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bank_statement_items" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "tipo" TEXT NOT NULL,
    "conciliado" BOOLEAN NOT NULL DEFAULT false,
    "financial_transaction_id" TEXT,

    CONSTRAINT "bank_statement_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bank_statement_imports_store_id_imported_at_idx" ON "bank_statement_imports"("store_id", "imported_at");
CREATE INDEX "bank_statement_items_import_id_conciliado_idx" ON "bank_statement_items"("import_id", "conciliado");
CREATE INDEX "bank_statement_items_financial_transaction_id_idx" ON "bank_statement_items"("financial_transaction_id");

ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_statement_items" ADD CONSTRAINT "bank_statement_items_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "bank_statement_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_statement_items" ADD CONSTRAINT "bank_statement_items_financial_transaction_id_fkey" FOREIGN KEY ("financial_transaction_id") REFERENCES "financial_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
