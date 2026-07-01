import { prisma } from './src/lib/prisma';

async function main() {
  const sales = await prisma.sale.findMany({
    include: { saleItems: { include: { product: true } }, financialTransactions: true }
  });
  for(const s of sales) {
    console.log(`Sale ${s.id} (Tx: ${s.financialTransactions[0]?.descricao || 'none'}):`);
    for(const item of s.saleItems) {
      console.log(`  - Item: ${item.product.nome} (Qtd: ${item.quantidade}, Custo: ${item.custoUnitarioHistorico})`);
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
