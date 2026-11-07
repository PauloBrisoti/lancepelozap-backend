-- Migration: add_accounting_and_period_close
-- Fase 2: Fechamento de Período, Plano de Contas, Partidas Dobradas, Retenções Fiscais e Governança de Crédito

-- 1. Governança de Crédito no Customer
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "limite_credito" DECIMAL(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "bloqueado_fiado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "motivo_bloqueio_fiado" TEXT;

-- 2. Fechamento de Período Contábil
CREATE TABLE IF NOT EXISTS "period_closes" (
  "id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "ano" INTEGER NOT NULL,
  "mes" INTEGER NOT NULL,
  "data_fechamento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fechado_por" TEXT NOT NULL,
  "observacao" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "period_closes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "period_closes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "period_closes_store_id_ano_mes_key" ON "period_closes"("store_id", "ano", "mes");
CREATE INDEX IF NOT EXISTS "period_closes_store_id_ano_mes_idx" ON "period_closes"("store_id", "ano", "mes");

-- 3. Plano de Contas
CREATE TABLE IF NOT EXISTS "chart_of_accounts" (
  "id" TEXT NOT NULL,
  "store_id" TEXT,
  "codigo" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "natureza" TEXT NOT NULL,
  "nivel" INTEGER NOT NULL DEFAULT 1,
  "is_sintetica" BOOLEAN NOT NULL DEFAULT false,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chart_of_accounts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "chart_of_accounts_store_id_codigo_key" ON "chart_of_accounts"("store_id", "codigo");
CREATE INDEX IF NOT EXISTS "chart_of_accounts_store_id_tipo_idx" ON "chart_of_accounts"("store_id", "tipo");

-- 4. Partidas Dobradas (Lançamentos Contábeis)
CREATE TABLE IF NOT EXISTS "journal_entries" (
  "id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "numero" SERIAL NOT NULL,
  "data_lancamento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "descricao" TEXT NOT NULL,
  "origem_tipo" TEXT NOT NULL,
  "origem_id" TEXT,
  "criado_por" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journal_entries_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "journal_entries_store_id_data_lancamento_idx" ON "journal_entries"("store_id", "data_lancamento");
CREATE INDEX IF NOT EXISTS "journal_entries_origem_tipo_origem_id_idx" ON "journal_entries"("origem_tipo", "origem_id");

CREATE TABLE IF NOT EXISTS "journal_entry_lines" (
  "id" TEXT NOT NULL,
  "journal_entry_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "valor" DECIMAL(12, 2) NOT NULL,
  "historico" TEXT,

  CONSTRAINT "journal_entry_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journal_entry_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "journal_entry_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "journal_entry_lines_journal_entry_id_idx" ON "journal_entry_lines"("journal_entry_id");
CREATE INDEX IF NOT EXISTS "journal_entry_lines_account_id_idx" ON "journal_entry_lines"("account_id");

-- 5. Retenções Tributárias
CREATE TABLE IF NOT EXISTS "tax_retentions" (
  "id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "aliquota" DECIMAL(5, 2) NOT NULL,
  "valor_base" DECIMAL(10, 2) NOT NULL,
  "valor_retido" DECIMAL(10, 2) NOT NULL,
  "competencia" TEXT NOT NULL,
  "data_retencao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "referencia_id" TEXT,
  "origem_tipo" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RETIDO',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tax_retentions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_retentions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "tax_retentions_store_id_competencia_idx" ON "tax_retentions"("store_id", "competencia");
CREATE INDEX IF NOT EXISTS "tax_retentions_origem_tipo_referencia_id_idx" ON "tax_retentions"("origem_tipo", "referencia_id");

