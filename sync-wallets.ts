import { prisma } from './src/lib/prisma';

async function main() {
  const wallets = await prisma.wallet.findMany();

  for (const wallet of wallets) {
    const txs = await prisma.financialTransaction.findMany({
      where: { walletId: wallet.id }
    });

    let newSaldo = 0;
    for (const tx of txs) {
      if (tx.tipo === 'ENTRADA') newSaldo += Number(tx.valor);
      if (tx.tipo === 'SAIDA') newSaldo -= Number(tx.valor);
    }

    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { saldoAtual: newSaldo }
    });
    console.log(`Wallet ${wallet.nome} updated: Saldo = ${newSaldo}`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
