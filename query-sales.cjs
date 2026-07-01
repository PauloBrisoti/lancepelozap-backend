const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sales = await prisma.sale.findMany({
    orderBy: { dataVenda: 'desc' },
    take: 10
  });
  console.log('Recent Sales:');
  for (const s of sales) {
    console.log(`ID: ${s.id}, Data: ${s.dataVenda}, Status: ${s.status}, Total: ${s.valorTotalLiquido}`);
  }
}
main().finally(() => prisma.$disconnect());
