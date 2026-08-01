import { beforeAll, afterAll, afterEach } from 'vitest';
import { prisma } from '../lib/prisma';

beforeAll(async () => {
  // Limpar as tabelas principais antes da suíte de testes (opcional, dependendo de como você quer rodar os testes isolados)
  await clearDatabase();
});

// Removed afterEach to prevent wiping DB between tests that share beforeAll state

afterAll(async () => {
  await prisma.$disconnect();
});

async function clearDatabase() {
  const url = process.env.DATABASE_URL || '';
  const dbName = (url.split('/').pop() || '').split('?')[0];
  const isTestDb = dbName.toLowerCase().includes('test');
  if (!isTestDb && process.env.ALLOW_DB_WIPE !== '1') {
    throw new Error(
      `[TEST-SAFETY] Recusando limpeza: o banco '${dbName}' não parece ser um banco de testes. ` +
      `Defina ALLOW_DB_WIPE=1 para confirmar que pode apagar os dados, ou use um DATABASE_URL de teste (ex.: saas_test).`
    );
  }

  const tableNames = await prisma.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

  const tables = tableNames
    .map(({ tablename }) => tablename)
    .filter((name) => name !== '_prisma_migrations')
    .map((name) => `"public"."${name}"`)
    .join(', ');

  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
  } catch (error) {
    console.log({ error });
  }
}
