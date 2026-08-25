/**
 * Backfill de Compras legadas sem Contas a Pagar (Opção B — completa)
 *
 * Escopo: purchase_orders com status RECEBIDO e contas a pagar ausentes/parciais.
 * Ações por pedido:
 *  - Gera APs faltantes (PAGO p/ à vista/entrada; PENDENTE p/ parcelas)
 *  - Para cada AP PAGO gerada: cria financial_transaction (SAIDA/PAGAMENTO_FORNECEDOR)
 *    na carteira do pedido ou na carteira "Caixa*" padrão da loja + decrementa saldo
 *  - Datas: base = data_pedido, incrementos mensais clampados (addMonthsClamped)
 *
 * Uso:  npx tsx scripts/backfillComprasAp.ts          # DRY-RUN (não escreve)
 *       npx tsx scripts/backfillComprasAp.ts --exec   # aplica em transação única
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const EXEC = process.argv.includes('--exec');
const CENT = 0.011;

function addMonthsClamped(base: Date, months: number): Date {
  const t = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(base.getDate(), last));
  return t;
}

type Slot = { n: number; valor: number; pago: boolean; due: Date };

function expectedSlots(order: {
  formaPagamento: string; numeroParcelas: number | null;
  valorTotalLiquido: any; valorEntrada: any; dataPedido: Date;
}): Slot[] {
  const total = Number(order.valorTotalLiquido);
  const entrada = Number(order.valorEntrada || 0);
  const n = Math.max(1, order.numeroParcelas || 1);
  const slots: Slot[] = [];

  if (order.formaPagamento === 'A_VISTA') {
    slots.push({ n: 1, valor: total, pago: true, due: order.dataPedido });
    return slots;
  }
  let remaining = total;
  let startIndex = 1;
  if (entrada > 0) {
    slots.push({ n: 1, valor: entrada, pago: true, due: order.dataPedido });
    remaining = total - entrada;
    startIndex = 2;
  }
  const count = n - startIndex + 1;
  const each = Math.round((remaining / count) * 100) / 100;
  const ultima = Math.round((remaining - each * (count - 1)) * 100) / 100;
  for (let i = startIndex; i <= n; i++) {
    slots.push({
      n: i,
      valor: i === n ? ultima : each,
      pago: false,
      due: addMonthsClamped(order.dataPedido, i - startIndex),
    });
  }
  return slots;
}

async function defaultWallet(storeId: string, preferred?: string | null) {
  if (preferred) {
    const w = await prisma.wallet.findFirst({ where: { id: preferred, storeId } });
    if (w) return w;
  }
  const caixa = await prisma.wallet.findFirst({
    where: { storeId, nome: { contains: 'caixa', mode: 'insensitive' } },
    orderBy: { id: 'asc' },
  });
  if (caixa) return caixa;
  return prisma.wallet.findFirst({ where: { storeId }, orderBy: { id: 'asc' } });
}

async function main() {
  const orders = await prisma.purchaseOrder.findMany({
    where: { status: 'RECEBIDO' },
    include: {
      accountsPayable: true,
      supplier: { select: { nome: true } },
      store: { select: { nomeFantasia: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  type Plan = { orderId: string; label: string; missing: Slot[]; existingSum: number; total: number };
  const plans: (Plan & { walletName: string; walletId: string })[] = [];
  let skippedOk = 0;

  for (const o of orders) {
    const slots = expectedSlots(o);
    const existingByN = new Map(o.accountsPayable.map(a => [a.numeroParcela, a]));
    const missing = slots.filter(s => !existingByN.has(s.n));
    const existingSum = o.accountsPayable.reduce((acc, a) => acc + Number(a.valor), 0);
    const total = Number(o.valorTotalLiquido);

    if (missing.length === 0 && Math.abs(existingSum - total) < CENT) { skippedOk++; continue; }

    const wallet = await defaultWallet(o.storeId, o.walletIdEntrada);
    plans.push({
      orderId: o.id,
      label: `#${o.orderNumber} ${o.store.nomeFantasia} ${o.formaPagamento}${o.numeroParcelas ? ` ${o.numeroParcelas}x` : ''} (${o.supplier?.nome || 'sem fornecedor'})`,
      missing, existingSum, total,
      walletName: wallet ? `${wallet.nome}` : '(SEM CARTEIRA!)',
      walletId: wallet?.id || '',
    });
  }

  console.log(`\n=== DRY-RUN=${!EXEC} — pedidos RECEBIDO: ${orders.length} | consistentes: ${skippedOk} | a corrigir: ${plans.length} ===`);
  const totalsByWallet = new Map<string, number>();
  for (const p of plans) {
    const sumMiss = p.missing.reduce((a, s) => a + s.valor, 0);
    const paidMiss = p.missing.filter(s => s.pago).reduce((a, s) => a + s.valor, 0);
    if (EXEC && paidMiss > 0) totalsByWallet.set(p.walletId, (totalsByWallet.get(p.walletId) || 0) + paidMiss);
    console.log(`\n${p.label}`);
    console.log(`  APs existentes: soma=${p.existingSum.toFixed(2)} | esperado total=${p.total.toFixed(2)} | faltando ${p.missing.length} parcela(s): ${sumMiss.toFixed(2)}`);
    for (const s of p.missing) {
      console.log(`   → AP ${s.n}/${p.missing.length ? '' : ''}valor=${s.valor.toFixed(2)} status=${s.pago ? 'PAGO' : 'PENDENTE'} venc=${s.due.toISOString().slice(0, 10)}${s.pago ? ` | FT saída carteira="${p.walletName}"` : ''}`);
    }
  }
  if (plans.length === 0) { console.log('Nada a fazer.'); return; }

  if (!EXEC) {
    console.log('\n(dry-run: nada foi gravado. Rode novamente com --exec para aplicar.)');
    return;
  }

  await prisma.$transaction(async tx => {
    for (const p of plans) {
      const o = orders.find(x => x.id === p.orderId)!;
      const slots = expectedSlots(o);
      const existingByN = new Map(o.accountsPayable.map(a => [a.numeroParcela, a]));
      for (const s of p.missing.filter(m => !existingByN.has(m.n))) {
        const wallet = await defaultWallet(o.storeId, o.walletIdEntrada);
        if (!wallet && s.pago) throw new Error(`Pedido ${o.id}: sem carteira para lançar saída`);

        await tx.accountPayable.create({
          data: {
            storeId: o.storeId,
            descricao: s.pago
              ? `Pagamento do pedido #${o.orderNumber} (backfill)`
              : (slots.length > 1 ? `Parcela ${s.n}/${slots.length} do pedido #${o.orderNumber} (backfill)` : `Pagamento do pedido #${o.orderNumber} (backfill)`),
            supplierId: o.supplierId,
            creditCardId: null,
            purchaseOrderId: o.id,
            numeroParcela: s.n,
            totalParcelas: slots.length,
            dataVencimento: s.due,
            valor: s.valor,
            status: s.pago ? 'PAGO' : 'PENDENTE',
          },
        });

        if (s.pago) {
          await tx.financialTransaction.create({
            data: {
              storeId: o.storeId,
              walletId: wallet!.id,
              tipo: 'SAIDA',
              valor: s.valor,
              descricao: `Pagamento do pedido #${o.orderNumber} (backfill)`,
              categoria: 'PAGAMENTO_FORNECEDOR',
              supplierId: o.supplierId,
              dataTransacao: o.dataPedido,
              status: 'ATIVA',
            },
          });
          await tx.wallet.update({
            where: { id: wallet!.id },
            data: { saldoAtual: { decrement: s.valor } },
          });
        }
      }
    }
  });

  console.log('\n=== EXECUTADO. Impacto por carteira ===');
  for (const [wid, sum] of totalsByWallet) {
    const w = await prisma.wallet.findUnique({ where: { id: wid } });
    console.log(`${w?.nome} (${w?.storeId}): -${sum.toFixed(2)} → saldo atual agora ${(Number(w?.saldoAtual)).toFixed(2)}`);
  }
}

main().finally(() => prisma.$disconnect());
