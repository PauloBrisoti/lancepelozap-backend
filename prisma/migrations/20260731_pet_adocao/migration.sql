-- AlterTable
ALTER TABLE "pets" ADD COLUMN "adotado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pets" ADD COLUMN "data_adocao" TIMESTAMP(3);
