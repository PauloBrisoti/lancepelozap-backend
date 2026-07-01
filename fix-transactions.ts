import { prisma } from './src/lib/prisma';

async function main() {
  const txs = await prisma.financialTransaction.findMany({
    where: {
      tipo: 'RECEITA'
    }
  });

  console.log(`Found ${txs.length} transactions to fix.`);

  for (const tx of txs) {
    await prisma.financialTransaction.update({
      where: { id: tx.id },
      data: { tipo: 'ENTRADA' }
    });
  }
  console.log('Done fixing RECEITA -> ENTRADA.');
}
main().catch(console.error).finally(() => prisma.$disconnect());
