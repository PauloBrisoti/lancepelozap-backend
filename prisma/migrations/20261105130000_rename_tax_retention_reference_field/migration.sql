-- Alinha TaxRetention ao contrato fiscal (reference_id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tax_retentions' AND column_name = 'referencia_id'
  ) THEN
    ALTER TABLE "tax_retentions" RENAME COLUMN "referencia_id" TO "reference_id";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'tax_retentions_origem_tipo_referencia_id_idx'
  ) THEN
    ALTER INDEX "tax_retentions_origem_tipo_referencia_id_idx"
      RENAME TO "tax_retentions_origem_tipo_reference_id_idx";
  END IF;
END $$;
