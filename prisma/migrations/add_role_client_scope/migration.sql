-- Escopo por loja: papéis internos restritos a um cliente específico
ALTER TABLE "internal_roles" ADD COLUMN "client_id" TEXT;
ALTER TABLE "internal_roles" ADD CONSTRAINT "internal_roles_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
