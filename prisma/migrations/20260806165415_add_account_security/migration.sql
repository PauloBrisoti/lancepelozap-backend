-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verification_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "email_verified_at" TIMESTAMP(3),
ADD COLUMN     "email_verify_token" TEXT,
ADD COLUMN     "email_verify_token_expires" TIMESTAMP(3),
ADD COLUMN     "last_login_ip" TEXT;
