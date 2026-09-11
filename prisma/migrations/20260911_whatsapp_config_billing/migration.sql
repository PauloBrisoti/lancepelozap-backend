-- CreateTable
CREATE TABLE "whatsapp_config" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "billing_enabled" BOOLEAN NOT NULL DEFAULT false,
    "disclaimer_accepted" BOOLEAN NOT NULL DEFAULT false,
    "send_receipt_text" BOOLEAN NOT NULL DEFAULT true,
    "send_receipt_pdf" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_billing_rules" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "dias_offset" INTEGER NOT NULL,
    "mensagem" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_billing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_message_logs" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "config_id" TEXT,
    "tipo" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ENVIADO',
    "external_id" TEXT,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "error_msg" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_config_store_id_key" ON "whatsapp_config"("store_id");

-- CreateIndex
CREATE INDEX "whatsapp_billing_rules_config_id_idx" ON "whatsapp_billing_rules"("config_id");

-- CreateIndex
CREATE INDEX "whatsapp_message_logs_store_id_tipo_idx" ON "whatsapp_message_logs"("store_id", "tipo");

-- CreateIndex
CREATE INDEX "whatsapp_message_logs_reference_type_reference_id_idx" ON "whatsapp_message_logs"("reference_type", "reference_id");

-- AddForeignKey
ALTER TABLE "whatsapp_config" ADD CONSTRAINT "whatsapp_config_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_billing_rules" ADD CONSTRAINT "whatsapp_billing_rules_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "whatsapp_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_message_logs" ADD CONSTRAINT "whatsapp_message_logs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_message_logs" ADD CONSTRAINT "whatsapp_message_logs_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "whatsapp_config"("id") ON DELETE SET NULL ON UPDATE CASCADE;
