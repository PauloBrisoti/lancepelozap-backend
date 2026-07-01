-- ============================================================
-- MIGRATION V2 — SaaS Gestão Modular
-- Execute na VPS:
--   psql -U saas_admin -d saas_db -f migration_v2.sql
-- ============================================================

BEGIN;

-- ============================================================
-- BLOCO 1 — NOVAS TABELAS
-- ============================================================

-- 1.1 tenant_modules: coração da modularidade do SaaS
--     Controla quais módulos cada lojista assinou.
--     Módulos possíveis: 'FINANCEIRO', 'VENDAS', 'ESTOQUE', 'SUPER_ADMIN'
CREATE TABLE public.tenant_modules (
    id         text NOT NULL,
    tenant_id  text NOT NULL,
    modulo     text NOT NULL,
    ativo      boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT tenant_modules_pkey PRIMARY KEY (id),
    CONSTRAINT tenant_modules_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
-- Garante que o mesmo módulo não seja duplicado por tenant
CREATE UNIQUE INDEX tenant_modules_tenant_modulo_key
    ON public.tenant_modules (tenant_id, modulo);

ALTER TABLE public.tenant_modules OWNER TO saas_admin;


-- 1.2 login_attempts: rastreio de tentativas para rate limiting progressivo
--     Regra: 5 falhas → bloqueio temporário; escalada para P2 em caso de persistência
CREATE TABLE public.login_attempts (
    id         text NOT NULL,
    ip_address text NOT NULL,
    email      text,
    sucesso    boolean NOT NULL,
    bloqueado  boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT login_attempts_pkey PRIMARY KEY (id)
);
-- Índice para queries rápidas por IP na janela de tempo
CREATE INDEX login_attempts_ip_created_idx
    ON public.login_attempts (ip_address, created_at);

ALTER TABLE public.login_attempts OWNER TO saas_admin;


-- 1.3 commission_rules: regras de comissão por vendedor e/ou categoria
--     category_id NULL = regra global do vendedor (aplica a qualquer categoria)
CREATE TABLE public.commission_rules (
    id          text NOT NULL,
    tenant_id   text NOT NULL,
    user_id     text NOT NULL,
    category_id text,          -- NULL = regra global do vendedor
    percentual  numeric(5,2)  NOT NULL,
    ativo       boolean DEFAULT true NOT NULL,
    CONSTRAINT commission_rules_pkey PRIMARY KEY (id),
    CONSTRAINT commission_rules_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT commission_rules_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT commission_rules_category_id_fkey
        FOREIGN KEY (category_id) REFERENCES public.categories(id)
        ON UPDATE CASCADE ON DELETE SET NULL
);
-- Unicidade: um vendedor não pode ter duas regras para a mesma categoria
CREATE UNIQUE INDEX commission_rules_categoria_unique_idx
    ON public.commission_rules (tenant_id, user_id, category_id)
    WHERE category_id IS NOT NULL;

CREATE UNIQUE INDEX commission_rules_global_unique_idx
    ON public.commission_rules (tenant_id, user_id)
    WHERE category_id IS NULL;

ALTER TABLE public.commission_rules OWNER TO saas_admin;


-- ============================================================
-- BLOCO 2 — ALTER TABLE (campos faltando em tabelas existentes)
-- ============================================================

-- 2.1 accounts_receivable — rastreio de parcelas e lembretes n8n
--     Sem lembrete_*: o n8n dispara duplicatas no mesmo dia
ALTER TABLE public.accounts_receivable
    ADD COLUMN IF NOT EXISTS numero_parcela         integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS total_parcelas         integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS data_pagamento_efetivo date,
    ADD COLUMN IF NOT EXISTS valor_pago             numeric(10,2),
    ADD COLUMN IF NOT EXISTS lembrete_d2_enviado    boolean DEFAULT false NOT NULL,
    ADD COLUMN IF NOT EXISTS lembrete_d0_enviado    boolean DEFAULT false NOT NULL,
    ADD COLUMN IF NOT EXISTS lembrete_d1pos_enviado boolean DEFAULT false NOT NULL;


-- 2.2 sales — campos essenciais para a venda consultiva
--     forma_pagamento: PIX | CARTAO | CREDIARIO | DINHEIRO
--     valor_sinal:     entrada paga no ato (descontada das parcelas)
--     numero_parcelas: controla quantas entradas em accounts_receivable criar
ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS forma_pagamento text    NOT NULL DEFAULT 'PIX',
    ADD COLUMN IF NOT EXISTS valor_sinal     numeric(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS numero_parcelas integer NOT NULL DEFAULT 1;


-- 2.3 tenants — campos de integração com n8n e WhatsApp
--     telefone_whatsapp: para o resumo gerencial matinal
--     chave_pix_recebimento: o n8n usa para configurar o robô de cobrança
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS email_contato         text,
    ADD COLUMN IF NOT EXISTS telefone_whatsapp     text,
    ADD COLUMN IF NOT EXISTS chave_pix_recebimento text;


-- 2.4 financial_transactions — tenant_id direto para isolamento seguro
--     Sem isso, toda query de extrato precisa de JOIN com wallets (risco e lentidão)
ALTER TABLE public.financial_transactions
    ADD COLUMN IF NOT EXISTS tenant_id text;

-- Preencher retroativamente com base na carteira
UPDATE public.financial_transactions ft
SET    tenant_id = w.tenant_id
FROM   public.wallets w
WHERE  ft.wallet_id = w.id
  AND  ft.tenant_id IS NULL;

-- Agora pode ser NOT NULL com segurança
ALTER TABLE public.financial_transactions
    ALTER COLUMN tenant_id SET NOT NULL;

-- FK e índice de performance
ALTER TABLE public.financial_transactions
    ADD CONSTRAINT financial_transactions_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS financial_transactions_tenant_id_idx
    ON public.financial_transactions (tenant_id);


-- ============================================================
-- BLOCO 3 — ÍNDICES DE SEGURANÇA E PERFORMANCE
-- ============================================================

-- CPF único POR TENANT (dois lojistas podem ter o mesmo cliente cadastrado)
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_cpf_unique
    ON public.customers (tenant_id, cpf)
    WHERE cpf IS NOT NULL;

-- Performance: contas a receber por tenant + status (query do n8n)
CREATE INDEX IF NOT EXISTS accounts_receivable_tenant_status_idx
    ON public.accounts_receivable (tenant_id, status);

-- Performance: contas a receber por vencimento (job diário do n8n)
CREATE INDEX IF NOT EXISTS accounts_receivable_vencimento_status_idx
    ON public.accounts_receivable (data_vencimento, status);

-- Performance: vendas por tenant e data (dashboard e relatórios)
CREATE INDEX IF NOT EXISTS sales_tenant_data_idx
    ON public.sales (tenant_id, data_venda);

-- Performance: clientes por tenant (listagens e busca)
CREATE INDEX IF NOT EXISTS customers_tenant_id_idx
    ON public.customers (tenant_id);

-- Performance: transações financeiras por data (extrato)
CREATE INDEX IF NOT EXISTS financial_transactions_data_idx
    ON public.financial_transactions (tenant_id, data_transacao);


COMMIT;

-- ============================================================
-- Verificação pós-migração (execute manualmente para confirmar)
-- ============================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
