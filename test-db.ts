import { prisma } from './src/lib/prisma';

async function main() {
  const sales = await prisma.sale.findMany({ select: { id: true, dataVenda: true, valorTotalLiquido: true, formaPagamento: true, customer: { select: { nomeCompleto: true }} } });
  console.log("Sales:", JSON.stringify(sales, null, 2));
  
  const recs = await prisma.accountReceivable.findMany();
  console.log("Receivables:", JSON.stringify(recs, null, 2));

  const trans = await prisma.financialTransaction.findMany({ select: { dataTransacao: true, valor: true, tipo: true, categoria: true } });
  console.log("Transactions:", JSON.stringify(trans, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
