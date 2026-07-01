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
