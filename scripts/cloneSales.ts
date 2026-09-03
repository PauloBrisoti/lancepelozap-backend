import dotenv from 'dotenv';
dotenv.config();
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const ORIGEM = 'cmqvdlgnv00028gl24va1b9eq'; // Velour
const DESTINO = 'cmtbqqtly0009v9yc60znnh4e'; // Loja Teste

async function main() {
  console.log('=== 1. Mapeando IDs (produtos e clientes) ===');

  const prodsOrigem = await prisma.product.findMany({ where: { storeId: ORIGEM }, select: { id: true, nome: true } });
  const prodsDestino = await prisma.product.findMany({ where: { storeId: DESTINO }, select: { id: true, nome: true } });
  const prodMap = new Map<string, string>();
  for (const p of prodsOrigem) {
    const dest = prodsDestino.find(d => d.nome === p.nome);
    if (dest) prodMap.set(p.id, dest.id);
  }
  console.log(`  Produtos mapeados: ${prodMap.size}/${prodsOrigem.length}`);

  const custOrigem = await prisma.customer.findMany({ where: { storeId: ORIGEM }, select: { id: true, cpf: true, nomeCompleto: true } });
  const custDestino = await prisma.customer.findMany({ where: { storeId: DESTINO }, select: { id: true, cpf: true, nomeCompleto: true } });
  const custMap = new Map<string, string>();
  for (const c of custOrigem) {
    const dest = custDestino.find(d => d.cpf === c.cpf && d.nomeCompleto === c.nomeCompleto);
    if (dest) custMap.set(c.id, dest.id);
  }
  console.log(`  Clientes mapeados: ${custMap.size}/${custOrigem.length}`);

  let wallet = await prisma.wallet.findFirst({ where: { storeId: DESTINO } });
  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: { storeId: DESTINO, nome: 'Caixa Interno', tipo: 'EMPRESA', saldoAtual: 0 }
    });
    console.log(`  Carteira criada: ${wallet.nome}`);
  } else {
    console.log(`  Carteira existente: ${wallet.nome} (saldo: R$ ${Number(wallet.saldoAtual).toFixed(2)})`);
  }

  const storeUser = await (prisma as any).storeUserAccess.findFirst({
    where: { storeId: DESTINO },
    select: { userId: true }
  });
  const userId = storeUser?.userId;
  if (!userId) {
    console.error('  ERRO: Nenhum user encontrado na Loja Teste');
    return;
  }
  console.log(`  User destino: ${userId}`);

  console.log('\n=== 2. Buscando vendas da Velour ===');
  const sales = await prisma.sale.findMany({
    where: { storeId: ORIGEM },
    include: {
      saleItems: true,
      receivables: true,
      financialTransactions: true,
    },
    orderBy: { dataVenda: 'asc' }
  });
  console.log(`  ${sales.length} vendas encontradas`);

  console.log('\n=== 3. Clonando vendas ===');
  let vendasClonadas = 0;
  let itensClonados = 0;
  let receivablesClonados = 0;
  let ftClonadas = 0;
  let walletDelta = 0;

  for (const sale of sales) {
    const novoSaleId = randomUUID();
    const novoCustomerId = sale.customerId ? (custMap.get(sale.customerId) || null) : null;

    await prisma.$transaction(async (tx) => {
      await tx.sale.create({
        data: {
          id: novoSaleId,
          storeId: DESTINO,
          userId,
          customerId: novoCustomerId,
          cashRegisterId: null,
          dataVenda: sale.dataVenda,
          valorTotalBruto: sale.valorTotalBruto,
          valorDesconto: sale.valorDesconto,
          valorTotalLiquido: sale.valorTotalLiquido,
          formaPagamento: sale.formaPagamento,
          valorSinal: sale.valorSinal,
          numeroParcelas: sale.numeroParcelas,
          valorTaxasGateway: sale.valorTaxasGateway,
          cmvTotal: sale.cmvTotal,
          status: sale.status,
          finalizedAt: sale.finalizedAt,
          observacoes: sale.observacoes,
          saleItems: {
            create: sale.saleItems.map(item => ({
              id: randomUUID(),
              productId: prodMap.get(item.productId) || item.productId,
              quantidade: item.quantidade,
              precoUnitarioVendido: item.precoUnitarioVendido,
              custoUnitarioHistorico: item.custoUnitarioHistorico,
              comissaoVendedorValor: item.comissaoVendedorValor,
            }))
          }
        }
      });
      itensClonados += sale.saleItems.length;
    });

    for (const rec of sale.receivables) {
      const novoRecCustomerId = custMap.get(rec.customerId) || rec.customerId;
      await prisma.accountReceivable.create({
        data: {
          id: randomUUID(),
          storeId: DESTINO,
          saleId: novoSaleId,
          customerId: novoRecCustomerId,
          dataVencimento: rec.dataVencimento,
          numeroParcela: rec.numeroParcela,
          totalParcelas: rec.totalParcelas,
          valorParcela: rec.valorParcela,
          formaPagamentoEsperada: rec.formaPagamentoEsperada,
          status: rec.status,
        }
      });
      receivablesClonados++;
    }

    for (const ft of sale.financialTransactions) {
      const novoFtCustomerId = ft.customerId ? (custMap.get(ft.customerId) || ft.customerId) : null;
      await prisma.financialTransaction.create({
        data: {
          id: randomUUID(),
          storeId: DESTINO,
          walletId: wallet.id,
          saleId: novoSaleId,
          tipo: ft.tipo,
          status: ft.status,
          valor: ft.valor,
          descricao: ft.descricao,
          dataTransacao: ft.dataTransacao,
          formaPagamento: ft.formaPagamento,
          categoria: ft.categoria,
          customerId: novoFtCustomerId,
          receivableId: null,
        }
      });
      walletDelta += ft.tipo === 'ENTRADA' ? Number(ft.valor) : -Number(ft.valor);
      ftClonadas++;
    }

    vendasClonadas++;
  }

  await prisma.wallet.update({
    where: { id: wallet.id },
    data: { saldoAtual: walletDelta }
  });

  console.log('\n═══════════════════════════════════════');
  console.log('  CLONAGEM DE VENDAS CONCLUÍDA');
  console.log('═══════════════════════════════════════');
  console.log(`  Vendas:             ${vendasClonadas}`);
  console.log(`  Itens:              ${itensClonados}`);
  console.log(`  Contas a Receber:   ${receivablesClonados}`);
  console.log(`  Transações (caixa): ${ftClonadas}`);
  console.log(`  Saldo carteira:     R$ ${walletDelta.toFixed(2)}`);
  console.log('═══════════════════════════════════════');
}

main()
  .catch((e) => { console.error('Erro:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
