-- Comprovantes de renovação Pix manual (Copia e Cola / QR Code estático)
-- Aprovado/rejeitado SOMENTE pelo painel administrativo (role admin verificado
-- no middleware de rota + escopo de cliente checado no controller).
CREATE TABLE "payment_receipts" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AGUARDANDO_VALIDACAO',
    "transaction_id" TEXT,
    "valor_declarado" DECIMAL(10,2) NOT NULL,
    "arquivo_path" TEXT,
    "arquivo_original" TEXT,
    "motivo_rejeicao" TEXT,
    "aprovado_por" TEXT,
    "aprovado_em" TIMESTAMP(3),
    "rejeitado_por" TEXT,
    "rejeitado_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_receipts_client_id_created_at_idx" ON "payment_receipts"("client_id", "created_at");
CREATE INDEX "payment_receipts_status_created_at_idx" ON "payment_receipts"("status", "created_at");

ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;