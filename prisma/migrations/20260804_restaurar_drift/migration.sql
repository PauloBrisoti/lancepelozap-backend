-- Alinhamento final do schema com o schema.prisma (drift pré-existente).
-- Idempotente: guarda constraints/colunas e converte tipos preservando o instante.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_categories_store_id_fkey') THEN
    ALTER TABLE "financial_categories" DROP CONSTRAINT "financial_categories_store_id_fkey";
  END IF;
END $$;

ALTER TABLE "sales" ALTER COLUMN "finalized_at" TYPE TIMESTAMP(3) USING "finalized_at" AT TIME ZONE 'UTC';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'cartao_imediato' AND is_nullable = 'YES') THEN
    ALTER TABLE "stores" ALTER COLUMN "cartao_imediato" SET NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stores' AND column_name = 'dia_inicio_mes' AND is_nullable = 'YES') THEN
    ALTER TABLE "stores" ALTER COLUMN "dia_inicio_mes" SET NOT NULL;
  END IF;
END $$;
