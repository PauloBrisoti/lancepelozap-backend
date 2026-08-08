-- Limite de tentativas de login: bloqueio temporário por conta
ALTER TABLE "users" ADD COLUMN "login_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "lockout_until" TIMESTAMP(3);
