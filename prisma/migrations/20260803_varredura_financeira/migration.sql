-- Varredura Financeira: notificações escalonadas, histórico de execuções,
-- exceções de bloqueio e audit log de nível SaaS.

-- CreateTable
CREATE TABLE "cobranca_notificacoes" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "enviada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cobranca_notificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_runs" (
    "id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "disparado_por" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EXECUTADO',
    "plano" JSONB NOT NULL,
    "resultado" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "excecoes_bloqueio" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "criado_por" TEXT NOT NULL,
    "ate" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "excecoes_bloqueio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_audit_logs" (
    "id" TEXT NOT NULL,
    "client_id" TEXT,
    "acao" TEXT NOT NULL,
    "payload" JSONB,
    "criado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cobranca_notificacoes_subscription_id_tipo_key" ON "cobranca_notificacoes"("subscription_id", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "scan_runs_data_key" ON "scan_runs"("data");

-- AddForeignKey
ALTER TABLE "cobranca_notificacoes" ADD CONSTRAINT "cobranca_notificacoes_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excecoes_bloqueio" ADD CONSTRAINT "excecoes_bloqueio_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_audit_logs" ADD CONSTRAINT "saas_audit_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
