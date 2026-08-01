-- Add installment fields to PurchaseOrder and AccountPayable
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "valor_entrada" DECIMAL(10,2);
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "wallet_id_entrada" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "numero_parcelas" INTEGER;
ALTER TABLE "AccountPayable" ADD COLUMN IF NOT EXISTS "purchase_order_id" TEXT;
ALTER TABLE "AccountPayable" ADD COLUMN IF NOT EXISTS "numero_parcela" INTEGER;
ALTER TABLE "AccountPayable" ADD COLUMN IF NOT EXISTS "total_parcelas" INTEGER;
ALTER TABLE "purchase_orders" ADD CONSTRAINT IF NOT EXISTS "purchase_orders_wallet_id_entrada_fkey" FOREIGN KEY ("wallet_id_entrada") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountPayable" ADD CONSTRAINT IF NOT EXISTS "AccountPayable_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
