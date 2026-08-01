-- CreateTable
CREATE TABLE "pet_vaccines" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "pet_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'VACINA',
    "dose" TEXT,
    "data_aplicacao" DATE NOT NULL,
    "proxima_dose" DATE,
    "observacoes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pet_vaccines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pet_weights" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "pet_id" TEXT NOT NULL,
    "peso_kg" DECIMAL(5,2) NOT NULL,
    "data_pesagem" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacoes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pet_weights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pet_vaccines_store_id_pet_id_idx" ON "pet_vaccines"("store_id", "pet_id");

-- CreateIndex
CREATE INDEX "pet_weights_store_id_pet_id_idx" ON "pet_weights"("store_id", "pet_id");

-- AddForeignKey
ALTER TABLE "pet_vaccines" ADD CONSTRAINT "pet_vaccines_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_weights" ADD CONSTRAINT "pet_weights_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
