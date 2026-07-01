-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "preco_mensal" DECIMAL(10,2) NOT NULL,
    "max_controls" INTEGER NOT NULL DEFAULT 1,
    "max_stores" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "nome_completo" TEXT NOT NULL,
    "cnpj_cpf" TEXT,
    "email" TEXT NOT NULL,
    "telefone_whatsapp" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "allow_consolidated_view" BOOLEAN NOT NULL DEFAULT false,
    "aceite_termos_data" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_users" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OWNER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "valor_mensalidade" DECIMAL(10,2) NOT NULL,
    "data_vencimento" DATE NOT NULL,
    "status_pagamento" TEXT NOT NULL,
    "bloqueio_automatico_ativo" BOOLEAN NOT NULL DEFAULT true,
    "mp_preapproval_id" TEXT,
    "mp_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "mes_referencia" TEXT NOT NULL,
    "valor_cobrado" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "data_pagamento" TIMESTAMP(3),
    "url_fatura" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "controls" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "control_id" TEXT NOT NULL,
    "nome_fantasia" TEXT NOT NULL,
    "cnpj_cpf" TEXT,
    "nicho_principal" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "email_contato" TEXT,
    "telefone_whatsapp" TEXT,
    "chave_pix_recebimento" TEXT,
    "pix_qrcode_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_user_access" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VENDEDOR',
    "permite_venda_prazo" BOOLEAN NOT NULL DEFAULT false,
    "limite_desconto_maximo" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_user_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "nome_completo" TEXT NOT NULL,
    "cpf" TEXT,
    "telefone_whatsapp" TEXT,
    "cep" TEXT,
    "endereco_completo" TEXT,
    "aceita_marketing" BOOLEAN NOT NULL DEFAULT true,
    "aceita_lembrete_cobranca" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cor_hexadecimal" TEXT,
    "margem_lucro_padrao" DECIMAL(5,2),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "codigo_barras_ean" TEXT,
    "nome" TEXT NOT NULL,
    "descricao_variante" TEXT,
    "preco_custo" DECIMAL(10,2) NOT NULL,
    "preco_venda_sugerido" DECIMAL(10,2) NOT NULL,
    "imposto_estimado_percentual" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "qtd_estoque_atual" DECIMAL(10,3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "cash_register_id" TEXT,
    "user_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "data_venda" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valor_total_bruto" DECIMAL(10,2) NOT NULL,
    "valor_desconto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "valor_total_liquido" DECIMAL(10,2) NOT NULL,
    "forma_pagamento" TEXT NOT NULL DEFAULT 'PIX',
    "valor_sinal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "numero_parcelas" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'FINALIZADA',

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantidade" DECIMAL(10,3) NOT NULL,
    "preco_unitario_vendido" DECIMAL(10,2) NOT NULL,
    "custo_unitario_historico" DECIMAL(10,2) NOT NULL,
    "comissao_vendedor_valor" DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts_receivable" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "sale_id" TEXT,
    "customer_id" TEXT NOT NULL,
    "data_vencimento" DATE NOT NULL,
    "numero_parcela" INTEGER NOT NULL DEFAULT 1,
    "total_parcelas" INTEGER NOT NULL DEFAULT 1,
    "valor_parcela" DECIMAL(10,2) NOT NULL,
    "forma_pagamento_esperada" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "data_pagamento_efetivo" DATE,
    "valor_pago" DECIMAL(10,2),
    "url_comprovante_storage" TEXT,
    "lembrete_d2_enviado" BOOLEAN NOT NULL DEFAULT false,
    "lembrete_d0_enviado" BOOLEAN NOT NULL DEFAULT false,
    "lembrete_d1pos_enviado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "accounts_receivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "saldo_atual" DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transactions" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "descricao" TEXT NOT NULL,
    "data_transacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "categoria" TEXT,

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "data_abertura" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_fechamento" TIMESTAMP(3),
    "valor_troco_inicial" DECIMAL(10,2) NOT NULL,
    "valor_total_fechamento" DECIMAL(10,2),
    "status" TEXT NOT NULL DEFAULT 'ABERTO',

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_transactions" (
    "id" TEXT NOT NULL,
    "cash_register_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "descricao" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "tabela_afetada" TEXT NOT NULL,
    "dados_antigos" JSONB,
    "dados_novos" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "assunto" TEXT NOT NULL,
    "prioridade" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "dados_forenses" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "remetente" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "url_anexo_storage" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category_id" TEXT,
    "percentual" DECIMAL(5,2) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "email" TEXT,
    "sucesso" BOOLEAN NOT NULL,
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "descricao" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_cnpj_cpf_key" ON "clients"("cnpj_cpf");

-- CreateIndex
CREATE UNIQUE INDEX "clients_email_key" ON "clients"("email");

-- CreateIndex
CREATE UNIQUE INDEX "client_users_client_id_user_id_key" ON "client_users"("client_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "store_user_access_store_id_user_id_key" ON "store_user_access"("store_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_chave_key" ON "system_settings"("chave");

-- AddForeignKey
ALTER TABLE "client_users" ADD CONSTRAINT "client_users_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_users" ADD CONSTRAINT "client_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controls" ADD CONSTRAINT "controls_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_control_id_fkey" FOREIGN KEY ("control_id") REFERENCES "controls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_user_access" ADD CONSTRAINT "store_user_access_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_user_access" ADD CONSTRAINT "store_user_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
