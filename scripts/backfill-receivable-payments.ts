import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL não configurada');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function backfill() {
  console.log('🔍 Buscando contas a receber sem pagamentos linkados...');

  const receivables = await prisma.accountReceivable.findMany({
    where: { payments: { none: {} } },
    select: {
      id: true,
      storeId: true,
      numeroParcela: true,
      totalParcelas: true,
      valorParcela: true,
    },
  });

  console.log(`📊 ${receivables.length} receivables sem payments linkados`);

  let linked = 0;
  let totalTx = 0;

  for (const rec of receivables) {
    const parcelPattern = `Parcela ${rec.numeroParcela}/${rec.totalParcelas}`;

    const transactions = await prisma.financialTransaction.findMany({
      where: {
        storeId: rec.storeId,
        tipo: 'ENTRADA',
        status: 'ATIVA',
        receivableId: null,
        descricao: { contains: parcelPattern },
      },
      select: { id: true, valor: true },
    });

    if (transactions.length === 0) continue;

    await prisma.financialTransaction.updateMany({
      where: { id: { in: transactions.map((t) => t.id) } },
      data: { receivableId: rec.id },
    });

    linked++;
    totalTx += transactions.length;
    const sumValor = transactions.reduce((s, t) => s + Number(t.valor), 0);
    console.log(
      `  ✅ Parcela ${rec.numeroParcela}/${rec.totalParcelas}: ${transactions.length} tx(s) vinculadas (R$ ${sumValor.toFixed(2)})`
    );
  }

  console.log(`\n✅ Backfill concluído: ${linked} receivables vinculados (${totalTx} transações)`);
}

backfill()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
