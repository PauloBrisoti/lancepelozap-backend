-- CreateTable
CREATE TABLE IF NOT EXISTS "pet_tutors" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT,
    "email" TEXT,
    "endereco" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "cep" TEXT,
    "observacoes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pet_tutors_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "pet_tutors_store_id_idx" ON "pet_tutors"("store_id");

CREATE TABLE IF NOT EXISTS "pets" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "tutor_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "especie" TEXT NOT NULL,
    "raca" TEXT,
    "porte" TEXT,
    "sexo" TEXT,
    "data_nascimento" DATE,
    "cor" TEXT,
    "observacoes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pets_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "pet_tutors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "pets_store_id_tutor_id_idx" ON "pets"("store_id", "tutor_id");

CREATE TABLE IF NOT EXISTS "pet_service_catalog" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "preco" DECIMAL(10,2) NOT NULL,
    "categoria" TEXT,
    "duracao_min" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pet_service_catalog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "pet_service_catalog_store_id_idx" ON "pet_service_catalog"("store_id");

CREATE TABLE IF NOT EXISTS "pet_service_orders" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "pet_id" TEXT NOT NULL,
    "data_agendamento" TIMESTAMP(3),
    "data_conclusao" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'AGENDADO',
    "valor_total" DECIMAL(10,2) NOT NULL,
    "desconto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "valor_final" DECIMAL(10,2) NOT NULL,
    "forma_pagamento" TEXT,
    "observacoes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pet_service_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pet_service_orders_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "pet_service_orders_store_id_pet_id_idx" ON "pet_service_orders"("store_id", "pet_id");

CREATE TABLE IF NOT EXISTS "pet_service_order_items" (
    "id" TEXT NOT NULL,
    "service_order_id" TEXT NOT NULL,
    "catalog_item_id" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "preco_unitario" DECIMAL(10,2) NOT NULL,
    "valor_total" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "pet_service_order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pet_service_order_items_order_id_fkey" FOREIGN KEY ("service_order_id") REFERENCES "pet_service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pet_service_order_items_catalog_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "pet_service_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "pet_service_order_items_order_id_catalog_id_idx" ON "pet_service_order_items"("service_order_id", "catalog_item_id");
