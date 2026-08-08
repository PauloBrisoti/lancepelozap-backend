import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { buildDateRange, calcPrevBounds } from '../lib/dateUtils';
import { startOfDay } from 'date-fns';
import { asyncHandler, getStoreId } from '../lib/asyncHandler';

type Decimal = { toString: () => string };

export class DashboardPJController {
  static getDashboardMetrics = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);

    const queryStart = req.query.startDate as string;
    const queryEnd = req.query.endDate as string;
    const { firstDay, lastDay } = buildDateRange(queryStart, queryEnd);
    const { prevFirstDay, prevLastDay } = calcPrevBounds(firstDay, lastDay);

    const daysDiff = Math.round((lastDay.getTime() - firstDay.getTime()) / (1000 * 60 * 60 * 24)) || 1;

    // 0. SALDO ACUMULADO (saldos reais das carteiras)
    const wallets = await prisma.wallet.findMany({ where: { storeId } });
    const saldoAcumulado = wallets.reduce((acc, w) => acc + Number(w.saldoAtual), 0);

    // 1. DINHEIRO IMOBILIZADO NO ESTOQUE
    const products = await prisma.product.findMany({
      where: { storeId, status: 'ATIVO' },
      select: { precoCusto: true, qtdEstoqueAtual: true }
    });
    const dinheiroImobilizado = products.reduce((acc, p) => acc + (Number(p.precoCusto) * Number(p.qtdEstoqueAtual)), 0);

    // ─── PERÍODO ATUAL ─────────────────────────────────────
    const [salesAgg, petOrdersAgg, receitasCaixa, despesasAgg, saidasTotaisAgg, aReceberAgg] = await Promise.all([
      prisma.sale.aggregate({
        where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: firstDay, lte: lastDay } },
        _sum: { cmvTotal: true, valorTotalLiquido: true, valorTotalBruto: true, valorDesconto: true, valorTaxasGateway: true }
      }),
      prisma.petServiceOrder.aggregate({
        where: { storeId, status: 'CONCLUIDO', dataConclusao: { gte: firstDay, lte: lastDay } },
        _sum: { valorFinal: true }
      }),
      prisma.financialTransaction.aggregate({
        where: { storeId, tipo: 'ENTRADA', status: 'ATIVA', dataTransacao: { gte: firstDay, lte: lastDay } },
        _sum: { valor: true }
      }),
      // Bloco 2: Despesas Operacionais (exclui custo de estoque e retiradas)
      prisma.financialTransaction.aggregate({
        where: { storeId, tipo: 'SAIDA', dataTransacao: { gte: firstDay, lte: lastDay }, categoria: { notIn: ['PRO_LABORE', 'DEVOLUCAO', 'RETIRADA_LUCRO', 'CANCELAMENTO', 'PAGAMENTO_FORNECEDOR', 'COMPRA_ESTOQUE'] } },
        _sum: { valor: true }
      }),
      // Bloco 1: Saídas totais (para fluxo de caixa real)
      prisma.financialTransaction.aggregate({
        where: { storeId, tipo: 'SAIDA', dataTransacao: { gte: firstDay, lte: lastDay }, categoria: { notIn: ['DEVOLUCAO', 'CANCELAMENTO'] } },
        _sum: { valor: true }
      }),
      // A Receber (Fiado/Prazo) — todos pendentes, independente do vencimento
      prisma.accountReceivable.findMany({
        where: { storeId, status: { not: 'CANCELADA' } },
        select: {
          valorParcela: true,
          payments: {
            where: { tipo: 'ENTRADA', status: 'ATIVA' },
            select: { valor: true }
          }
        }
      }),
    ]);

    const petRevenue = Number(petOrdersAgg._sum.valorFinal || 0);
    const cmvMes = Number(salesAgg._sum.cmvTotal || 0);
    const volumeVendasMes = Number(salesAgg._sum.valorTotalLiquido || 0) + petRevenue;
    const faturamentoBruto = Number(salesAgg._sum.valorTotalBruto || 0) + petRevenue;
    const totalDescontos = Number(salesAgg._sum.valorDesconto || 0);
    const totalTaxasGateway = Number(salesAgg._sum.valorTaxasGateway || 0);
    const faturamentoLiquido = faturamentoBruto - totalDescontos - totalTaxasGateway;
    const dinheiroCaixaRealizado = Number(receitasCaixa._sum.valor || 0);

    // ─── BLOCO 1: FLUXO FINANCEIRO (Regime de Caixa Puro) ──
    const saidasTotaisMes = Number(saidasTotaisAgg._sum.valor || 0);
    const saldoDisponivel = saldoAcumulado + dinheiroCaixaRealizado - saidasTotaisMes;

    // ─── BLOCO 2: RESULTADO DA OPERAÇÃO (Regime de Competência) ──
    const despesasOperacionais = Number(despesasAgg._sum.valor || 0);
    const lucroOperacao = faturamentoLiquido - cmvMes - despesasOperacionais;

    const aReceberFiado = (aReceberAgg as Array<{ valorParcela: any; payments: Array<{ valor: any }> }>).reduce((acc, r) => {
      const totalPago = r.payments.reduce((s, p) => s + Number(p.valor), 0);
      return acc + (Number(r.valorParcela) - totalPago);
    }, 0);
    // ─── PERÍODO ANTERIOR (growth calc) ────────────────────
    const [prevSalesAgg, prevDespesasAggr, prevPetOrdersAgg] = await Promise.all([
      prisma.sale.aggregate({
        where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: prevFirstDay, lte: prevLastDay } },
        _sum: { cmvTotal: true, valorTotalLiquido: true, valorTotalBruto: true, valorDesconto: true, valorTaxasGateway: true }
      }),
      prisma.financialTransaction.aggregate({
        where: { storeId, tipo: 'SAIDA', dataTransacao: { gte: prevFirstDay, lte: prevLastDay }, categoria: { notIn: ['PRO_LABORE', 'DEVOLUCAO', 'RETIRADA_LUCRO', 'CANCELAMENTO', 'PAGAMENTO_FORNECEDOR', 'COMPRA_ESTOQUE'] } },
        _sum: { valor: true }
      }),
      prisma.petServiceOrder.aggregate({
        where: { storeId, status: 'CONCLUIDO', dataConclusao: { gte: prevFirstDay, lte: prevLastDay } },
        _sum: { valorFinal: true }
      }),
    ]);

    const prevPetRevenue = Number(prevPetOrdersAgg._sum.valorFinal || 0);
    const prevFatBruto = Number(prevSalesAgg._sum.valorTotalBruto || 0) + prevPetRevenue;
    const prevDescontos = Number(prevSalesAgg._sum.valorDesconto || 0);
    const prevTaxas = Number(prevSalesAgg._sum.valorTaxasGateway || 0);
    const prevFatLiq = prevFatBruto - prevDescontos - prevTaxas;
    const prevCmv = Number(prevSalesAgg._sum.cmvTotal || 0);
    const prevDespesas = Number(prevDespesasAggr._sum.valor || 0);
    const prevLucroOperacao = prevFatLiq - prevCmv - prevDespesas;

    // ─── IMPOSTOS ESTIMADOS ────────────────────────────────
    const storeData = await prisma.store.findUnique({
      where: { id: storeId },
      select: { aliquotaImposto: true }
    });
    const aliquotaImposto = Number(storeData?.aliquotaImposto || 0);
    const salesForTax = await prisma.sale.findMany({
      where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: firstDay, lte: lastDay } },
      select: {
        saleItems: {
          select: {
            precoUnitarioVendido: true,
            quantidade: true,
            product: {
              select: {
                impostoEstimadoPercentual: true,
                category: { select: { aliquotaImposto: true } }
              }
            }
          }
        }
      }
    });
    let impostosEstimados = 0;
    for (const sale of salesForTax) {
      for (const item of sale.saleItems) {
        const itemValor = Number(item.precoUnitarioVendido) * Number(item.quantidade);
        const prodRate = Number(item.product?.impostoEstimadoPercentual || 0);
        const catRate = Number(item.product?.category?.aliquotaImposto || 0);
        const effectiveRate = prodRate > 0 ? prodRate : (catRate > 0 ? catRate : aliquotaImposto);
        if (effectiveRate > 0) {
          impostosEstimados += itemValor * effectiveRate / 100;
        }
      }
    }
    impostosEstimados = Math.round(impostosEstimados * 100) / 100;

    // ─── ENTRADAS POR FORMA DE PAGAMENTO ──────────────────
    const fts = await prisma.financialTransaction.findMany({
      where: {
        storeId,
        tipo: 'ENTRADA',
        status: 'ATIVA',
        dataTransacao: { gte: firstDay, lte: lastDay },
      },
      select: { formaPagamento: true, valor: true, saleId: true },
    });
    const saleIds = [...new Set(fts.filter(f => f.saleId).map(f => f.saleId!))];
    const salesMap = saleIds.length > 0 ? new Map(
      (await prisma.sale.findMany({
        where: { id: { in: saleIds } },
        select: { id: true, formaPagamento: true, numeroParcelas: true }
      })).map(s => [s.id, s])
    ) : new Map();
    const pmBreakdown: Record<string, number> = {};
    for (const ft of fts) {
      let pm = ft.formaPagamento;
      if (!pm && ft.saleId) {
        const sale = salesMap.get(ft.saleId);
        pm = sale?.formaPagamento;
      }
      if (!pm) pm = 'OUTROS';
      if (pm === 'CARTAO_CREDITO') {
        const sale = ft.saleId ? salesMap.get(ft.saleId) : null;
        const parcelas = Number(sale?.numeroParcelas) || 1;
        const key = parcelas === 1 ? 'CARTAO_CREDITO_AVISTA' : 'CARTAO_CREDITO_PARCELADO';
        pmBreakdown[key] = (pmBreakdown[key] || 0) + Number(ft.valor);
      } else {
        pmBreakdown[pm] = (pmBreakdown[pm] || 0) + Number(ft.valor);
      }
    }
    const paymentMethodsBreakdown = [
      { method: 'PIX', label: 'Pix', value: pmBreakdown['PIX'] || 0 },
      { method: 'DINHEIRO', label: 'Dinheiro', value: pmBreakdown['DINHEIRO'] || 0 },
      { method: 'CARTAO_DEBITO', label: 'Cartão de Débito', value: pmBreakdown['CARTAO_DEBITO'] || 0 },
      { method: 'CARTAO_CREDITO_AVISTA', label: 'Crédito à Vista (1x)', value: pmBreakdown['CARTAO_CREDITO_AVISTA'] || 0 },
      { method: 'CARTAO_CREDITO_PARCELADO', label: 'Crédito Parcelado', value: pmBreakdown['CARTAO_CREDITO_PARCELADO'] || 0 },
      { method: 'CREDIARIO', label: 'Sinal de Crediário', value: pmBreakdown['CREDIARIO'] || 0 },
      ...(pmBreakdown['OUTROS'] ? [{ method: 'OUTROS' as const, label: 'Outros', value: pmBreakdown['OUTROS'] }] : []),
    ];

    // ─── CRESCIMENTO ──────────────────────────────────────
    const faturamentoCrescimento = prevFatLiq === 0 ? 100 : ((faturamentoLiquido - prevFatLiq) / prevFatLiq) * 100;
    const lucroCrescimento = prevLucroOperacao === 0 ? 100 : ((lucroOperacao - prevLucroOperacao) / Math.abs(prevLucroOperacao)) * 100;

    return res.json({
      metrics: {
        // Bloco 1: Fluxo Financeiro (Caixa)
        fluxoFinanceiro: {
          saldoAcumulado,
          entradasDoMes: dinheiroCaixaRealizado,
          saidasDoMes: saidasTotaisMes,
          saldoDisponivel,
        },
        // Bloco 2: Resultado da Operação (Competência)
        resultadoOperacao: {
          faturamentoLiquido,
          cmvMes,
          despesasOperacionais,
          impostosEstimados: Math.round(impostosEstimados * 100) / 100,
          lucroOperacao,
          margemOperacional: faturamentoLiquido > 0 ? ((lucroOperacao / faturamentoLiquido) * 100) : 0,
        },
        // Métricas compartilhadas
        volumeVendasMes,
        aReceberFiado,
        dinheiroImobilizado,
        aliquotaImposto,
        paymentMethodsBreakdown,
        faturamentoBruto,
        faturamentoCrescimento,
        lucroCrescimento,
        faturamentoMesPassado: prevFatLiq,
      }
    });
  }, "gerar Dashboard PJ");

  static getConsolidated = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id as string;
    if (!userId) return res.status(401).json({ message: 'Usuário não identificado' });

    const allowedStoreIds = (req.user?.allowedStoreIds || []) as string[];
    if (!allowedStoreIds.length) return res.status(403).json({ message: 'Nenhuma loja associada' });

    const queryStart = req.query.startDate as string;
    const queryEnd = req.query.endDate as string;
    const { firstDay, lastDay } = buildDateRange(queryStart, queryEnd);
    const { prevFirstDay, prevLastDay } = calcPrevBounds(firstDay, lastDay);

    const stores = await prisma.store.findMany({
      where: { id: { in: allowedStoreIds } },
      select: { id: true, nomeFantasia: true }
    });

    const storeMap = new Map(stores.map(s => [s.id, s.nomeFantasia]));

    const storesAliquota = await prisma.store.findMany({
      where: { id: { in: allowedStoreIds } },
      select: { id: true, aliquotaImposto: true }
    });
    const aliquotaMap = new Map(storesAliquota.map(s => [s.id, Number(s.aliquotaImposto || 0)]));

    const storeMetrics = await Promise.all(allowedStoreIds.map(async (sid: string) => {
      const [salesAgg, receitasAgg, despesasAgg, saidasTotaisAgg, products, aReceberAgg, prevSalesAgg, prevReceitasAgg, prevDespesasAgg, prevSaidasTotaisAgg, prevPetOrdersAgg, walletsResult, petOrdersAgg, apRecords] = await Promise.all([
        prisma.sale.aggregate({
          where: { storeId: sid, status: { not: 'CANCELADA' }, dataVenda: { gte: firstDay, lte: lastDay } },
          _sum: { cmvTotal: true, valorTotalLiquido: true, valorTotalBruto: true, valorDesconto: true, valorTaxasGateway: true }
        }),
        prisma.financialTransaction.aggregate({
          where: { storeId: sid, tipo: 'ENTRADA', status: 'ATIVA', dataTransacao: { gte: firstDay, lte: lastDay } },
          _sum: { valor: true }
        }),
        // Bloco 2: Despesas Operacionais (exclui custo de estoque)
        prisma.financialTransaction.aggregate({
          where: { storeId: sid, tipo: 'SAIDA', status: 'ATIVA', dataTransacao: { gte: firstDay, lte: lastDay }, categoria: { notIn: ['PRO_LABORE', 'DEVOLUCAO', 'RETIRADA_LUCRO', 'CANCELAMENTO', 'PAGAMENTO_FORNECEDOR', 'COMPRA_ESTOQUE'] } },
          _sum: { valor: true }
        }),
        // Bloco 1: Saídas totais
        prisma.financialTransaction.aggregate({
          where: { storeId: sid, tipo: 'SAIDA', status: 'ATIVA', dataTransacao: { gte: firstDay, lte: lastDay }, categoria: { notIn: ['DEVOLUCAO', 'CANCELAMENTO'] } },
          _sum: { valor: true }
        }),
        prisma.product.findMany({
          where: { storeId: sid, status: 'ATIVO' },
          select: { precoCusto: true, qtdEstoqueAtual: true, estoqueMinimo: true }
        }),
        // A Receber (Fiado/Prazo) — todos pendentes, independente do vencimento
        prisma.accountReceivable.findMany({
          where: { storeId: sid, status: { not: 'CANCELADA' } },
          select: {
            valorParcela: true,
            dataVencimento: true,
            payments: {
              where: { tipo: 'ENTRADA', status: 'ATIVA' },
              select: { valor: true }
            }
          }
        }),
        prisma.sale.aggregate({
          where: { storeId: sid, status: { not: 'CANCELADA' }, dataVenda: { gte: prevFirstDay, lte: prevLastDay } },
          _sum: { cmvTotal: true, valorTotalLiquido: true, valorTotalBruto: true, valorDesconto: true, valorTaxasGateway: true }
        }),
        prisma.financialTransaction.aggregate({
          where: { storeId: sid, tipo: 'ENTRADA', status: 'ATIVA', dataTransacao: { gte: prevFirstDay, lte: prevLastDay } },
          _sum: { valor: true }
        }),
        prisma.financialTransaction.aggregate({
          where: { storeId: sid, tipo: 'SAIDA', status: 'ATIVA', dataTransacao: { gte: prevFirstDay, lte: prevLastDay }, categoria: { notIn: ['PRO_LABORE', 'DEVOLUCAO', 'RETIRADA_LUCRO', 'CANCELAMENTO', 'PAGAMENTO_FORNECEDOR', 'COMPRA_ESTOQUE'] } },
          _sum: { valor: true }
        }),
        // Saídas totais do período anterior (para delta no card)
        prisma.financialTransaction.aggregate({
          where: { storeId: sid, tipo: 'SAIDA', status: 'ATIVA', dataTransacao: { gte: prevFirstDay, lte: prevLastDay }, categoria: { notIn: ['DEVOLUCAO', 'CANCELAMENTO'] } },
          _sum: { valor: true }
        }),
        prisma.petServiceOrder.aggregate({
          where: { storeId: sid, status: 'CONCLUIDO', dataConclusao: { gte: prevFirstDay, lte: prevLastDay } },
          _sum: { valorFinal: true }
        }),
        prisma.wallet.findMany({
          where: { storeId: sid },
          select: { saldoAtual: true }
        }),
        prisma.petServiceOrder.aggregate({
          where: { storeId: sid, status: 'CONCLUIDO', dataConclusao: { gte: firstDay, lte: lastDay } },
          _sum: { valorFinal: true }
        }),
        // Contas a pagar pendentes (vencidas, a vencer em 7 dias e total)
        prisma.accountPayable.findMany({
          where: { storeId: sid, status: 'PENDENTE' },
          select: { dataVencimento: true, valor: true }
        }),
      ]);

      const petRevenue = Number((petOrdersAgg as any)?._sum?.valorFinal || 0);
      const volume = Number(salesAgg._sum.valorTotalLiquido || 0) + petRevenue;
      const cmv = Number(salesAgg._sum.cmvTotal || 0);
      const fatBruto = Number(salesAgg._sum.valorTotalBruto || 0) + petRevenue;
      const desc = Number(salesAgg._sum.valorDesconto || 0);
      const taxas = Number(salesAgg._sum.valorTaxasGateway || 0);
      const fatLiquido = fatBruto - desc - taxas;
      const receita = Number(receitasAgg._sum.valor || 0);
      const despesaOperacional = Number(despesasAgg._sum.valor || 0);
      const saidasTotais = Number(saidasTotaisAgg._sum.valor || 0);
      const estoqueValor = Array.isArray(products)
        ? products.reduce((acc, p) => acc + (Number(p.precoCusto) * Number(p.qtdEstoqueAtual)), 0)
        : 0;
      const estoqueBaixoCount = Array.isArray(products)
        ? products.filter((p: any) => Number(p.qtdEstoqueAtual) < Number(p.estoqueMinimo || 0)).length
        : 0;
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const hoje7d = new Date(hoje.getTime() + 7 * 86400000);
      let aReceber = 0;
      let fiadoVencido = 0;
      for (const r of (aReceberAgg as Array<{ valorParcela: any; dataVencimento: any; payments: Array<{ valor: any }> }>)) {
        const totalPago = r.payments.reduce((s: number, p: { valor: any }) => s + Number(p.valor), 0);
        const saldo = Number(r.valorParcela) - totalPago;
        if (saldo <= 0) continue;
        aReceber += saldo;
        if (r.dataVencimento && new Date(r.dataVencimento).setHours(0, 0, 0, 0) < hoje.getTime()) {
          fiadoVencido += saldo;
        }
      }
      let apPendentes = 0;
      let apVencido = 0;
      let apVencendo7d = 0;
      for (const ap of (apRecords as Array<{ dataVencimento: any; valor: any }>)) {
        const v = Number(ap.valor);
        apPendentes += v;
        const venc = ap.dataVencimento ? new Date(ap.dataVencimento).setHours(0, 0, 0, 0) : null;
        if (venc === null) continue;
        if (venc < hoje.getTime()) apVencido += v;
        else if (venc <= hoje7d.getTime()) apVencendo7d += v;
      }

      const saldoAcumulado = (walletsResult as Array<{ saldoAtual: any }>).reduce((acc, w) => acc + Number(w.saldoAtual), 0);

      // Período anterior
      const prevPetRevenue = Number((prevPetOrdersAgg as any)?._sum?.valorFinal || 0);
      const prevVolume = Number(prevSalesAgg._sum.valorTotalLiquido || 0) + prevPetRevenue;
      const prevFatBruto = Number(prevSalesAgg._sum.valorTotalBruto || 0) + prevPetRevenue;
      const prevDescontos = Number(prevSalesAgg._sum.valorDesconto || 0);
      const prevTaxas = Number(prevSalesAgg._sum.valorTaxasGateway || 0);
      const prevFatLiquido = prevFatBruto - prevDescontos - prevTaxas;
      const prevCmv = Number(prevSalesAgg._sum.cmvTotal || 0);
      const prevDespesa = Number(prevDespesasAgg._sum.valor || 0);
      const prevEntradas = Number(prevReceitasAgg._sum.valor || 0);
      const prevSaidas = Number(prevSaidasTotaisAgg._sum.valor || 0);

      const aliquota = aliquotaMap.get(sid) || 0;
      const taxSales = await prisma.sale.findMany({
        where: { storeId: sid, status: { not: 'CANCELADA' }, dataVenda: { gte: firstDay, lte: lastDay } },
        select: {
          saleItems: {
            select: {
              precoUnitarioVendido: true,
              quantidade: true,
              product: {
                select: {
                  impostoEstimadoPercentual: true,
                  category: { select: { aliquotaImposto: true } }
                }
              }
            }
          }
        }
      });
      let impostos = 0;
      for (const taxSale of taxSales) {
        for (const item of taxSale.saleItems) {
          const itemValor = Number(item.precoUnitarioVendido) * Number(item.quantidade);
          const prodRate = Number(item.product?.impostoEstimadoPercentual || 0);
          const catRate = Number(item.product?.category?.aliquotaImposto || 0);
          const effectiveRate = prodRate > 0 ? prodRate : (catRate > 0 ? catRate : aliquota);
          if (effectiveRate > 0) {
            impostos += itemValor * effectiveRate / 100;
          }
        }
      }
      impostos = Math.round(impostos * 100) / 100;

      // Payment methods breakdown per store
      const fts = await prisma.financialTransaction.findMany({
        where: { storeId: sid, tipo: 'ENTRADA', status: 'ATIVA', dataTransacao: { gte: firstDay, lte: lastDay } },
        select: { formaPagamento: true, valor: true, saleId: true },
      });
      const saleIds = [...new Set(fts.filter(f => f.saleId).map(f => f.saleId!))];
      const salesMap = saleIds.length > 0 ? new Map(
        (await prisma.sale.findMany({
          where: { id: { in: saleIds } },
          select: { id: true, formaPagamento: true, numeroParcelas: true }
        })).map(s => [s.id, s])
      ) : new Map();
      const pmAcc: Record<string, number> = {};
      for (const ft of fts) {
        let pm = ft.formaPagamento;
        if (!pm && ft.saleId) {
          const sale = salesMap.get(ft.saleId);
          pm = sale?.formaPagamento;
        }
        if (!pm) pm = 'OUTROS';
        if (pm === 'CARTAO_CREDITO') {
          const sale = ft.saleId ? salesMap.get(ft.saleId) : null;
          const parcelas = Number(sale?.numeroParcelas) || 1;
          const key = parcelas === 1 ? 'CARTAO_CREDITO_AVISTA' : 'CARTAO_CREDITO_PARCELADO';
          pmAcc[key] = (pmAcc[key] || 0) + Number(ft.valor);
        } else {
          pmAcc[pm] = (pmAcc[pm] || 0) + Number(ft.valor);
        }
      }
      const storePaymentBreakdown = [
        { method: 'PIX', label: 'Pix', value: pmAcc['PIX'] || 0 },
        { method: 'DINHEIRO', label: 'Dinheiro', value: pmAcc['DINHEIRO'] || 0 },
        { method: 'CARTAO_DEBITO', label: 'Cartão de Débito', value: pmAcc['CARTAO_DEBITO'] || 0 },
        { method: 'CARTAO_CREDITO_AVISTA', label: 'Crédito à Vista (1x)', value: pmAcc['CARTAO_CREDITO_AVISTA'] || 0 },
        { method: 'CARTAO_CREDITO_PARCELADO', label: 'Crédito Parcelado', value: pmAcc['CARTAO_CREDITO_PARCELADO'] || 0 },
        { method: 'CREDIARIO', label: 'Sinal de Crediário', value: pmAcc['CREDIARIO'] || 0 },
        ...(pmAcc['OUTROS'] ? [{ method: 'OUTROS' as const, label: 'Outros', value: pmAcc['OUTROS'] }] : []),
      ];

      return {
        storeId: sid,
        storeName: storeMap.get(sid) || 'Loja',
        fluxoFinanceiro: {
          saldoAcumulado,
          entradasDoMes: receita,
          saidasDoMes: saidasTotais,
          saldoDisponivel: saldoAcumulado + receita - saidasTotais,
        },
        resultadoOperacao: {
          faturamentoLiquido: fatLiquido,
          cmv,
          despesasOperacionais: despesaOperacional,
          impostosEstimados: Math.round(impostos * 100) / 100,
          lucroOperacao: fatLiquido - cmv - despesaOperacional,
          margemOperacional: fatLiquido > 0 ? ((fatLiquido - cmv - despesaOperacional) / fatLiquido) * 100 : 0,
        },
        volumeVendas: volume,
        faturamentoBruto: fatBruto,
        estoqueImobilizado: estoqueValor,
        estoqueBaixoCount,
        aReceberFiado: aReceber,
        fiadoVencido,
        apPendentes,
        apVencido,
        apVencendo7d,
        paymentMethodsBreakdown: storePaymentBreakdown,
        prevVolume,
        prevCmv,
        prevFatLiquido,
        prevDespesa,
        prevEntradas,
        prevSaidas,
        receita,
      };
    }));

    const total = storeMetrics.reduce((acc, s) => ({
      saldoAcumulado: acc.saldoAcumulado + s.fluxoFinanceiro.saldoAcumulado,
      volumeVendas: acc.volumeVendas + s.volumeVendas,
      faturamentoBruto: acc.faturamentoBruto + (s.faturamentoBruto || 0),
      cmv: acc.cmv + s.resultadoOperacao.cmv,
      faturamentoLiquido: acc.faturamentoLiquido + s.resultadoOperacao.faturamentoLiquido,
      impostosEstimados: acc.impostosEstimados + s.resultadoOperacao.impostosEstimados,
      despesaOperacional: acc.despesaOperacional + s.resultadoOperacao.despesasOperacionais,
      lucroOperacao: acc.lucroOperacao + s.resultadoOperacao.lucroOperacao,
      estoqueImobilizado: acc.estoqueImobilizado + s.estoqueImobilizado,
      estoqueBaixoCount: acc.estoqueBaixoCount + s.estoqueBaixoCount,
      aReceberFiado: acc.aReceberFiado + s.aReceberFiado,
      fiadoVencido: acc.fiadoVencido + s.fiadoVencido,
      apPendentes: acc.apPendentes + s.apPendentes,
      apVencido: acc.apVencido + s.apVencido,
      apVencendo7d: acc.apVencendo7d + s.apVencendo7d,
      prevVolume: acc.prevVolume + s.prevVolume,
      prevFatLiquido: acc.prevFatLiquido + s.prevFatLiquido,
      prevDespesa: acc.prevDespesa + s.prevDespesa,
      prevCmv: acc.prevCmv + s.prevCmv,
      prevEntradas: acc.prevEntradas + s.prevEntradas,
      prevSaidas: acc.prevSaidas + s.prevSaidas,
      entradasDoMes: acc.entradasDoMes + s.fluxoFinanceiro.entradasDoMes,
      saidasDoMes: acc.saidasDoMes + s.fluxoFinanceiro.saidasDoMes,
    }), {
      saldoAcumulado: 0, volumeVendas: 0, faturamentoBruto: 0, cmv: 0,
      faturamentoLiquido: 0, impostosEstimados: 0,
      despesaOperacional: 0, lucroOperacao: 0,
      estoqueImobilizado: 0, estoqueBaixoCount: 0, aReceberFiado: 0,
      fiadoVencido: 0, apPendentes: 0, apVencido: 0, apVencendo7d: 0,
      prevVolume: 0, prevFatLiquido: 0, prevDespesa: 0, prevCmv: 0,
      prevEntradas: 0, prevSaidas: 0,
      entradasDoMes: 0, saidasDoMes: 0,
    });

    // ─── SÉRIE DIÁRIA DE FATURAMENTO (por loja, para filtro no frontend) ──
    const [salesByDay, petByDay, prevSalesByDay, prevPetByDay] = await Promise.all([
      prisma.sale.groupBy({
        by: ['storeId', 'dataVenda'],
        where: { storeId: { in: allowedStoreIds }, status: { not: 'CANCELADA' }, dataVenda: { gte: firstDay, lte: lastDay } },
        _sum: { valorTotalBruto: true, valorDesconto: true, valorTaxasGateway: true }
      }),
      prisma.petServiceOrder.groupBy({
        by: ['storeId', 'dataConclusao'],
        where: { storeId: { in: allowedStoreIds }, status: 'CONCLUIDO', dataConclusao: { gte: firstDay, lte: lastDay } },
        _sum: { valorFinal: true }
      }),
      prisma.sale.groupBy({
        by: ['storeId', 'dataVenda'],
        where: { storeId: { in: allowedStoreIds }, status: { not: 'CANCELADA' }, dataVenda: { gte: prevFirstDay, lte: prevLastDay } },
        _sum: { valorTotalBruto: true, valorDesconto: true, valorTaxasGateway: true }
      }),
      prisma.petServiceOrder.groupBy({
        by: ['storeId', 'dataConclusao'],
        where: { storeId: { in: allowedStoreIds }, status: 'CONCLUIDO', dataConclusao: { gte: prevFirstDay, lte: prevLastDay } },
        _sum: { valorFinal: true }
      }),
    ]);
    const localKey = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const days: Date[] = [];
    const prevDays: Date[] = [];
    for (let d = new Date(firstDay); d <= lastDay; d = new Date(d.getTime() + 86400000)) days.push(new Date(d));
    for (let d = new Date(prevFirstDay); d <= prevLastDay; d = new Date(d.getTime() + 86400000)) prevDays.push(new Date(d));
    const curMap = new Map<string, number>();
    const prevMap = new Map<string, number>();
    for (const s of salesByDay) {
      if (!s.dataVenda) continue;
      const key = `${s.storeId}|${localKey(s.dataVenda)}`;
      curMap.set(key, (curMap.get(key) || 0) + Number(s._sum.valorTotalBruto || 0) - Number(s._sum.valorDesconto || 0) - Number(s._sum.valorTaxasGateway || 0));
    }
    for (const p of petByDay) {
      if (!p.dataConclusao) continue;
      const key = `${p.storeId}|${localKey(p.dataConclusao)}`;
      curMap.set(key, (curMap.get(key) || 0) + Number(p._sum.valorFinal || 0));
    }
    for (const s of prevSalesByDay) {
      if (!s.dataVenda) continue;
      const key = `${s.storeId}|${localKey(s.dataVenda)}`;
      prevMap.set(key, (prevMap.get(key) || 0) + Number(s._sum.valorTotalBruto || 0) - Number(s._sum.valorDesconto || 0) - Number(s._sum.valorTaxasGateway || 0));
    }
    for (const p of prevPetByDay) {
      if (!p.dataConclusao) continue;
      const key = `${p.storeId}|${localKey(p.dataConclusao)}`;
      prevMap.set(key, (prevMap.get(key) || 0) + Number(p._sum.valorFinal || 0));
    }
    const faturamentoPorDia: Array<{ storeId: string; data: string; atual: number; anterior: number }> = [];
    for (let i = 0; i < days.length; i++) {
      const curKey = localKey(days[i]);
      const prevKey = prevDays[i] ? localKey(prevDays[i]) : '';
      for (const storeId of allowedStoreIds) {
        faturamentoPorDia.push({
          storeId,
          data: curKey,
          atual: Math.round((curMap.get(`${storeId}|${curKey}`) || 0) * 100) / 100,
          anterior: Math.round((prevMap.get(`${storeId}|${prevKey}`) || 0) * 100) / 100,
        });
      }
    }

    const prevTotalLucroOperacao = storeMetrics.reduce((acc, s) => acc + (s.prevFatLiquido - s.resultadoOperacao.cmv - s.prevDespesa), 0);
    const faturamentoCrescimento = total.prevFatLiquido === 0 ? 100 : ((total.faturamentoLiquido - total.prevFatLiquido) / total.prevFatLiquido) * 100;
    const lucroCrescimento = prevTotalLucroOperacao === 0 ? 100 : ((total.lucroOperacao - prevTotalLucroOperacao) / Math.abs(prevTotalLucroOperacao)) * 100;

    return res.json({
      totalStores: stores.length,
      stores: storeMetrics,
      faturamentoPorDia,
      consolidated: {
        volumeVendas: total.volumeVendas,
        receita: total.entradasDoMes,
        lucroBruto: total.faturamentoLiquido - total.cmv,
        estoqueImobilizado: total.estoqueImobilizado,
        aReceberFiado: total.aReceberFiado,
        fluxoFinanceiro: {
          saldoAcumulado: total.saldoAcumulado,
          entradasDoMes: total.entradasDoMes,
          saidasDoMes: total.saidasDoMes,
          saldoDisponivel: total.saldoAcumulado + total.entradasDoMes - total.saidasDoMes,
        },
        resultadoOperacao: {
          faturamentoLiquido: total.faturamentoLiquido,
          cmv: total.cmv,
          despesasOperacionais: total.despesaOperacional,
          impostosEstimados: total.impostosEstimados,
          lucroOperacao: total.lucroOperacao,
          margemOperacional: total.faturamentoLiquido > 0 ? (total.lucroOperacao / total.faturamentoLiquido) * 100 : 0,
        },
        faturamentoCrescimento: Math.round(faturamentoCrescimento * 100) / 100,
        lucroCrescimento: Math.round(lucroCrescimento * 100) / 100,
        faturamentoMesPassado: total.prevFatLiquido,
        prevCmv: Math.round(total.prevCmv * 100) / 100,
        prevEntradas: Math.round(total.prevEntradas * 100) / 100,
        prevSaidas: Math.round(total.prevSaidas * 100) / 100,
        estoqueBaixoCount: total.estoqueBaixoCount,
        fiadoVencido: Math.round(total.fiadoVencido * 100) / 100,
        apPendentes: Math.round(total.apPendentes * 100) / 100,
        apVencido: Math.round(total.apVencido * 100) / 100,
        apVencendo7d: Math.round(total.apVencendo7d * 100) / 100,
      }
    });
  }, "carregar Dashboard Consolidado PJ");

  // Performance por vendedor no período: vendas, faturamento, ticket e comissões
  static getSellerPerformance = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);

    const queryStart = req.query.startDate as string;
    const queryEnd = req.query.endDate as string;
    const { firstDay, lastDay } = buildDateRange(queryStart, queryEnd);

    const sales = await prisma.sale.findMany({
      where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: firstDay, lte: lastDay } },
      select: {
        userId: true,
        valorTotalLiquido: true,
        saleItems: {
          where: { commissionPaidAt: null, comissaoVendedorValor: { gt: 0 } },
          select: { comissaoVendedorValor: true }
        }
      }
    });

    const salesMap = new Map<string, { count: number; total: number }>();
    const pendingMap = new Map<string, number>();
    for (const sale of sales) {
      const uid = sale.userId;
      if (!uid) continue;
      const cur = salesMap.get(uid) || { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(sale.valorTotalLiquido);
      salesMap.set(uid, cur);
      const pend = sale.saleItems.reduce((a, i) => a + Number(i.comissaoVendedorValor), 0);
      if (pend > 0) pendingMap.set(uid, (pendingMap.get(uid) || 0) + pend);
    }

    const startOfMonth = startOfDay(new Date());
    const paid = await prisma.commissionPayment.groupBy({
      by: ['userId'],
      where: { storeId, pagoEm: { gte: startOfMonth } },
      _sum: { totalValor: true }
    });

    const userIds = [...new Set([...salesMap.keys(), ...pendingMap.keys(), ...paid.map(p => p.userId)])];
    const users = userIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, nome: true } })
      : [];
    const userMap = new Map(users.map(u => [u.id, u.nome]));

    const sellers = userIds.map(uid => {
      const s = salesMap.get(uid) || { count: 0, total: 0 };
      return {
        userId: uid,
        nome: userMap.get(uid) || 'Desconhecido',
        totalVendas: s.count,
        valorVendido: Math.round(s.total * 100) / 100,
        ticketMedio: s.count ? Math.round((s.total / s.count) * 100) / 100 : 0,
        comissaoPendente: Math.round((pendingMap.get(uid) || 0) * 100) / 100,
        comissaoPagaMes: Math.round(Number(paid.find(p => p.userId === uid)?._sum?.totalValor || 0) * 100) / 100,
      };
    }).sort((a, b) => b.valorVendido - a.valorVendido);

    res.json({ sellers });
  }, "listar ranking de vendedores");
}
