-- Churn: rastreia a data da última mudança de estado da assinatura
ALTER TABLE "subscriptions" ADD COLUMN "updated_at" TIMESTAMP(3);
UPDATE "subscriptions" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "subscriptions" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "subscriptions" ALTER COLUMN "updated_at" SET NOT NULL;
