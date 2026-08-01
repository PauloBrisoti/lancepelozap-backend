-- Add payment method and freight to PurchaseOrder (Contrato de Requisitos - Motor Financeiro)
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "forma_pagamento" TEXT NOT NULL DEFAULT 'A_VISTA';
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "valor_frete" DECIMAL(10,2) NOT NULL DEFAULT 0;
