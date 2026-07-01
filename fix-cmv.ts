import { prisma } from './src/lib/prisma';

async function main() {
  const sales = await prisma.sale.findMany({
    include: { saleItems: true, customer: true, financialTransactions: true }
  });

  for (const sale of sales) {
    let cmv = 0;
    for (const item of sale.saleItems) {
      cmv += Number(item.quantidade) * Number(item.custoUnitarioHistorico);
    }

    if (sale.cmvTotal.toNumber() !== cmv) {
      await prisma.sale.update({
        where: { id: sale.id },
        data: { cmvTotal: cmv }
      });
      console.log(`Updated sale ${sale.id} cmv to ${cmv}`);
    }

    const txs = await prisma.financialTransaction.findMany({
      where: { 
        dataTransacao: sale.dataVenda, 
        tipo: 'ENTRADA',
        saleId: null
      }
    });

    for (const tx of txs) {
      if (Number(tx.valor) === Number(sale.valorSinal) || Number(tx.valor) === Number(sale.valorTotalLiquido)) {
        const customerName = sale.customer?.nomeCompleto || 'Balcão';
        let newDesc = tx.descricao;
        if (!newDesc.includes(' - ')) {
            newDesc = `${tx.descricao} - ${customerName}`;
        }
        await prisma.financialTransaction.update({
          where: { id: tx.id },
          data: { 
            saleId: sale.id,
            descricao: newDesc,
            categoria: 'VENDAS'
          }
        });
        console.log(`Linked tx ${tx.id} to sale ${sale.id}`);
        break; 
      }
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
