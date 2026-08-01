-- Add maxEmployees field to Plan model with safe default
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "max_employees" INTEGER NOT NULL DEFAULT 3;
