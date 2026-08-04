-- Cria a tabela de log de acessos em God Mode (impersonação de loja por super admin)
CREATE TABLE "impersonation_logs" (
    "id" TEXT NOT NULL,
    "impersonator_id" TEXT NOT NULL,
    "impersonator_name" TEXT,
    "impersonator_email" TEXT,
    "target_user_id" TEXT,
    "target_store_id" TEXT NOT NULL,
    "store_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impersonation_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "impersonation_logs_target_store_id_created_at_idx" ON "impersonation_logs"("target_store_id", "created_at");
