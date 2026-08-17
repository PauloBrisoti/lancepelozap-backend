import { getErrorMessage } from './lib/errors';
import "dotenv/config";
import app from "./app";
import { prisma } from './lib/prisma';
import { logger } from './lib/logger';
import { alerts } from './lib/alerts';
import cron from "node-cron";
import { processarCobrancasRecorrentes } from "./services/PetRecorrenciaCron";
import { processarLembretesHospedagem } from "./services/PetLembretesService";
import { executarVarreduraAutomatica } from "./services/VarreduraFinanceiraService";

// ----- Handlers globais: falhas de processo NUNCA podem morrer em silêncio.
// PM2 reinicia o processo; o log `fatal` deixa o rastro e o alerta avisa.
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.fatal('Unhandled promise rejection', err);
  alerts.fire('unhandled-rejection', 'Unhandled promise rejection', { message: err.message, stack: err.stack });
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal('Uncaught exception', err);
  alerts.fire('uncaught-exception', 'Uncaught exception', { message: err.message, stack: err.stack });
  process.exit(1);
});

logger.info('SERVER STARTING');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  logger.fatal('JWT_SECRET não configurado ou inseguro (mínimo 16 caracteres).');
  process.exit(1);
}

(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('DB connection OK');
  } catch (err: unknown) {
    logger.warn('DB startup check failed (non-fatal)', { err: getErrorMessage(err) });
  }
})();

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  logger.info(`Servidor SaaS Backend rodando na porta ${PORT}`);
  logger.info('Sistema de Isolamento Multi-Tenant Ativado (Cookies HttpOnly).');
});

// Watchdog de anomalias (erro 5xx, memória, CPU, event loop, queries lentas)
alerts.startWatchdog();

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
