-- AlterTable
ALTER TABLE "impersonation_logs" ADD COLUMN     "ended_at" TIMESTAMP(3),
ADD COLUMN     "tipo" TEXT NOT NULL DEFAULT 'START';
