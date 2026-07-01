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

  // 1. Find or create Cliente Avulso
  let avulso = await prisma.customer.findFirst({
    where: { storeId, nomeCompleto: 'Cliente Avulso' },
  });
  if (!avulso) {
    avulso = await prisma.customer.create({
      data: {
        storeId,
        nomeCompleto: 'Cliente Avulso',
      },
    });
    console.log('✅ Cliente Avulso criado:', avulso.id);
  } else {
    console.log('✅ Cliente Avulso já existe:', avulso.id);
  }

  // 2. Find CREDIARIO sales without customerId
  const sales = await prisma.sale.findMany({
    where: {
      storeId,
      formaPagamento: 'CREDIARIO',
      status: { not: 'CANCELADA' },
      customerId: null,
    },
    select: { id: true, valorTotalLiquido: true, valorSinal: true, numeroParcelas: true, dataVenda: true },
  });

  if (sales.length === 0) {
    console.log('Nenhuma venda CREDIARIO sem cliente encontrada');
    return;
  }

  console.log(`\n📦 ${sales.length} venda(s) sem cliente:`);

  for (const sale of sales) {
    // Update sale to point to Cliente Avulso
    await prisma.sale.update({
      where: { id: sale.id },
      data: { customerId: avulso.id },
    });

    const valorRestante = Number(sale.valorTotalLiquido) - Number(sale.valorSinal || 0);
    const parcelas = Number(sale.numeroParcelas || 1);
    if (valorRestante <= 0) {
      console.log(`   ⏭️ Venda ${sale.id.slice(0, 8)}: fiado = R$ 0,00`);
      continue;
    }

    const valorParcela = valorRestante / parcelas;
    console.log(`   Venda ${sale.id.slice(0, 8)}: fiado=R$ ${valorRestante.toFixed(2)}, ${parcelas}x de R$ ${valorParcela.toFixed(2)}`);

    for (let i = 1; i <= parcelas; i++) {
      const dataVencimento = new Date(sale.dataVenda);
      dataVencimento.setMonth(dataVencimento.getMonth() + i);
      await prisma.accountReceivable.create({
        data: {
          storeId,
          saleId: sale.id,
          customerId: avulso.id,
          dataVencimento,
          numeroParcela: i,
          totalParcelas: parcelas,
          valorParcela,
          formaPagamentoEsperada: 'PIX',
          status: 'PENDENTE',
        },
      });
    }
    console.log(`   ✅ ${parcelas} recebíveis criados`);
  }

  // 3. Verify all CREDIARIO sales now have matching receivables
  const allSales = await prisma.sale.findMany({
    where: { storeId, formaPagamento: 'CREDIARIO', status: { not: 'CANCELADA' } },
    include: {
      receivables: {
        where: { status: { not: 'CANCELADA' } },
        select: { valorParcela: true },
      },
    },
  });

  console.log('\n=== VERIFICAÇÃO FINAL ===');
  for (const s of allSales) {
    const totalRec = s.receivables.reduce((acc, r) => acc + Number(r.valorParcela), 0);
    const expected = Number(s.valorTotalLiquido) - Number(s.valorSinal || 0);
    const diff = Math.abs(totalRec - expected);
    console.log(
      `   ${s.id.slice(0, 8)}: esperado=R$ ${expected.toFixed(2)}, total=R$ ${totalRec.toFixed(2)}, qtd=${s.receivables.length}${diff > 0.02 ? ` ⚠️ diferença=R$ ${diff.toFixed(2)}` : ' ✅'}`
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
