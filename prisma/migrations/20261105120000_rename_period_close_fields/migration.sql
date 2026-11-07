-- Alinha o modelo PeriodClose ao contrato contábil (closed_at / closed_by)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'period_closes' AND column_name = 'data_fechamento'
  ) THEN
    ALTER TABLE "period_closes" RENAME COLUMN "data_fechamento" TO "closed_at";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'period_closes' AND column_name = 'fechado_por'
  ) THEN
    ALTER TABLE "period_closes" RENAME COLUMN "fechado_por" TO "closed_by";
  END IF;
END $$;
