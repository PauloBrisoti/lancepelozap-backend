-- Alinhamento do schema (drift): FKs externas restauradas + drift
-- pré-existente. SQL idempotente, gerado de migrate diff.

DROP INDEX IF EXISTS "pets_store_id_tutor_id_idx";
ALTER TABLE "accounts_receivable" DROP COLUMN IF EXISTS "valor_pago";
ALTER TABLE "audit_logs" ALTER COLUMN "store_id" DROP NOT NULL;
ALTER TABLE "cash_registers" ADD COLUMN IF NOT EXISTS "diferenca" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "saldo_esperado" DECIMAL(10,2);
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "aliquota_imposto" DECIMAL(5,2);
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "bairro" TEXT,
ADD COLUMN IF NOT EXISTS "cep" TEXT,
ADD COLUMN IF NOT EXISTS "cidade" TEXT,
ADD COLUMN IF NOT EXISTS "complemento" TEXT,
ADD COLUMN IF NOT EXISTS "logradouro" TEXT,
ADD COLUMN IF NOT EXISTS "numero" TEXT,
ADD COLUMN IF NOT EXISTS "uf" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "data_nascimento" TEXT,
ADD COLUMN IF NOT EXISTS "email" TEXT,
ADD COLUMN IF NOT EXISTS "observacoes" TEXT,
ADD COLUMN IF NOT EXISTS "portal_token" TEXT,
ADD COLUMN IF NOT EXISTS "rg" TEXT;
ALTER TABLE "financial_categories" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "comprovante_url" TEXT,
ADD COLUMN IF NOT EXISTS "customer_id" TEXT,
ADD COLUMN IF NOT EXISTS "forma_pagamento" TEXT,
ADD COLUMN IF NOT EXISTS "fornecedor" TEXT,
ADD COLUMN IF NOT EXISTS "receivable_id" TEXT,
ADD COLUMN IF NOT EXISTS "sale_id" TEXT,
ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ATIVA',
ADD COLUMN IF NOT EXISTS "supplier_id" TEXT;
ALTER TABLE "personal_transactions" ALTER COLUMN "pago" SET NOT NULL,
ALTER COLUMN "data_competencia" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "forma_pagamento" SET DATA TYPE TEXT;
ALTER TABLE "pet_service_catalog" DROP COLUMN IF EXISTS "duracao_min",
ADD COLUMN IF NOT EXISTS "tipo_duracao" TEXT NOT NULL DEFAULT 'INDETERMINADO';
ALTER TABLE "pet_service_orders" DROP COLUMN IF EXISTS "data_agendamento",
ADD COLUMN IF NOT EXISTS "data_entrada" TIMESTAMP(3) NOT NULL,
ADD COLUMN IF NOT EXISTS "data_saida" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "hora_fim" TEXT,
ADD COLUMN IF NOT EXISTS "hora_inicio" TEXT,
ADD COLUMN IF NOT EXISTS "ultima_cobranca" TIMESTAMP(3);
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "features" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "brand_id" TEXT,
ADD COLUMN IF NOT EXISTS "codigo_visual" TEXT,
ADD COLUMN IF NOT EXISTS "data_pedido" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "estoque_minimo" DECIMAL(10,3) NOT NULL DEFAULT 5,
ADD COLUMN IF NOT EXISTS "image_url" TEXT,
ADD COLUMN IF NOT EXISTS "ncm" TEXT,
ADD COLUMN IF NOT EXISTS "peso_bruto" DECIMAL(10,3),
ADD COLUMN IF NOT EXISTS "peso_liquido" DECIMAL(10,3),
ADD COLUMN IF NOT EXISTS "previsao_chegada" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "unidade" TEXT NOT NULL DEFAULT 'UN';
ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "commission_paid_at" TIMESTAMP(3);
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "cmv_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "finalized_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "observacoes" TEXT,
ADD COLUMN IF NOT EXISTS "valor_taxas_gateway" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "aliquota_imposto" DECIMAL(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS "cartao_imediato" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "dashboard_cards" TEXT,
ADD COLUMN IF NOT EXISTS "dia_inicio_mes" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "features" TEXT,
ADD COLUMN IF NOT EXISTS "tipo_workspace" TEXT NOT NULL DEFAULT 'PJ',
ADD COLUMN IF NOT EXISTS "whatsapp_api_key" TEXT,
ADD COLUMN IF NOT EXISTS "whatsapp_api_url" TEXT,
ADD COLUMN IF NOT EXISTS "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "whatsapp_send_birthday" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "whatsapp_send_confirmation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "whatsapp_send_marketing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "whatsapp_send_reminder" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "billing_cycle_start_day" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "monthly_budget_limit" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "reset_token" TEXT,
ADD COLUMN IF NOT EXISTS "reset_token_expires" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "two_factor_secret" TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_templates_pkey') THEN
    EXECUTE 'ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")';
  END IF;
END $$;
DROP TABLE IF EXISTS "audit_financial_transactions_deletion";
DROP TABLE IF EXISTS "audit_receivables_deletion";
DROP TABLE IF EXISTS "audit_sales_deletion";
CREATE UNIQUE INDEX IF NOT EXISTS "customers_portal_token_key" ON "customers"("portal_token");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_method_fees_store_id_forma_pagamento_parcelas_key" ON "payment_method_fees"("store_id", "forma_pagamento", "parcelas");
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pet_service_order_items_catalog_id_fkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pet_service_order_items_catalog_item_id_fkey') THEN
    EXECUTE 'ALTER TABLE "pet_service_order_items" RENAME CONSTRAINT "pet_service_order_items_catalog_id_fkey" TO "pet_service_order_items_catalog_item_id_fkey"';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pet_service_order_items_order_id_fkey') AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pet_service_order_items_service_order_id_fkey') THEN
    EXECUTE 'ALTER TABLE "pet_service_order_items" RENAME CONSTRAINT "pet_service_order_items_order_id_fkey" TO "pet_service_order_items_service_order_id_fkey"';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brands_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "brands" ADD CONSTRAINT "brands_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_method_fees_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "payment_method_fees" ADD CONSTRAINT "payment_method_fees_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_entries_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "product_entries" ADD CONSTRAINT "product_entries_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_entry_items_product_id_fkey') THEN
    EXECUTE 'ALTER TABLE "product_entry_items" ADD CONSTRAINT "product_entry_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_brand_id_fkey') THEN
    EXECUTE 'ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_product_id_fkey') THEN
    EXECUTE 'ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_user_id_fkey') THEN
    EXECUTE 'ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_origin_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_origin_store_id_fkey" FOREIGN KEY ("origin_store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_destination_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_destination_store_id_fkey" FOREIGN KEY ("destination_store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_user_id_fkey') THEN
    EXECUTE 'ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfer_items_product_id_fkey') THEN
    EXECUTE 'ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_counts_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_counts_user_id_fkey') THEN
    EXECUTE 'ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_count_items_product_id_fkey') THEN
    EXECUTE 'ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "quotes" ADD CONSTRAINT "quotes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_user_id_fkey') THEN
    EXECUTE 'ALTER TABLE "quotes" ADD CONSTRAINT "quotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_customer_id_fkey') THEN
    EXECUTE 'ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_items_product_id_fkey') THEN
    EXECUTE 'ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_user_id_fkey') THEN
    EXECUTE 'ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_customer_id_fkey') THEN
    EXECUTE 'ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_items_product_id_fkey') THEN
    EXECUTE 'ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'returns_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "returns" ADD CONSTRAINT "returns_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'returns_sale_id_fkey') THEN
    EXECUTE 'ALTER TABLE "returns" ADD CONSTRAINT "returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'returns_user_id_fkey') THEN
    EXECUTE 'ALTER TABLE "returns" ADD CONSTRAINT "returns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'returns_customer_id_fkey') THEN
    EXECUTE 'ALTER TABLE "returns" ADD CONSTRAINT "returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'return_items_product_id_fkey') THEN
    EXECUTE 'ALTER TABLE "return_items" ADD CONSTRAINT "return_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_cards_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_receivable_id_fkey') THEN
    EXECUTE 'ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_receivable_id_fkey" FOREIGN KEY ("receivable_id") REFERENCES "accounts_receivable"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_sale_id_fkey') THEN
    EXECUTE 'ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_customer_id_fkey') THEN
    EXECUTE 'ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_supplier_id_fkey') THEN
    EXECUTE 'ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_payments_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "commission_payments" ADD CONSTRAINT "commission_payments_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_payments_user_id_fkey') THEN
    EXECUTE 'ALTER TABLE "commission_payments" ADD CONSTRAINT "commission_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountPayable_storeId_fkey') THEN
    EXECUTE 'ALTER TABLE "AccountPayable" ADD CONSTRAINT "AccountPayable_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_templates_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_logs_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_logs_customer_id_fkey') THEN
    EXECUTE 'ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_types_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "service_types" ADD CONSTRAINT "service_types_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_orders_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_orders_customer_id_fkey') THEN
    EXECUTE 'ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_orders_user_id_fkey') THEN
    EXECUTE 'ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_order_items_product_id_fkey') THEN
    EXECUTE 'ALTER TABLE "service_order_items" ADD CONSTRAINT "service_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'professionals_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "professionals" ADD CONSTRAINT "professionals_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_store_id_fkey') THEN
    EXECUTE 'ALTER TABLE "appointments" ADD CONSTRAINT "appointments_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_customer_id_fkey') THEN
    EXECUTE 'ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_categories_user_id_fkey') THEN
    EXECUTE 'ALTER TABLE "personal_categories" ADD CONSTRAINT "personal_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_transactions_user_id_fkey') THEN
    EXECUTE 'ALTER TABLE "personal_transactions" ADD CONSTRAINT "personal_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_wallets_user_id_fkey') THEN
    EXECUTE 'ALTER TABLE "personal_wallets" ADD CONSTRAINT "personal_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_budgets_user_id_fkey') THEN
    EXECUTE 'ALTER TABLE "personal_budgets" ADD CONSTRAINT "personal_budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE';
  END IF;
END $$;
ALTER INDEX "pet_service_order_items_order_id_catalog_id_idx" RENAME TO "pet_service_order_items_service_order_id_catalog_item_id_idx";
