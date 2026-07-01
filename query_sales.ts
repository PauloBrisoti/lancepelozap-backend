import { prisma } from './src/lib/prisma';

async function main() {
  const sales = await prisma.sale.findMany({
    orderBy: { dataVenda: 'desc' }
  });
  
  console.log(`Total de vendas: ${sales.length}`);
  
  const formas: any = {};
  sales.forEach(s => {
    formas[s.formaPagamento] = (formas[s.formaPagamento] || 0) + 1;
  });
  
  console.log('Formas de pagamento:', formas);
  
  console.log('\nÚltimas 15 vendas:');
  sales.slice(0, 15).forEach(s => {
    console.log(`${s.dataVenda.toISOString()} - ${s.formaPagamento} - ${s.status} - R$ ${s.valorTotalLiquido}`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
