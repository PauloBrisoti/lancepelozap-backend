-- AlterTable
ALTER TABLE "pet_service_orders" ADD COLUMN "recorrente" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pet_service_orders" ADD COLUMN "periodicidade_meses" INTEGER NOT NULL DEFAULT 1;
