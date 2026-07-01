import "dotenv/config";
import app from "./app";
import { prisma } from './lib/prisma';

import fs from 'fs';
console.log('>>> SERVER RESTARTED <<<');
console.log('>>> CONNECTED TO DB:', process.env.DATABASE_URL);
async function testDb() {
  const store = await prisma.store.findFirst();
  console.log('>>> FIRST STORE IN SERVER DB:', store?.id);
  fs.appendFileSync('imports.log', `[STARTUP] DATABASE_URL: ${process.env.DATABASE_URL}\n[STARTUP] FIRST STORE ID: ${store?.id}\n`);
}
testDb();

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.info(`🚀 Servidor SaaS Backend rodando na porta ${PORT}`);
  console.info(`🔒 Sistema de Isolamento Multi-Tenant Ativado (Cookies HttpOnly).`);
});