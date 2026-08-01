import "dotenv/config";
import app from "./app";
import { prisma } from './lib/prisma';
import cron from "node-cron";
import { processarCobrancasRecorrentes } from "./services/PetRecorrenciaCron";
import { processarLembretesHospedagem } from "./services/PetLembretesService";

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
});

cron.schedule("0 8 * * *", () => {
  processarLembretesHospedagem();
});
