import "dotenv/config";
import app from "./app";
import { prisma } from './lib/prisma';
import cron from "node-cron";
import { processarCobrancasRecorrentes } from "./services/PetRecorrenciaCron";
import { processarLembretesHospedagem } from "./services/PetLembretesService";
import { executarVarreduraAutomatica } from "./services/VarreduraFinanceiraService";

console.log('>>> SERVER STARTING <<<');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.error('FATAL: JWT_SECRET não configurado ou inseguro (mínimo 16 caracteres).');
  process.exit(1);
}

(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('>>> DB connection OK');
  } catch (err: any) {
    console.warn('>>> DB startup check failed (non-fatal):', err?.message);
  }
})();

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.info(`🚀 Servidor SaaS Backend rodando na porta ${PORT}`);
  console.info(`🔒 Sistema de Isolamento Multi-Tenant Ativado (Cookies HttpOnly).`);
});

cron.schedule("0 2 * * *", () => {
  processarCobrancasRecorrentes();
}, { timezone: "America/Sao_Paulo" });

cron.schedule("0 8 * * *", () => {
  processarLembretesHospedagem();
}, { timezone: "America/Sao_Paulo" });

// Varredura Financeira diária às 09:00 (horário de Brasília) — idempotente por dia
cron.schedule("0 9 * * *", () => {
  executarVarreduraAutomatica();
}, { timezone: "America/Sao_Paulo" });
