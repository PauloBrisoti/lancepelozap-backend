import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL não configurada');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const storeId = process.env.STORE_ID || 'cmqubm8l7000avbl2lhvb8v0q';

  // 1. Unlink all payment transactions
  console.log('🔗 Desvinculando transações de pagamento...');
  const unlinked = await prisma.financialTransaction.updateMany({
    where: { storeId, receivableId: { not: null } },
    data: { receivableId: null },
  });
  console.log(`   ${unlinked.count} transações desvinculadas`);

  // 2. Delete all non-canceled receivables for this store
  console.log('🗑️ Removendo recebíveis existentes...');
  const deleted = await prisma.accountReceivable.deleteMany({
    where: { storeId, status: { not: 'CANCELADA' } },
  });
  console.log(`   ${deleted.count} recebíveis removidos`);

  // 3. Recreate receivables for each CREDIARIO sale
  const sales = await prisma.sale.findMany({
    where: { storeId, formaPagamento: 'CREDIARIO', status: { not: 'CANCELADA' } },
    select: { id: true, valorTotalLiquido: true, valorSinal: true, numeroParcelas: true, dataVenda: true, customerId: true },
  });
  console.log(`\n📦 Recriando recebíveis para ${sales.length} vendas CREDIARIO...`);

  interface NewReceivable {
    id: string;
    saleId: string;
    numeroParcela: number;
    totalParcelas: number;
  }
  const newReceivables: NewReceivable[] = [];

  for (const sale of sales) {
    const valorRestante = Number(sale.valorTotalLiquido) - Number(sale.valorSinal || 0);
    const parcelas = Number(sale.numeroParcelas || 1);
    if (valorRestante <= 0 || parcelas <= 0) {
      console.log(`   ⏭️ Venda ${sale.id.slice(0, 8)}: fiado R$ ${valorRestante.toFixed(2)}, pulando`);
      continue;
    }
    const valorParcela = valorRestante / parcelas;
    console.log(`   Venda ${sale.id.slice(0, 8)}: fiado=R$ ${valorRestante.toFixed(2)}, ${parcelas}x de R$ ${valorParcela.toFixed(2)}`);

    for (let i = 1; i <= parcelas; i++) {
      const dataVencimento = new Date(sale.dataVenda);
      dataVencimento.setDate(dataVencimento.getDate() + i * 30);

      if (!sale.customerId) {
        console.log(`   ⏭️ Venda ${sale.id.slice(0, 8)}: sem customerId, pulando`);
        continue;
      }
      const receivable = await prisma.accountReceivable.create({
        data: {
          storeId,
          saleId: sale.id,
          customerId: sale.customerId,
          dataVencimento,
          numeroParcela: i,
          totalParcelas: parcelas,
          valorParcela,
          formaPagamentoEsperada: 'PIX',
          status: 'PENDENTE',
        },
      });
      newReceivables.push({ id: receivable.id, saleId: sale.id, numeroParcela: i, totalParcelas: parcelas });
    }
  }

  // 4. Re-link payment transactions
  console.log(`\n🔗 Re-vinculando ${unlinked.count} transações de pagamento...`);
  const transactions = await prisma.financialTransaction.findMany({
    where: { storeId, tipo: 'ENTRADA', status: 'ATIVA', receivableId: null },
    select: { id: true, saleId: true, descricao: true, valor: true },
  });

  let relinked = 0;
  for (const tx of transactions) {
    const match = tx.descricao.match(/Parcela (\d+)\/(\d+)/);
    if (!match) continue;
    const [, strParcela, strTotal] = match;
    const parcelaNum = parseInt(strParcela);
    const parcelaTotal = parseInt(strTotal);

    // Find a matching new receivable
    let targetSaleId = tx.saleId;
    if (!targetSaleId) {
      // Try to find by matching pattern in all new receivables
      const candidate = newReceivables.find(
        (r) => r.numeroParcela === parcelaNum && r.totalParcelas === parcelaTotal
      );
      if (candidate) {
        await prisma.financialTransaction.update({
          where: { id: tx.id },
          data: { receivableId: candidate.id },
        });
        relinked++;
        console.log(`   ✅ ${tx.descricao}: R$ ${tx.valor} → recebível ${candidate.id.slice(0, 8)}`);
      }
    } else {
      const candidate = newReceivables.find(
        (r) => r.saleId === targetSaleId && r.numeroParcela === parcelaNum && r.totalParcelas === parcelaTotal
      );
      if (candidate) {
        await prisma.financialTransaction.update({
          where: { id: tx.id },
          data: { receivableId: candidate.id },
        });
        relinked++;
        console.log(`   ✅ ${tx.descricao}: R$ ${tx.valor} → recebível ${candidate.id.slice(0, 8)}`);
      }
    }
  }
  console.log(`\n   ${relinked}/${unlinked.count} transações re-vinculadas`);

  console.log('\n✅ Limpeza e recriação concluídas!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
