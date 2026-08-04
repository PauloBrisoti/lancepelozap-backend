-- Reparo da cadeia de migrações: recria tabelas criadas por migrações
-- que foram removidas no rollback (ver ROLLBACK.md). SQL gerado de
-- pg_dump --schema-only do banco de desenvolvimento, idempotente.

CREATE TABLE IF NOT EXISTS public.appointments (
    id text NOT NULL,
    store_id text NOT NULL,
    customer_id text NOT NULL,
    professional_id text,
    data timestamp(3) without time zone NOT NULL,
    duracao_minutos integer DEFAULT 60 NOT NULL,
    servico text,
    observacoes text,
    status text DEFAULT 'AGENDADO'::text NOT NULL,
    valor_cobrado numeric(10,2) DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.audit_financial_transactions_deletion (
    id integer NOT NULL,
    tx_id text NOT NULL,
    store_id text NOT NULL,
    old_data jsonb,
    created_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS public.audit_financial_transactions_deletion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.audit_financial_transactions_deletion_id_seq OWNED BY public.audit_financial_transactions_deletion.id;
CREATE TABLE IF NOT EXISTS public.audit_receivables_deletion (
    id integer NOT NULL,
    rec_id text NOT NULL,
    store_id text NOT NULL,
    old_data jsonb,
    created_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS public.audit_receivables_deletion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.audit_receivables_deletion_id_seq OWNED BY public.audit_receivables_deletion.id;
CREATE TABLE IF NOT EXISTS public.audit_sales_deletion (
    id integer NOT NULL,
    sale_id text NOT NULL,
    store_id text NOT NULL,
    old_data jsonb,
    created_at timestamp without time zone DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS public.audit_sales_deletion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.audit_sales_deletion_id_seq OWNED BY public.audit_sales_deletion.id;
CREATE TABLE IF NOT EXISTS public.brands (
    id text NOT NULL,
    store_id text NOT NULL,
    nome text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.commission_payments (
    id text NOT NULL,
    store_id text NOT NULL,
    user_id text NOT NULL,
    total_valor numeric(10,2) NOT NULL,
    data_inicio timestamp(3) without time zone NOT NULL,
    data_fim timestamp(3) without time zone NOT NULL,
    status text DEFAULT 'PAGO'::text NOT NULL,
    observacao text,
    pago_em timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS public.credit_cards (
    id text NOT NULL,
    store_id text NOT NULL,
    nome text NOT NULL,
    bandeira text,
    limite_total numeric(10,2) DEFAULT 0 NOT NULL,
    dia_fechamento integer DEFAULT 1 NOT NULL,
    dia_vencimento integer DEFAULT 10 NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.financial_categories (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    nome text NOT NULL,
    tipo text NOT NULL,
    store_id text,
    is_default boolean DEFAULT false NOT NULL,
    modulo text
);
CREATE TABLE IF NOT EXISTS public.inventory_count_items (
    id text NOT NULL,
    inventory_count_id text NOT NULL,
    product_id text NOT NULL,
    quantidade_sistema numeric(10,3) NOT NULL,
    quantidade_contada numeric(10,3) NOT NULL,
    diferenca numeric(10,3) NOT NULL,
    observacao text
);
CREATE TABLE IF NOT EXISTS public.inventory_counts (
    id text NOT NULL,
    store_id text NOT NULL,
    user_id text NOT NULL,
    data_contagem timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status text DEFAULT 'ABERTO'::text NOT NULL,
    observacao text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.message_logs (
    id text NOT NULL,
    store_id text NOT NULL,
    customer_id text NOT NULL,
    tipo text NOT NULL,
    conteudo text NOT NULL,
    status text DEFAULT 'ENVIADO'::text NOT NULL,
    erro text,
    metadata jsonb,
    sent_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS public.payment_method_fees (
    id text NOT NULL,
    store_id text NOT NULL,
    forma_pagamento text NOT NULL,
    parcelas integer DEFAULT 1 NOT NULL,
    taxa_percentual numeric(5,2) DEFAULT 0 NOT NULL,
    taxa_fixa numeric(10,2) DEFAULT 0 NOT NULL,
    prazo_recebimento_dias integer DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS public.personal_budgets (
    id text NOT NULL,
    user_id text NOT NULL,
    category_id text NOT NULL,
    mes integer NOT NULL,
    ano integer NOT NULL,
    valor_limite numeric(12,2) NOT NULL,
    created_at timestamp(3) without time zone DEFAULT now() NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    CONSTRAINT personal_budgets_mes_check CHECK (((mes >= 1) AND (mes <= 12)))
);
CREATE TABLE IF NOT EXISTS public.personal_categories (
    id text NOT NULL,
    user_id text NOT NULL,
    nome text NOT NULL,
    tipo text NOT NULL,
    icone text DEFAULT '💵'::text,
    cor text DEFAULT '#6366f1'::text,
    created_at timestamp(3) without time zone DEFAULT now() NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    CONSTRAINT personal_categories_tipo_check CHECK ((tipo = ANY (ARRAY['ENTRADA'::text, 'SAIDA'::text])))
);
CREATE TABLE IF NOT EXISTS public.personal_transactions (
    id text NOT NULL,
    user_id text NOT NULL,
    category_id text NOT NULL,
    tipo text NOT NULL,
    valor numeric(12,2) NOT NULL,
    descricao text,
    data timestamp with time zone DEFAULT now() NOT NULL,
    recorrente boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT now() NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    wallet_id text,
    pago boolean DEFAULT false,
    data_competencia timestamp with time zone,
    forma_pagamento character varying(100),
    parcelas integer,
    observacoes text,
    CONSTRAINT personal_transactions_tipo_check CHECK ((tipo = ANY (ARRAY['ENTRADA'::text, 'SAIDA'::text])))
);
CREATE TABLE IF NOT EXISTS public.personal_wallets (
    id text NOT NULL,
    user_id text NOT NULL,
    nome text NOT NULL,
    icone text DEFAULT '💳'::text,
    cor text DEFAULT '#6366f1'::text,
    saldo numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.product_entries (
    id text NOT NULL,
    store_id text NOT NULL,
    data_entrada timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fornecedor text,
    valor_total_produtos numeric(10,2) NOT NULL,
    valor_frete_total numeric(10,2) NOT NULL,
    valor_outros_custos numeric(10,2) DEFAULT 0 NOT NULL,
    supplier_id text
);
CREATE TABLE IF NOT EXISTS public.product_entry_items (
    id text NOT NULL,
    product_entry_id text NOT NULL,
    product_id text NOT NULL,
    quantidade numeric(10,3) NOT NULL,
    custo_fornecedor numeric(10,2) NOT NULL,
    frete_rateado numeric(10,2) NOT NULL,
    custo_unitario_final numeric(10,2) NOT NULL
);
CREATE TABLE IF NOT EXISTS public.professionals (
    id text NOT NULL,
    store_id text NOT NULL,
    nome text NOT NULL,
    telefone text,
    cor text DEFAULT '#6366f1'::text,
    cargo text,
    comissao_percentual numeric(5,2) DEFAULT 0,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
    id text NOT NULL,
    purchase_order_id text NOT NULL,
    product_id text NOT NULL,
    quantidade numeric(10,3) NOT NULL,
    quantidade_recebida numeric(10,3) DEFAULT 0 NOT NULL,
    preco_unitario numeric(10,2) NOT NULL,
    valor_total numeric(10,2) NOT NULL,
    observacao text
);
CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id text NOT NULL,
    store_id text NOT NULL,
    user_id text NOT NULL,
    supplier_id text,
    order_number integer NOT NULL,
    status text DEFAULT 'RASCUNHO'::text NOT NULL,
    data_pedido timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    data_previsao timestamp(3) without time zone,
    valor_total_bruto numeric(10,2) NOT NULL,
    valor_desconto numeric(10,2) DEFAULT 0 NOT NULL,
    valor_total_liquido numeric(10,2) NOT NULL,
    observacoes text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    customer_id text,
    valor_venda numeric(10,2),
    valor_entrada numeric(10,2),
    wallet_id_entrada text,
    numero_parcelas integer,
    forma_pagamento text DEFAULT 'A_VISTA'::text NOT NULL,
    valor_frete numeric(10,2) DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS public.quote_items (
    id text NOT NULL,
    quote_id text NOT NULL,
    product_id text NOT NULL,
    quantidade numeric(10,3) NOT NULL,
    preco_unitario numeric(10,2) NOT NULL,
    valor_total numeric(10,2) NOT NULL,
    observacao text
);
CREATE TABLE IF NOT EXISTS public.quotes (
    id text NOT NULL,
    store_id text NOT NULL,
    user_id text NOT NULL,
    customer_id text,
    quote_number integer NOT NULL,
    status text DEFAULT 'RASCUNHO'::text NOT NULL,
    valor_total_bruto numeric(10,2) NOT NULL,
    valor_desconto numeric(10,2) DEFAULT 0 NOT NULL,
    valor_total_liquido numeric(10,2) NOT NULL,
    observacoes text,
    validade timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.return_items (
    id text NOT NULL,
    product_return_id text NOT NULL,
    product_id text NOT NULL,
    quantidade numeric(10,3) NOT NULL,
    preco_unitario numeric(10,2) NOT NULL,
    valor_total numeric(10,2) NOT NULL
);
CREATE TABLE IF NOT EXISTS public.returns (
    id text NOT NULL,
    store_id text NOT NULL,
    sale_id text NOT NULL,
    user_id text NOT NULL,
    customer_id text,
    status text DEFAULT 'PENDENTE'::text NOT NULL,
    motivo text,
    valor_total numeric(10,2) NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.service_order_items (
    id text NOT NULL,
    service_order_id text NOT NULL,
    service_type_id text,
    product_id text,
    tipo text NOT NULL,
    descricao text NOT NULL,
    quantidade numeric(10,3) NOT NULL,
    preco_unitario numeric(10,2) NOT NULL,
    valor_total numeric(10,2) NOT NULL
);
CREATE TABLE IF NOT EXISTS public.service_orders (
    id text NOT NULL,
    store_id text NOT NULL,
    customer_id text,
    user_id text NOT NULL,
    os_number integer NOT NULL,
    status text DEFAULT 'ABERTO'::text NOT NULL,
    descricao text,
    observacoes text,
    data_entrada timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    data_previsao timestamp(3) without time zone,
    data_conclusao timestamp(3) without time zone,
    data_entrega timestamp(3) without time zone,
    mao_de_obra_valor numeric(10,2) DEFAULT 0 NOT NULL,
    pecas_valor numeric(10,2) DEFAULT 0 NOT NULL,
    valor_desconto numeric(10,2) DEFAULT 0 NOT NULL,
    valor_total numeric(10,2) DEFAULT 0 NOT NULL,
    forma_pagamento text,
    garantia_dias integer,
    modelo_equipamento text,
    numero_serie text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.service_types (
    id text NOT NULL,
    store_id text NOT NULL,
    nome text NOT NULL,
    descricao text,
    preco_padrao numeric(10,2) DEFAULT 0 NOT NULL,
    tempo_estimado_minutos integer,
    categoria text,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.stock_movements (
    id text NOT NULL,
    store_id text NOT NULL,
    product_id text NOT NULL,
    user_id text NOT NULL,
    tipo text NOT NULL,
    quantidade numeric(10,3) NOT NULL,
    saldo_anterior numeric(10,3) NOT NULL,
    saldo_posterior numeric(10,3) NOT NULL,
    referencia_id text,
    motivo text,
    observacao text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS public.stock_transfer_items (
    id text NOT NULL,
    stock_transfer_id text NOT NULL,
    product_id text NOT NULL,
    quantidade numeric(10,3) NOT NULL,
    quantidade_recebida numeric(10,3) DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS public.stock_transfers (
    id text NOT NULL,
    origin_store_id text NOT NULL,
    destination_store_id text NOT NULL,
    user_id text NOT NULL,
    status text DEFAULT 'PENDENTE'::text NOT NULL,
    observacao text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.suppliers (
    id text NOT NULL,
    store_id text NOT NULL,
    nome text NOT NULL,
    tipo_pessoa text DEFAULT 'PJ'::text NOT NULL,
    cnpj_cpf text,
    ie_rg text,
    telefone text,
    email text,
    cep text,
    endereco text,
    observacoes text,
    status text DEFAULT 'ATIVO'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
    id text NOT NULL,
    store_id text NOT NULL,
    nome text NOT NULL,
    categoria text DEFAULT 'MARKETING'::text NOT NULL,
    conteudo text NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);
ALTER TABLE ONLY public.audit_financial_transactions_deletion ALTER COLUMN id SET DEFAULT nextval('public.audit_financial_transactions_deletion_id_seq'::regclass);
ALTER TABLE ONLY public.audit_receivables_deletion ALTER COLUMN id SET DEFAULT nextval('public.audit_receivables_deletion_id_seq'::regclass);
ALTER TABLE ONLY public.audit_sales_deletion ALTER COLUMN id SET DEFAULT nextval('public.audit_sales_deletion_id_seq'::regclass);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_financial_transactions_deletion_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.audit_financial_transactions_deletion
    ADD CONSTRAINT audit_financial_transactions_deletion_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_receivables_deletion_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.audit_receivables_deletion
    ADD CONSTRAINT audit_receivables_deletion_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_sales_deletion_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.audit_sales_deletion
    ADD CONSTRAINT audit_sales_deletion_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brands_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_payments_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.commission_payments
    ADD CONSTRAINT commission_payments_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_cards_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.credit_cards
    ADD CONSTRAINT credit_cards_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_categories_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.financial_categories
    ADD CONSTRAINT financial_categories_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_count_items_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.inventory_count_items
    ADD CONSTRAINT inventory_count_items_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_counts_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.inventory_counts
    ADD CONSTRAINT inventory_counts_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_logs_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.message_logs
    ADD CONSTRAINT message_logs_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_method_fees_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.payment_method_fees
    ADD CONSTRAINT payment_method_fees_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_budgets_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.personal_budgets
    ADD CONSTRAINT personal_budgets_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_budgets_user_id_category_id_mes_ano_key') THEN
    EXECUTE 'ALTER TABLE ONLY public.personal_budgets
    ADD CONSTRAINT personal_budgets_user_id_category_id_mes_ano_key UNIQUE (user_id, category_id, mes, ano)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_categories_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.personal_categories
    ADD CONSTRAINT personal_categories_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_transactions_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.personal_transactions
    ADD CONSTRAINT personal_transactions_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_wallets_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.personal_wallets
    ADD CONSTRAINT personal_wallets_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_entries_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.product_entries
    ADD CONSTRAINT product_entries_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_entry_items_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.product_entry_items
    ADD CONSTRAINT product_entry_items_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'professionals_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.professionals
    ADD CONSTRAINT professionals_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_items_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_items_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.quote_items
    ADD CONSTRAINT quote_items_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'return_items_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.return_items
    ADD CONSTRAINT return_items_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'returns_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_order_items_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.service_order_items
    ADD CONSTRAINT service_order_items_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_orders_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.service_orders
    ADD CONSTRAINT service_orders_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_types_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.service_types
    ADD CONSTRAINT service_types_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfer_items_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_professional_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_professional_id_fkey FOREIGN KEY (professional_id) REFERENCES public.professionals(id) ON UPDATE CASCADE ON DELETE SET NULL';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_count_items_inventory_count_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.inventory_count_items
    ADD CONSTRAINT inventory_count_items_inventory_count_id_fkey FOREIGN KEY (inventory_count_id) REFERENCES public.inventory_counts(id) ON UPDATE CASCADE ON DELETE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_budgets_category_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.personal_budgets
    ADD CONSTRAINT personal_budgets_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.personal_categories(id) ON UPDATE CASCADE ON DELETE RESTRICT';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_transactions_category_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.personal_transactions
    ADD CONSTRAINT personal_transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.personal_categories(id) ON UPDATE CASCADE ON DELETE RESTRICT';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_transactions_wallet_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.personal_transactions
    ADD CONSTRAINT personal_transactions_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.personal_wallets(id) ON UPDATE CASCADE ON DELETE SET NULL';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_entries_supplier_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.product_entries
    ADD CONSTRAINT product_entries_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE SET NULL';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_entry_items_product_entry_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.product_entry_items
    ADD CONSTRAINT product_entry_items_product_entry_id_fkey FOREIGN KEY (product_entry_id) REFERENCES public.product_entries(id) ON UPDATE CASCADE ON DELETE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_items_purchase_order_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON UPDATE CASCADE ON DELETE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_supplier_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE SET NULL';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_items_quote_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.quote_items
    ADD CONSTRAINT quote_items_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.quotes(id) ON UPDATE CASCADE ON DELETE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'return_items_product_return_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.return_items
    ADD CONSTRAINT return_items_product_return_id_fkey FOREIGN KEY (product_return_id) REFERENCES public.returns(id) ON UPDATE CASCADE ON DELETE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_order_items_service_order_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.service_order_items
    ADD CONSTRAINT service_order_items_service_order_id_fkey FOREIGN KEY (service_order_id) REFERENCES public.service_orders(id) ON UPDATE CASCADE ON DELETE CASCADE';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_order_items_service_type_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.service_order_items
    ADD CONSTRAINT service_order_items_service_type_id_fkey FOREIGN KEY (service_type_id) REFERENCES public.service_types(id) ON UPDATE CASCADE ON DELETE SET NULL';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfer_items_stock_transfer_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_stock_transfer_id_fkey FOREIGN KEY (stock_transfer_id) REFERENCES public.stock_transfers(id) ON UPDATE CASCADE ON DELETE CASCADE';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public."AccountPayable" (
    id text NOT NULL,
    "storeId" text NOT NULL,
    descricao text NOT NULL,
    categoria text,
    fornecedor text,
    "dataVencimento" timestamp(3) without time zone NOT NULL,
    valor numeric(65,30) NOT NULL,
    status text DEFAULT 'PENDENTE'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    supplier_id text,
    purchase_order_id text,
    numero_parcela integer,
    total_parcelas integer,
    credit_card_id text
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountPayable_pkey') THEN
    EXECUTE 'ALTER TABLE ONLY public."AccountPayable"
    ADD CONSTRAINT "AccountPayable_pkey" PRIMARY KEY (id)';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountPayable_credit_card_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public."AccountPayable"
    ADD CONSTRAINT "AccountPayable_credit_card_id_fkey" FOREIGN KEY (credit_card_id) REFERENCES public.credit_cards(id) ON UPDATE CASCADE ON DELETE SET NULL';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountPayable_supplier_id_fkey') THEN
    EXECUTE 'ALTER TABLE ONLY public."AccountPayable"
    ADD CONSTRAINT "AccountPayable_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE SET NULL';
  END IF;
END $$;

