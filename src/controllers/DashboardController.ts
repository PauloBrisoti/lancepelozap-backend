import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { addDays, addMonths, startOfMonth, endOfMonth, format } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { buildDateRange, getTimezone } from '../lib/dateUtils';

export class DashboardController {
  
  // Dashboard Lojista (Tenant)
  static async getTenantDashboard(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Não autorizado' });

      const queryStart = req.query.startDate as string;
      const queryEnd = req.query.endDate as string;
      
      const { firstDay: startDate, lastDay: endDate } = buildDateRange(queryStart, queryEnd);

      const daysDiff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) || 1;
      const prevStartDate = new Date(startDate.getTime() - daysDiff * 86400000);
      const prevEndDate = new Date(startDate.getTime() - 1);

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

      // 2. Receitas no Período Anterior (Para Comparativo — competência, mesma base do DRE)
      const prevSalesAgg = await prisma.sale.aggregate({
        where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: prevStartDate, lte: prevEndDate } },
        _sum: { valorTotalBruto: true, valorDesconto: true, valorTaxasGateway: true }
      });
      const prevFaturamentoLiquido = Number(prevSalesAgg._sum.valorTotalBruto || 0) - Number(prevSalesAgg._sum.valorDesconto || 0) - Number(prevSalesAgg._sum.valorTaxasGateway || 0);
      const faturamentoCrescimento = prevFaturamentoLiquido === 0 ? 0 : ((faturamentoLiquido - prevFaturamentoLiquido) / prevFaturamentoLiquido) * 100;

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
        where: { storeId, tipo: 'SAIDA', dataTransacao: { gte: startDate, lte: endDate }, categoria: { notIn: ['PRO_LABORE', 'DEVOLUCAO', 'RETIRADA_LUCRO', 'CANCELAMENTO'] } },
        _sum: { valor: true }
      });
      const despesasPeriodo = Number(despesasPeriodoAggregate._sum.valor || 0);
      const lucroLiquido = lucroBruto - despesasPeriodo;
      const margemLiquida = faturamentoLiquido > 0 ? (lucroLiquido / faturamentoLiquido) * 100 : 0;

      // 5. Alertas de Estoque (respeita o estoque mínimo de cada produto)
      const produtosEstoqueBaixo = (await prisma.product.findMany({
        where: { storeId },
        select: { id: true, nome: true, qtdEstoqueAtual: true, estoqueMinimo: true }
      })).filter(p => Number(p.qtdEstoqueAtual) <= Number(p.estoqueMinimo));

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

      // 7. Dados para Gráfico (Receitas x Despesas) — respeita o período do filtro
      const tz = getTimezone();
      const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const chartData = [];

      if (diffDays <= 31) {
        // Agrupamento diário
        for (let d = 0; d <= diffDays; d++) {
          const day = addDays(toZonedTime(startDate, tz), d);
          const ds = format(day, 'yyyy-MM-dd');
          const dayStart = fromZonedTime(`${ds}T00:00:00.000`, tz);
          const dayEnd = fromZonedTime(`${ds}T23:59:59.999`, tz);

          const [r, e] = await Promise.all([
            prisma.financialTransaction.aggregate({
              where: { storeId, tipo: 'ENTRADA', status: 'ATIVA', dataTransacao: { gte: dayStart, lte: dayEnd } },
              _sum: { valor: true }
            }),
            prisma.financialTransaction.aggregate({
              where: { storeId, tipo: 'SAIDA', status: 'ATIVA', dataTransacao: { gte: dayStart, lte: dayEnd }, categoria: { notIn: ['PRO_LABORE', 'DEVOLUCAO', 'RETIRADA_LUCRO', 'CANCELAMENTO'] } },
              _sum: { valor: true }
            }),
          ]);

          chartData.push({
            name: day.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
            receitas: Number(r._sum.valor || 0),
            despesas: Number(e._sum.valor || 0),
          });
        }
      } else {
        // Agrupamento mensal
        let current = startOfMonth(toZonedTime(startDate, tz));
        const lastMonth = endOfMonth(toZonedTime(endDate, tz));

        while (current <= lastMonth) {
          const ms = format(current, 'yyyy-MM-dd');
          const me = format(endOfMonth(current), 'yyyy-MM-dd');
          const monthStart = fromZonedTime(`${ms}T00:00:00.000`, tz);
          const monthEnd = fromZonedTime(`${me}T23:59:59.999`, tz);

          const [r, e] = await Promise.all([
            prisma.financialTransaction.aggregate({
              where: { storeId, tipo: 'ENTRADA', status: 'ATIVA', dataTransacao: { gte: monthStart, lte: monthEnd } },
              _sum: { valor: true }
            }),
            prisma.financialTransaction.aggregate({
              where: { storeId, tipo: 'SAIDA', status: 'ATIVA', dataTransacao: { gte: monthStart, lte: monthEnd }, categoria: { notIn: ['PRO_LABORE', 'DEVOLUCAO', 'RETIRADA_LUCRO', 'CANCELAMENTO'] } },
              _sum: { valor: true }
            }),
          ]);

          chartData.push({
            name: current.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
            receitas: Number(r._sum.valor || 0),
            despesas: Number(e._sum.valor || 0),
          });

          current = addMonths(startOfMonth(current), 1);
        }
      }

      return res.status(200).json({
        vendasHoje: dinheiroCaixaRealizado,
        faturamentoPeriodo: faturamentoLiquido,
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

      const hojeTz = toZonedTime(new Date(), getTimezone());
      const inicioMes = fromZonedTime(`${hojeTz.getFullYear()}-${String(hojeTz.getMonth()+1).padStart(2,'0')}-01T00:00:00.000`, getTimezone());
      const fimMes = fromZonedTime(`${hojeTz.getFullYear()}-${String(hojeTz.getMonth()+1).padStart(2,'0')}-${new Date(hojeTz.getFullYear(), hojeTz.getMonth()+1, 0).getDate()}T23:59:59.999`, getTimezone());
      const mesPassado = fromZonedTime(`${hojeTz.getFullYear()}-${String(hojeTz.getMonth()).padStart(2,'0')}-01T00:00:00.000`, getTimezone());
      const fimMesPassado = fromZonedTime(`${hojeTz.getFullYear()}-${String(hojeTz.getMonth()).padStart(2,'0')}-${new Date(hojeTz.getFullYear(), hojeTz.getMonth(), 0).getDate()}T23:59:59.999`, getTimezone());

      const [
        totalStores, totalClients, totalUsers,
        novosClientesMes, clientesMesPassado,
      ] = await Promise.all([
        prisma.store.count(),
        prisma.client.count(),
        prisma.user.count({ where: { role: 'USER' } }),
        prisma.client.count({ where: { createdAt: { gte: inicioMes, lte: fimMes } } }),
        prisma.client.count({ where: { createdAt: { gte: mesPassado, lte: fimMesPassado } } }),
      ]);

      // Assinatura vigente por cliente (a mais recente por createdAt)
      // — mesmo critério usado pelo middleware de auth (checkActiveSubscription)
      const assinaturas = await prisma.subscription.findMany({
        where: { statusPagamento: { not: 'CANCELADO' } },
        orderBy: [{ clientId: 'asc' }, { createdAt: 'desc' }],
        include: { client: { select: { nomeCompleto: true } } },
      });
      const porCliente = new Map<string, (typeof assinaturas)[number]>();
      for (const sub of assinaturas) {
        if (!porCliente.has(sub.clientId)) porCliente.set(sub.clientId, sub);
      }
      const vigentes = Array.from(porCliente.values());

      const pagas = vigentes.filter(s => s.statusPagamento === 'PAGO');
      const vencidas = vigentes.filter(s => s.statusPagamento === 'VENCIDO');
      const pendentes = vigentes.filter(s => s.statusPagamento === 'PENDENTE');

      const totalPayingClients = pagas.length;
      const totalVencidos = vencidas.length;
      const totalSubscriptions = totalPayingClients + totalVencidos;

      const mrr = pagas.reduce((acc, s) => acc + Number(s.valorMensalidade), 0);
      const arpu = totalPayingClients > 0 ? mrr / totalPayingClients : 0;

      // Inadimplência ≠ churn: taxa de inadimplência = vencidos/(pagos+vencidos)
      const taxaInadimplencia = totalSubscriptions > 0
        ? (totalVencidos / totalSubscriptions) * 100
        : 0;

      // Churn de lojas no mês: clientes com assinatura CANCELADA com vencimento no mês corrente
      const churnLojasMes = await prisma.subscription.count({
        where: {
          statusPagamento: 'CANCELADO',
          dataVencimento: { gte: inicioMes, lte: fimMes },
        },
      });

      // Receita pendente = PENDENTE + VENCIDO (o boleto vencido também é receita em aberto)
      const receitaPendente = [...pendentes, ...vencidas].reduce(
        (acc, s) => acc + Number(s.valorMensalidade), 0);

      const momGrowth = clientesMesPassado > 0
        ? ((novosClientesMes - clientesMesPassado) / clientesMesPassado) * 100
        : novosClientesMes > 0 ? 100 : 0;

      // LTV: com base pequena é ruído estatístico — só exibir com amostra significativa
      const ltv = totalPayingClients >= 30 && taxaInadimplencia > 0
        ? arpu / (taxaInadimplencia / 100)
        : null;

      // Evolução por mês: soma das mensalidades PAGO por mês de vencimento
      const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      const receitasUltimosMeses: { mes: string; receita: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(hojeTz.getFullYear(), hojeTz.getMonth() - i, 1);
        const fim = new Date(hojeTz.getFullYear(), hojeTz.getMonth() - i + 1, 0, 23, 59, 59, 999);
        const mesLabel = `${meses[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;

        const agg = await prisma.subscription.aggregate({
          _sum: { valorMensalidade: true },
          where: {
            statusPagamento: 'PAGO',
            dataVencimento: { gte: d, lte: fim },
          },
        });

        receitasUltimosMeses.push({
          mes: mesLabel,
          receita: Number(agg._sum.valorMensalidade || 0),
        });
      }

      // Delta MRR: comparação entre os dois últimos meses com receita
      let mrrDelta = 0;
      const comReceita = receitasUltimosMeses.filter(m => m.receita > 0);
      if (comReceita.length >= 2) {
        const atual = comReceita[comReceita.length - 1].receita;
        const anterior = comReceita[comReceita.length - 2].receita;
        mrrDelta = anterior > 0 ? ((atual - anterior) / anterior) * 100 : 0;
      }

      return res.status(200).json({
        totalLojas: totalStores,
        lojasAtivas: totalPayingClients,
        totalClientes: totalClients,
        totalUsuarios: totalUsers,
        mrr,
        arpu: Math.round(arpu * 100) / 100,
        ltv,
        churnRate: Math.round(taxaInadimplencia * 100) / 100,
        inadimplentes: totalVencidos,
        novosClientesMes,
        momGrowth: Math.round(momGrowth * 100) / 100,
        receitaPendente: Math.round(receitaPendente * 100) / 100,
        mrrDelta: Math.round(mrrDelta * 100) / 100,
        churnLojasMes,
        receitaChart: receitasUltimosMeses,
      });
    } catch (error) {
      console.error('Erro no Dashboard Super ADM:', error);
      return res.status(500).json({ message: 'Erro interno' });
    }
  }
}
