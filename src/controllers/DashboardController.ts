import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { subMonths, startOfMonth, endOfMonth, subDays, startOfDay, endOfDay, differenceInDays } from 'date-fns';

export class DashboardController {
  
  // Dashboard Lojista (Tenant)
  static async getTenantDashboard(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Não autorizado' });

      // Handle Dates
      const queryStart = req.query.startDate as string;
      const queryEnd = req.query.endDate as string;
      
      const hoje = new Date();
      let startDate: Date;
      let endDate: Date;
      
      if (queryStart && queryEnd) {
        startDate = new Date(`${queryStart}T00:00:00.000Z`);
        const endStr = String(queryEnd);
        const endPlus1 = new Date(endStr);
        endPlus1.setDate(endPlus1.getDate() + 1);
        const endStr2 = endPlus1.toISOString().split('T')[0];
        endDate = new Date(`${endStr2}T23:59:59.999Z`);
      } else {
        startDate = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1, 0, 0, 0, 0));
        const tomorrow = new Date(hoje);
        tomorrow.setDate(tomorrow.getDate() + 1);
        endDate = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 23, 59, 59, 999));
      }

      // Period duration for comparative calculations
      const daysDiff = differenceInDays(endDate, startDate) || 1;
      const prevStartDate = subDays(startDate, daysDiff);
      const prevEndDate = subDays(endDate, daysDiff);

      // 1. Receitas no Período Atual (Regime de Caixa e Competência)
      const vendasPeriodo = await prisma.sale.findMany({
        where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: startDate, lte: endDate } },
        include: { saleItems: { include: { product: { include: { category: true } } } } }
      });
      const qtdPedidosPeriodo = vendasPeriodo.length;

      // Soma de Vendas (Competência) — Faturamento Bruto = SUM(valorTotalBruto)
      const faturamentoBruto = vendasPeriodo.reduce((acc, sale) => acc + Number(sale.valorTotalBruto), 0);
      const descontos = vendasPeriodo.reduce((acc, sale) => acc + Number(sale.valorDesconto || 0), 0);
      const taxas = vendasPeriodo.reduce((acc, sale) => acc + Number(sale.valorTaxasGateway || 0), 0);
      const faturamentoLiquido = faturamentoBruto - descontos - taxas;
      const volumeVendasMes = faturamentoLiquido;

      // Soma de Entradas no Caixa (Realizado) — apenas ATIVAS (não estornadas)
      const receitasPeriodoAggregate = await prisma.financialTransaction.aggregate({
        where: { storeId, tipo: 'ENTRADA', status: 'ATIVA', dataTransacao: { gte: startDate, lte: endDate } },
        _sum: { valor: true }
      });
      const dinheiroCaixaRealizado = Number(receitasPeriodoAggregate._sum.valor || 0);

      // Total a Receber (Fiado) — dinâmico: valorParcela - SUM(pagamentos)
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

      const ticketMedioPeriodo = qtdPedidosPeriodo > 0 ? volumeVendasMes / qtdPedidosPeriodo : 0;

      // 2. Receitas no Período Anterior (Para Comparativo)
      const receitasPreviasAggregate = await prisma.financialTransaction.aggregate({
        where: { storeId, tipo: 'ENTRADA', status: 'ATIVA', dataTransacao: { gte: prevStartDate, lte: prevEndDate } },
        _sum: { valor: true }
      });
      const totalVendasPrevio = Number(receitasPreviasAggregate._sum.valor || 0);
      const faturamentoCrescimento = totalVendasPrevio === 0 ? 100 : ((dinheiroCaixaRealizado - totalVendasPrevio) / totalVendasPrevio) * 100;

      // 3. Faturamento Total Histórico (Regime de Caixa)
      const todasReceitas = await prisma.financialTransaction.aggregate({
        where: { storeId, tipo: 'ENTRADA', status: 'ATIVA' },
        _sum: { valor: true }
      });
      const faturamentoTotal = Number(todasReceitas._sum.valor || 0);

      // 4. Impostos Estimados (hierarquia: produto → categoria → loja)
      const storeSettings = await prisma.store.findUnique({
        where: { id: storeId },
        select: { aliquotaImposto: true }
      });
      const aliquotaImposto = Number(storeSettings?.aliquotaImposto || 0);
      let impostosEstimados = 0;
      for (const sale of vendasPeriodo) {
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
      const receitaLiquida = faturamentoLiquido - impostosEstimados;

      // 5. CMV, Lucro Bruto e Despesas do período
      const cmvPeriodo = vendasPeriodo.reduce((acc, sale) => acc + Number(sale.cmvTotal || 0), 0);
      const lucroBruto = faturamentoLiquido - cmvPeriodo;
      const margemBruta = faturamentoLiquido > 0 ? (lucroBruto / faturamentoLiquido) * 100 : 0;

      const despesasPeriodoAggregate = await prisma.financialTransaction.aggregate({
        where: { storeId, tipo: 'SAIDA', dataTransacao: { gte: startDate, lte: endDate } },
        _sum: { valor: true }
      });
      const despesasPeriodo = Number(despesasPeriodoAggregate._sum.valor || 0);
      const lucroLiquido = lucroBruto - despesasPeriodo;
      const margemLiquida = faturamentoLiquido > 0 ? (lucroLiquido / faturamentoLiquido) * 100 : 0;

      // 5. Alertas de Estoque
      const produtosEstoqueBaixo = await prisma.product.findMany({
        where: { storeId, qtdEstoqueAtual: { lte: 5 } },
        select: { id: true, nome: true, qtdEstoqueAtual: true }
      });

      // 5. Últimas 5 vendas (dentro do período selecionado)
      const ultimasVendas = await prisma.sale.findMany({
        where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: startDate, lte: endDate } },
        orderBy: { dataVenda: 'desc' },
        take: 5,
        include: { customer: true }
      });

      // 6. Top 5 Produtos Mais Vendidos no Período
      const productSales = new Map<string, { nome: string; qtd: number; valor: number }>();
      vendasPeriodo.forEach(sale => {
        sale.saleItems.forEach(item => {
          const pid = item.productId;
          const prodName = item.product?.nome || 'Produto Desconhecido';
          const qtd = Number(item.quantidade);
          const val = Number(item.precoUnitarioVendido) * qtd;
          if (!productSales.has(pid)) productSales.set(pid, { nome: prodName, qtd: 0, valor: 0 });
          const curr = productSales.get(pid)!;
          curr.qtd += qtd;
          curr.valor += val;
        });
      });
      const topProdutos = Array.from(productSales.values())
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 5);

      // 7. Dados para Gráfico (Receitas x Despesas dos últimos 6 meses)
      const chartData = [];
      for (let i = 5; i >= 0; i--) {
        const monthStart = startOfMonth(subMonths(hoje, i));
        const monthEnd = endOfMonth(subMonths(hoje, i));
        const monthLabel = monthStart.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });

        const revAggr = await prisma.financialTransaction.aggregate({
          where: { storeId, tipo: 'ENTRADA', status: 'ATIVA', dataTransacao: { gte: monthStart, lte: monthEnd } },
          _sum: { valor: true }
        });
        
        const expAggr = await prisma.financialTransaction.aggregate({
          where: { storeId, tipo: 'SAIDA', dataTransacao: { gte: monthStart, lte: monthEnd }, categoria: { notIn: ['PRO_LABORE', 'DEVOLUCAO', 'RETIRADA_LUCRO'] } },
          _sum: { valor: true }
        });

        chartData.push({
          name: monthLabel,
          receitas: Number(revAggr._sum.valor || 0),
          despesas: Number(expAggr._sum.valor || 0)
        });
      }

      return res.status(200).json({
        vendasHoje: dinheiroCaixaRealizado,
        faturamentoPeriodo: dinheiroCaixaRealizado,
        faturamentoBruto,
        faturamentoLiquido,
        volumeVendasMes,
        impostosEstimados: Math.round(impostosEstimados * 100) / 100,
        aliquotaImposto: aliquotaImposto,
        receitaLiquida: Math.round(receitaLiquida * 100) / 100,
        dinheiroCaixaRealizado,
        aReceberFiado,
        faturamentoCrescimento,
        faturamentoTotal,
        pedidosHoje: qtdPedidosPeriodo,
        pedidosPeriodo: qtdPedidosPeriodo,
        ticketMedio: ticketMedioPeriodo,
        cmvPeriodo: Math.round(cmvPeriodo * 100) / 100,
        lucroBruto: Math.round(lucroBruto * 100) / 100,
        margemBruta: Math.round(margemBruta * 100) / 100,
        despesasPeriodo: Math.round(despesasPeriodo * 100) / 100,
        lucroLiquido: Math.round(lucroLiquido * 100) / 100,
        margemLiquida: Math.round(margemLiquida * 100) / 100,
        estoqueBaixoCount: produtosEstoqueBaixo.length,
        produtosEstoqueBaixo,
        ultimasVendas: ultimasVendas.map(v => ({
          id: v.id,
          data: v.dataVenda,
          cliente: v.customer?.nomeCompleto || 'Cliente Avulso',
          pagamento: v.formaPagamento,
          valor: Number(v.valorTotalLiquido)
        })),
        topProdutos,
        chartData
      });
    } catch (error) {
      console.error('Erro no Dashboard Tenant:', error);
      return res.status(500).json({ message: 'Erro interno' });
    }
  }

  // Dashboard Super ADM
  static async getSuperAdmDashboard(req: Request, res: Response) {
    try {
      const role = req.user?.role;
      if (role !== 'SUPER_ADMIN') return res.status(403).json({ message: 'Acesso negado. Apenas SUPER_ADMIN.' });

      const hoje = new Date();
      const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59, 999);
      const mesPassado = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      const fimMesPassado = new Date(hoje.getFullYear(), hoje.getMonth(), 0, 23, 59, 59, 999);

      const [
        totalStores, totalClients, totalUsers,
        subscriptionsAtivas, subscriptionsVencidas,
        novosClientesMes, clientesMesPassado,
        receitaMeses,
      ] = await Promise.all([
        prisma.store.count(),
        prisma.client.count(),
        prisma.user.count({ where: { role: 'USER' } }),

        prisma.subscription.findMany({ where: { statusPagamento: 'PAGO' } }),
        prisma.subscription.findMany({ where: { statusPagamento: 'VENCIDO' } }),

        prisma.client.count({ where: { createdAt: { gte: inicioMes, lte: fimMes } } }),
        prisma.client.count({ where: { createdAt: { gte: mesPassado, lte: fimMesPassado } } }),

        prisma.subscription.groupBy({
          by: ['statusPagamento'],
          _sum: { valorMensalidade: true },
        }),
      ]);

      const totalPayingClients = subscriptionsAtivas.length;
      const totalVencidos = subscriptionsVencidas.length;
      const totalSubscriptions = totalPayingClients + totalVencidos;

      const mrr = subscriptionsAtivas.reduce((acc, s) => acc + Number(s.valorMensalidade), 0);
      const arpu = totalPayingClients > 0 ? mrr / totalPayingClients : 0;

      const churnRate = totalSubscriptions > 0
        ? ((totalVencidos / totalSubscriptions) * 100)
        : 0;

      const momGrowth = clientesMesPassado > 0
        ? ((novosClientesMes - clientesMesPassado) / clientesMesPassado) * 100
        : novosClientesMes > 0 ? 100 : 0;

      const totalRevenue = receitaMeses.find(r => r.statusPagamento === 'PAGO')?._sum.valorMensalidade || 0;
      const totalPending = receitaMeses.find(r => r.statusPagamento === 'PENDENTE')?._sum.valorMensalidade || 0;

      const ltv = churnRate > 0 ? arpu / (churnRate / 100) : arpu * 12;

      const receitasUltimosMeses: { mes: string; receita: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        const fim = new Date(hoje.getFullYear(), hoje.getMonth() - i + 1, 0, 23, 59, 59, 999);
        const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const mesLabel = `${meses[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;

        const agg = await prisma.subscription.aggregate({
          _sum: { valorMensalidade: true },
          where: {
            statusPagamento: 'PAGO',
            createdAt: { lte: fim },
          },
        });

        receitasUltimosMeses.push({
          mes: mesLabel,
          receita: Number(agg._sum.valorMensalidade || 0),
        });
      }

      return res.status(200).json({
        totalLojas: totalStores,
        lojasAtivas: totalPayingClients,
        totalClientes: totalClients,
        totalUsuarios: totalUsers,
        mrr,
        arpu,
        ltv: Math.round(ltv * 100) / 100,
        churnRate: Math.round(churnRate * 100) / 100,
        inadimplentes: totalVencidos,
        novosClientesMes,
        momGrowth: Math.round(momGrowth * 100) / 100,
        receitaPendente: Number(totalPending),
        receitaChart: receitasUltimosMeses,
      });
    } catch (error) {
      console.error('Erro no Dashboard Super ADM:', error);
      return res.status(500).json({ message: 'Erro interno' });
    }
  }
}
