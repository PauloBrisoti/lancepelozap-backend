import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { startOfMonth, endOfMonth, subDays, differenceInDays, startOfDay, endOfDay } from 'date-fns';

type Decimal = { toString: () => string };

export class DashboardPJController {
  static async getDashboardMetrics(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Tenant ID não encontrado" });

      const queryStart = req.query.startDate as string;
      const queryEnd = req.query.endDate as string;
      const hoje = new Date();
      let firstDay: Date;
      let lastDay: Date;

      if (queryStart && queryEnd) {
        firstDay = new Date(`${queryStart}T00:00:00.000Z`);
        const d = new Date(String(queryEnd));
        d.setDate(d.getDate() + 1);
        lastDay = new Date(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T23:59:59.999Z`);
      } else {
        firstDay = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1, 0, 0, 0, 0));
        const d = new Date(hoje);
        d.setDate(d.getDate() + 1);
        lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
      }

      const daysDiff = differenceInDays(lastDay, firstDay) || 1;
      const prevFirstDay = subDays(firstDay, daysDiff);
      const prevLastDay = subDays(lastDay, daysDiff);

      // 1. DINHEIRO IMOBILIZADO NO ESTOQUE
      const products = await prisma.product.findMany({
        where: { storeId, status: 'ATIVO' },
        select: { precoCusto: true, qtdEstoqueAtual: true }
      });
      const dinheiroImobilizado = products.reduce((acc, p) => acc + (Number(p.precoCusto) * Number(p.qtdEstoqueAtual)), 0);

      // 2. FATURAMENTO (REGIME DE COMPETÊNCIA) — todas as vendas do período
      const salesAggregate = await prisma.sale.aggregate({
        where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: firstDay, lte: lastDay } },
        _sum: { cmvTotal: true, valorTotalLiquido: true, valorTotalBruto: true, valorDesconto: true, valorTaxasGateway: true }
      });
      const cmvMes = Number(salesAggregate._sum.cmvTotal || 0);
      const volumeVendasMes = Number(salesAggregate._sum.valorTotalLiquido || 0);

      const faturamentoBruto = Number(salesAggregate._sum.valorTotalBruto || 0);
      const totalDescontos = Number(salesAggregate._sum.valorDesconto || 0);
      const totalTaxasGateway = Number(salesAggregate._sum.valorTaxasGateway || 0);
      const faturamentoLiquido = faturamentoBruto - totalDescontos - totalTaxasGateway;

      const receivablesForKpi = await prisma.accountReceivable.findMany({
        where: { storeId, status: { not: 'CANCELADA' } },
        select: {
          valorParcela: true,
          payments: {
            where: { tipo: 'ENTRADA', status: 'ATIVA' },
            select: { valor: true }
          }
        }
      });
      const aReceberFiado = receivablesForKpi.reduce((acc, r) => {
        const totalPago = r.payments.reduce((s, p) => s + Number(p.valor), 0);
        return acc + (Number(r.valorParcela) - totalPago);
      }, 0);

      // Dinheiro no Caixa (Realizado) — regime de caixa: entradas financeiras
      const receitasCaixa = await prisma.financialTransaction.aggregate({
        where: { storeId, tipo: 'ENTRADA', status: 'ATIVA', dataTransacao: { gte: firstDay, lte: lastDay } },
        _sum: { valor: true }
      });
      const dinheiroCaixaRealizado = Number(receitasCaixa._sum.valor || 0);

      const lucroBruto = faturamentoLiquido - cmvMes;

      const despesasAggregate = await prisma.financialTransaction.aggregate({
        where: { storeId, tipo: 'SAIDA', dataTransacao: { gte: firstDay, lte: lastDay }, categoria: { notIn: ['PRO_LABORE', 'DEVOLUCAO', 'RETIRADA_LUCRO'] } },
        _sum: { valor: true }
      });
      const despesasOperacionais = Number(despesasAggregate._sum.valor || 0);
      const lucroLiquidoReal = lucroBruto - despesasOperacionais;

      const prevSalesAggregate = await prisma.sale.aggregate({
        where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: prevFirstDay, lte: prevLastDay } },
        _sum: { cmvTotal: true, valorTotalLiquido: true, valorTotalBruto: true, valorDesconto: true, valorTaxasGateway: true }
      });
      const prevCmv = Number(prevSalesAggregate._sum.cmvTotal || 0);
      const prevVolume = Number(prevSalesAggregate._sum.valorTotalLiquido || 0);

      const prevFatBruto = Number(prevSalesAggregate._sum.valorTotalBruto || 0);
      const prevDescontos = Number(prevSalesAggregate._sum.valorDesconto || 0);
      const prevTaxas = Number(prevSalesAggregate._sum.valorTaxasGateway || 0);
      const prevFatLiq = prevFatBruto - prevDescontos - prevTaxas;
      const prevLucroBruto = prevFatLiq - prevCmv;
      
      const prevDespesasAggr = await prisma.financialTransaction.aggregate({
        where: { storeId, tipo: 'SAIDA', dataTransacao: { gte: prevFirstDay, lte: prevLastDay }, categoria: { notIn: ['PRO_LABORE', 'DEVOLUCAO', 'RETIRADA_LUCRO'] } },
        _sum: { valor: true }
      });
      const prevDespesas = Number(prevDespesasAggr._sum.valor || 0);
      const prevLucroLiquido = prevLucroBruto - prevDespesas;

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

      // 8. ENTRADAS POR FORMA DE PAGAMENTO (drill-down das entradas realizadas)
      const salesForPaymentMethod = await prisma.sale.findMany({
        where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: firstDay, lte: lastDay } },
        select: { formaPagamento: true, valorTotalLiquido: true, numeroParcelas: true, valorSinal: true }
      });
      const pmBreakdown: Record<string, number> = {};
      for (const s of salesForPaymentMethod) {
        const pm = s.formaPagamento;
        if (pm === 'CREDIARIO') {
          const key = 'CREDIARIO';
          pmBreakdown[key] = (pmBreakdown[key] || 0) + Number(s.valorSinal);
        } else if (pm === 'CARTAO_CREDITO') {
          const key = Number(s.numeroParcelas) === 1 ? 'CARTAO_CREDITO_AVISTA' : 'CARTAO_CREDITO_PARCELADO';
          pmBreakdown[key] = (pmBreakdown[key] || 0) + Number(s.valorTotalLiquido);
        } else {
          pmBreakdown[pm] = (pmBreakdown[pm] || 0) + Number(s.valorTotalLiquido);
        }
      }
      const paymentMethodsBreakdown = [
        { method: 'PIX', label: 'Pix', value: pmBreakdown['PIX'] || 0 },
        { method: 'DINHEIRO', label: 'Dinheiro', value: pmBreakdown['DINHEIRO'] || 0 },
        { method: 'CARTAO_DEBITO', label: 'Cartão de Débito', value: pmBreakdown['CARTAO_DEBITO'] || 0 },
        { method: 'CARTAO_CREDITO_AVISTA', label: 'Crédito à Vista (1x)', value: pmBreakdown['CARTAO_CREDITO_AVISTA'] || 0 },
        { method: 'CARTAO_CREDITO_PARCELADO', label: 'Crédito Parcelado', value: pmBreakdown['CARTAO_CREDITO_PARCELADO'] || 0 },
        { method: 'CREDIARIO', label: 'Sinal de Crediário', value: pmBreakdown['CREDIARIO'] || 0 },
      ];

      const faturamentoCrescimento = prevFatLiq === 0 ? 100 : ((faturamentoLiquido - prevFatLiq) / prevFatLiq) * 100;
      const lucroCrescimento = prevLucroLiquido === 0 ? 100 : ((lucroLiquidoReal - prevLucroLiquido) / Math.abs(prevLucroLiquido)) * 100;

      return res.json({
        metrics: {
          volumeVendasMes,
          aReceberFiado,
          dinheiroImobilizado,
          dinheiroCaixaRealizado,
          faturamentoBruto,
          faturamentoLiquido,
          faturamentoCrescimento,
          cmvMes,
          impostosEstimados: Math.round(impostosEstimados * 100) / 100,
          aliquotaImposto,
          lucroBruto,
          despesasOperacionais,
          lucroLiquidoReal,
          lucroCrescimento,
          paymentMethodsBreakdown
        }
      });
    } catch (error) {
      console.error('Erro ao gerar Dashboard PJ:', error);
      return res.status(500).json({ message: 'Erro interno ao calcular métricas.' });
    }
  }

  static async getConsolidated(req: Request, res: Response) {
    try {
      const userId = req.user?.id as string;
      if (!userId) return res.status(401).json({ message: 'Usuário não identificado' });

      const allowedStoreIds = (req.user?.allowedStoreIds || []) as string[];
      if (!allowedStoreIds.length) return res.status(403).json({ message: 'Nenhuma loja associada' });

      const queryStart = req.query.startDate as string;
      const queryEnd = req.query.endDate as string;
      const hoje = new Date();
      let firstDay: Date;
      let lastDay: Date;

      if (queryStart && queryEnd) {
        firstDay = new Date(`${queryStart}T00:00:00.000Z`);
        const d = new Date(String(queryEnd));
        d.setDate(d.getDate() + 1);
        lastDay = new Date(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T23:59:59.999Z`);
      } else {
        firstDay = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1, 0, 0, 0, 0));
        const d = new Date(hoje);
        d.setDate(d.getDate() + 1);
        lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
      }

      const daysDiff = differenceInDays(lastDay, firstDay) || 1;
      const prevFirstDay = subDays(firstDay, daysDiff);
      const prevLastDay = subDays(lastDay, daysDiff);

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
        const [salesAgg, receitasAgg, despesasAgg, products, aReceberAgg, prevSalesAgg, prevReceitasAgg, prevDespesasAgg] = await Promise.all([
          prisma.sale.aggregate({
            where: { storeId: sid, status: { not: 'CANCELADA' }, dataVenda: { gte: firstDay, lte: lastDay } },
            _sum: { cmvTotal: true, valorTotalLiquido: true, valorTotalBruto: true, valorDesconto: true, valorTaxasGateway: true }
          }),
          prisma.financialTransaction.aggregate({
            where: { storeId: sid, tipo: 'ENTRADA', dataTransacao: { gte: firstDay, lte: lastDay } },
            _sum: { valor: true }
          }),
          prisma.financialTransaction.aggregate({
            where: { storeId: sid, tipo: 'SAIDA', dataTransacao: { gte: firstDay, lte: lastDay }, categoria: { notIn: ['PRO_LABORE', 'DEVOLUCAO', 'RETIRADA_LUCRO'] } },
            _sum: { valor: true }
          }),
          prisma.product.findMany({
            where: { storeId: sid, status: 'ATIVO' },
            select: { precoCusto: true, qtdEstoqueAtual: true }
          }),
          prisma.accountReceivable.findMany({
            where: { storeId: sid, status: 'PENDENTE' },
            select: {
              valorParcela: true,
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
            where: { storeId: sid, tipo: 'ENTRADA', dataTransacao: { gte: prevFirstDay, lte: prevLastDay } },
            _sum: { valor: true }
          }),
          prisma.financialTransaction.aggregate({
            where: { storeId: sid, tipo: 'SAIDA', dataTransacao: { gte: prevFirstDay, lte: prevLastDay }, categoria: { notIn: ['PRO_LABORE', 'DEVOLUCAO', 'RETIRADA_LUCRO'] } },
            _sum: { valor: true }
          }),
        ]);

        const volume = Number(salesAgg._sum.valorTotalLiquido || 0);
        const cmv = Number(salesAgg._sum.cmvTotal || 0);
        const fatBruto = Number(salesAgg._sum.valorTotalBruto || 0);
        const desc = Number(salesAgg._sum.valorDesconto || 0);
        const taxas = Number(salesAgg._sum.valorTaxasGateway || 0);
        const fatLiquido = fatBruto - desc - taxas;
        const receita = Number(receitasAgg._sum.valor || 0);
        const despesa = Number(despesasAgg._sum.valor || 0);
        const estoqueValor = Array.isArray(products)
          ? products.reduce((acc, p) => acc + (Number(p.precoCusto) * Number(p.qtdEstoqueAtual)), 0)
          : 0;
        const aReceber = (aReceberAgg as Array<{ valorParcela: any; payments: Array<{ valor: any }> }>).reduce((acc, r) => {
          const totalPago = r.payments.reduce((s: number, p: { valor: any }) => s + Number(p.valor), 0);
          return acc + (Number(r.valorParcela) - totalPago);
        }, 0);
        const prevVolume = Number(prevSalesAgg._sum.valorTotalLiquido || 0);
        const prevFatBruto = Number(prevSalesAgg._sum.valorTotalBruto || 0);
        const prevDescontos = Number(prevSalesAgg._sum.valorDesconto || 0);
        const prevTaxas = Number(prevSalesAgg._sum.valorTaxasGateway || 0);
        const prevFatLiquido = prevFatBruto - prevDescontos - prevTaxas;
        const prevCmv = Number(prevSalesAgg._sum.cmvTotal || 0);
        const prevReceita = Number(prevReceitasAgg._sum.valor || 0);
        const prevDespesa = Number(prevDespesasAgg._sum.valor || 0);
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
        const salesForPM = await prisma.sale.findMany({
          where: { storeId: sid, status: { not: 'CANCELADA' }, dataVenda: { gte: firstDay, lte: lastDay } },
          select: { formaPagamento: true, valorTotalLiquido: true, numeroParcelas: true, valorSinal: true }
        });
        const pmAcc: Record<string, number> = {};
        for (const s of salesForPM) {
          const pm = s.formaPagamento;
          if (pm === 'CREDIARIO') { pmAcc['CREDIARIO'] = (pmAcc['CREDIARIO'] || 0) + Number(s.valorSinal); }
          else if (pm === 'CARTAO_CREDITO') {
            const k = Number(s.numeroParcelas) === 1 ? 'CARTAO_CREDITO_AVISTA' : 'CARTAO_CREDITO_PARCELADO';
            pmAcc[k] = (pmAcc[k] || 0) + Number(s.valorTotalLiquido);
          } else { pmAcc[pm] = (pmAcc[pm] || 0) + Number(s.valorTotalLiquido); }
        }
        const storePaymentBreakdown = [
          { method: 'PIX', label: 'Pix', value: pmAcc['PIX'] || 0 },
          { method: 'DINHEIRO', label: 'Dinheiro', value: pmAcc['DINHEIRO'] || 0 },
          { method: 'CARTAO_DEBITO', label: 'Cartão de Débito', value: pmAcc['CARTAO_DEBITO'] || 0 },
          { method: 'CARTAO_CREDITO_AVISTA', label: 'Crédito à Vista (1x)', value: pmAcc['CARTAO_CREDITO_AVISTA'] || 0 },
          { method: 'CARTAO_CREDITO_PARCELADO', label: 'Crédito Parcelado', value: pmAcc['CARTAO_CREDITO_PARCELADO'] || 0 },
          { method: 'CREDIARIO', label: 'Sinal de Crediário', value: pmAcc['CREDIARIO'] || 0 },
        ];

        return {
          storeId: sid,
          storeName: storeMap.get(sid) || 'Loja',
          volumeVendas: volume,
          faturamentoBruto: fatBruto,
          cmv,
          receita,
          despesa,
          impostosEstimados: Math.round(impostos * 100) / 100,
          aliquotaImposto: aliquota,
          faturamentoLiquido: fatLiquido,
          lucroBruto: fatLiquido - cmv,
          lucroLiquido: fatLiquido - cmv - despesa,
          estoqueImobilizado: estoqueValor,
          aReceberFiado: aReceber,
          paymentMethodsBreakdown: storePaymentBreakdown,
          prevVolume,
          prevCmv,
          prevFatLiquido,
          prevReceita,
          prevDespesa,
        };
      }));

      const total = storeMetrics.reduce((acc, s) => ({
        volumeVendas: acc.volumeVendas + s.volumeVendas,
        faturamentoBruto: acc.faturamentoBruto + (s.faturamentoBruto || 0),
        cmv: acc.cmv + s.cmv,
        receita: acc.receita + s.receita,
        despesa: acc.despesa + s.despesa,
        faturamentoLiquido: acc.faturamentoLiquido + s.faturamentoLiquido,
        impostosEstimados: acc.impostosEstimados + s.impostosEstimados,
        lucroBruto: acc.lucroBruto + s.lucroBruto,
        lucroLiquido: acc.lucroLiquido + s.lucroLiquido,
        estoqueImobilizado: acc.estoqueImobilizado + s.estoqueImobilizado,
        aReceberFiado: acc.aReceberFiado + s.aReceberFiado,
        prevVolume: acc.prevVolume + s.prevVolume,
        prevFatLiquido: acc.prevFatLiquido + s.prevFatLiquido,
        prevReceita: acc.prevReceita + s.prevReceita,
        prevDespesa: acc.prevDespesa + s.prevDespesa,
      }), {
        volumeVendas: 0, faturamentoBruto: 0, cmv: 0, receita: 0, despesa: 0,
        faturamentoLiquido: 0, impostosEstimados: 0,
        lucroBruto: 0, lucroLiquido: 0, estoqueImobilizado: 0, aReceberFiado: 0,
        prevVolume: 0, prevFatLiquido: 0, prevReceita: 0, prevDespesa: 0,
      });

      const prevTotalLucroLiquido = storeMetrics.reduce((acc, s) => acc + (s.prevFatLiquido - (s.prevCmv || 0) - s.prevDespesa), 0);
      const faturamentoCrescimento = total.prevFatLiquido === 0 ? 100 : ((total.faturamentoLiquido - total.prevFatLiquido) / total.prevFatLiquido) * 100;
      const lucroCrescimento = prevTotalLucroLiquido === 0 ? 100 : ((total.lucroLiquido - prevTotalLucroLiquido) / Math.abs(prevTotalLucroLiquido)) * 100;

      return res.json({
        totalStores: stores.length,
        stores: storeMetrics,
        consolidated: {
          ...total,
          faturamentoCrescimento: Math.round(faturamentoCrescimento * 100) / 100,
          lucroCrescimento: Math.round(lucroCrescimento * 100) / 100,
          margemBruta: total.faturamentoLiquido > 0 ? (total.lucroBruto / total.faturamentoLiquido) * 100 : 0,
          margemLiquida: total.faturamentoLiquido > 0 ? (total.lucroLiquido / total.faturamentoLiquido) * 100 : 0,
        }
      });
    } catch (error) {
      console.error('Erro no Dashboard Consolidado PJ:', error);
      return res.status(500).json({ message: 'Erro interno ao consolidar dados.' });
    }
  }
}
