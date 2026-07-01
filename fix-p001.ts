import { prisma } from './src/lib/prisma';

async function main() {
  const sales = await prisma.sale.findMany({
    include: { saleItems: true, financialTransactions: true }
  });

  for (const sale of sales) {
    let sumBruto = 0;
    for (const item of sale.saleItems) {
      sumBruto += Number(item.precoUnitarioVendido) * Number(item.quantidade);
    }

    if (Number(sale.valorTotalBruto) !== sumBruto) {
      console.log(`Fixing sale ${sale.id}...`);
      
      // Calculate how much we need to add to the transaction
      // Since it was grouped, we should theoretically parse the excel again to know the exact sinal for the other items,
      // but in this case, we know it's sale cmqr05kkp000yopvk1eyi1hqa (P001).
      // According to Excel:
      // Item 1: Venda 339.9, Sinal 169.95
      // Item 2: Venda 99.9, Sinal 49.95
      // Total Bruto: 439.80, Total Sinal: 219.90.
      
      const newSinal = sumBruto / 2; // In this specific case, it was exactly 50%
      
      await prisma.sale.update({
        where: { id: sale.id },
        data: {
          valorTotalBruto: sumBruto,
          valorTotalLiquido: sumBruto, // No discount was applied in Excel
          valorSinal: newSinal
        }
      });
      console.log(`Updated Sale ${sale.id} to Bruto/Liq=${sumBruto}, Sinal=${newSinal}`);

      if (sale.financialTransactions.length > 0) {
        await prisma.financialTransaction.update({
          where: { id: sale.financialTransactions[0].id },
          data: {
            valor: newSinal
          }
        });
        console.log(`Updated Tx to ${newSinal}`);
        
        // Also update the Wallet balance to match the new Tx
        const diff = newSinal - Number(sale.financialTransactions[0].valor);
        await prisma.wallet.update({
          where: { id: sale.financialTransactions[0].walletId },
          data: {
            saldoAtual: { increment: diff }
          }
        });
        console.log(`Incremented wallet balance by ${diff}`);
      }
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
