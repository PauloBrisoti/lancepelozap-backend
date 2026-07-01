-- Add receivable_id to financial_transactions
ALTER TABLE "financial_transactions"
ADD COLUMN "receivable_id" TEXT;

-- Add foreign key
ALTER TABLE "financial_transactions"
ADD CONSTRAINT "financial_transactions_receivable_id_fkey"
FOREIGN KEY ("receivable_id") REFERENCES "accounts_receivable"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS "financial_transactions_receivable_id_idx"
ON "financial_transactions" ("receivable_id");

-- Remove valor_pago from accounts_receivable
-- First, backfill: link existing financial transactions to receivables via saleId + description pattern
-- (This will be done as a separate script to handle partial payments correctly)
