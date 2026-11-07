-- Governança de crédito: limite sempre numérico (nunca NULL)
UPDATE "customers" SET "limite_credito" = 0 WHERE "limite_credito" IS NULL;
ALTER TABLE "customers" ALTER COLUMN "limite_credito" SET DEFAULT 0;
ALTER TABLE "customers" ALTER COLUMN "limite_credito" SET NOT NULL;
