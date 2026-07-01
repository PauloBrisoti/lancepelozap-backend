import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const sales = await prisma.sale.findMany({
    include: {
      items: true
    },
    orderBy: { dataVenda: 'desc' }
  });
  
  console.log(`Total Sales em Banco: ${sales.length}`);
  let totalFaturamento = 0;
  let totalCmv = 0;
  let itemCount = 0;

  sales.forEach(s => {
    if (s.status !== 'CANCELADA') {
      totalFaturamento += Number(s.valorTotalLiquido);
      totalCmv += Number(s.cmvTotal);
      itemCount += s.items.length;
    }
    console.log(`Venda ID: ${s.id} | Status: ${s.status} | Data: ${s.dataVenda.toISOString()} | Forma: ${s.formaPagamento} | Valor: R$ ${s.valorTotalLiquido} | CMV: R$ ${s.cmvTotal} | Observacoes: ${s.observacoes} | Itens: ${s.items.length}`);
  });
  
  console.log(`\nRESUMO ATIVAS:`);
  console.log(`Faturamento Liquido: R$ ${totalFaturamento.toFixed(2)}`);
  console.log(`CMV Total: R$ ${totalCmv.toFixed(2)}`);
  console.log(`Itens Vendidos: ${itemCount}`);
}

main().finally(() => prisma.$disconnect());
