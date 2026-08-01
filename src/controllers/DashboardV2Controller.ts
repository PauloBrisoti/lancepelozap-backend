import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { addDays, addMonths, startOfMonth, endOfMonth, format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { buildDateRange, getTimezone, calcPrevBounds } from "../lib/dateUtils";

export class DashboardV2Controller {
  static async getTenantDashboard(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Não autorizado" });

      const queryStart = req.query.startDate as string;
      const queryEnd = req.query.endDate as string;
      const { firstDay: startDate, lastDay: endDate } = buildDateRange(queryStart, queryEnd);
      const daysDiff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) || 1;
      const prevStartDate = new Date(startDate.getTime() - daysDiff * 86400000);
      const prevEndDate = new Date(startDate.getTime() - 1);

      const vendasPeriodo = await prisma.sale.findMany({
        where: { storeId, status: { not: "CANCELADA" }, dataVenda: { gte: startDate, lte: endDate } },
        include: { saleItems: { include: { product: { include: { category: true } } } } }
      });
      const qtdPedidosPeriodo = vendasPeriodo.length;
      const faturamentoBruto = vendasPeriodo.reduce((acc, sale) => acc + Number(sale.valorTotalBruto), 0);
      const descontos = vendasPeriodo.reduce((acc, sale) => acc + Number(sale.valorDesconto || 0), 0);
      const taxas = vendasPeriodo.reduce((acc, sale) => acc + Number(sale.valorTaxasGateway || 0), 0);
      const faturamentoLiquido = faturamentoBruto - descontos - taxas;
      const volumeVendasMes = faturamentoLiquido;

      const receitasPeriodoAggregate = await prisma.financialTransaction.aggregate({
        where: { storeId, tipo: "ENTRADA", status: "ATIVA", dataTransacao: { gte: startDate, lte: endDate } },
        _sum: { valor: true }
      });
      const dinheiroCaixaRealizado = Number(receitasPeriodoAggregate._sum.valor || 0);

      const ticketMedioPeriodo = qtdPedidosPeriodo > 0 ? volumeVendasMes / qtdPedidosPeriodo : 0;

      // Comparativo por competência (mesma base do DRE), neutro quando não há vendas anteriores
      const prevSalesAgg = await prisma.sale.aggregate({
        where: { storeId, status: { not: "CANCELADA" }, dataVenda: { gte: prevStartDate, lte: prevEndDate } },
        _sum: { valorTotalBruto: true, valorDesconto: true, valorTaxasGateway: true }
      });
      const prevFaturamentoLiquido = Number(prevSalesAgg._sum.valorTotalBruto || 0) - Number(prevSalesAgg._sum.valorDesconto || 0) - Number(prevSalesAgg._sum.valorTaxasGateway || 0);
      const faturamentoCrescimento = prevFaturamentoLiquido === 0 ? 0 : ((faturamentoLiquido - prevFaturamentoLiquido) / prevFaturamentoLiquido) * 100;

      const todasReceitas = await prisma.financialTransaction.aggregate({
        where: { storeId, tipo: "ENTRADA", status: "ATIVA" },
        _sum: { valor: true }
      });
      const faturamentoTotal = Number(todasReceitas._sum.valor || 0);

      const storeSettings = await prisma.store.findUnique({
        where: { id: storeId }, select: { aliquotaImposto: true }
      });
      const aliquotaImposto = Number(storeSettings?.aliquotaImposto || 0);
      let impostosEstimados = 0;
      for (const sale of vendasPeriodo) {
        for (const item of sale.saleItems) {
          const itemValor = Number(item.precoUnitarioVendido) * Number(item.quantidade);
          const prodRate = Number(item.product?.impostoEstimadoPercentual || 0);
          const catRate = Number(item.product?.category?.aliquotaImposto || 0);
          const effectiveRate = prodRate > 0 ? prodRate : (catRate > 0 ? catRate : aliquotaImposto);
          if (effectiveRate > 0) impostosEstimados += itemValor * effectiveRate / 100;
        }
      }
      impostosEstimados = Math.round(impostosEstimados * 100) / 100;
      const receitaLiquida = faturamentoLiquido - impostosEstimados;

      const cmvPeriodo = vendasPeriodo.reduce((acc, sale) => acc + Number(sale.cmvTotal || 0), 0);
      const lucroBruto = faturamentoLiquido - cmvPeriodo;
      const margemBruta = faturamentoLiquido > 0 ? (lucroBruto / faturamentoLiquido) * 100 : 0;

      const [saidasFinanceirasAgg, despesasPeriodoAgg] = await Promise.all([
        prisma.financialTransaction.aggregate({
          where: { storeId, tipo: "SAIDA", status: "ATIVA", dataTransacao: { gte: startDate, lte: endDate } },
          _sum: { valor: true }
        }),
        prisma.financialTransaction.aggregate({
          where: { storeId, tipo: "SAIDA", status: "ATIVA", dataTransacao: { gte: startDate, lte: endDate }, categoria: { notIn: ["PRO_LABORE", "RETIRADA_LUCRO", "DEVOLUCAO", "CANCELAMENTO", "PAGAMENTO_FORNECEDOR", "COMPRA_ESTOQUE"] } },
          _sum: { valor: true }
        }),
      ]);
      const saidasFinanceiras = Number(saidasFinanceirasAgg._sum.valor || 0);
      const despesasPeriodo = Number(despesasPeriodoAgg._sum.valor || 0);
      const saidasMensais = saidasFinanceiras;
      const lucroLiquido = lucroBruto - despesasPeriodo;
      const margemLiquida = faturamentoLiquido > 0 ? (lucroLiquido / faturamentoLiquido) * 100 : 0;

      const produtosEstoqueBaixo = (await prisma.product.findMany({
        where: { storeId },
        select: { id: true, nome: true, qtdEstoqueAtual: true, estoqueMinimo: true }
      })).filter(p => Number(p.qtdEstoqueAtual) <= Number(p.estoqueMinimo));

      const ultimasVendas = await prisma.sale.findMany({
        where: { storeId, status: { not: "CANCELADA" }, dataVenda: { gte: startDate, lte: endDate } },
        orderBy: { dataVenda: "desc" }, take: 5, include: { customer: true }
      });

      const productSales = new Map<string, { nome: string; qtd: number; valor: number }>();
      vendasPeriodo.forEach(sale => {
        sale.saleItems.forEach(item => {
          const pid = item.productId;
          const prodName = item.product?.nome || "Produto Desconhecido";
          const qtd = Number(item.quantidade);
          const val = Number(item.precoUnitarioVendido) * qtd;
          if (!productSales.has(pid)) productSales.set(pid, { nome: prodName, qtd: 0, valor: 0 });
          const curr = productSales.get(pid)!;
          curr.qtd += qtd;
          curr.valor += val;
        });
      });
      const topProdutos = Array.from(productSales.values()).sort((a, b) => b.valor - a.valor).slice(0, 5);

      // V2: Saldo Anterior (derivado da cascata) + Capital Livre
      const [aggEntrada, aggSaida] = await Promise.all([
        prisma.financialTransaction.aggregate({
          where: { storeId, tipo: "ENTRADA", status: "ATIVA", dataTransacao: { lte: endDate } },
          _sum: { valor: true }
        }),
        prisma.financialTransaction.aggregate({
          where: { storeId, tipo: "SAIDA", status: "ATIVA", dataTransacao: { lte: endDate } },
          _sum: { valor: true }
        })
      ]);
      const saldoCarteiras = Number(aggEntrada._sum.valor || 0) - Number(aggSaida._sum.valor || 0);
      const saidasTotaisValor = saidasFinanceiras;
      const saldoAnterior = saldoCarteiras - (dinheiroCaixaRealizado - saidasTotaisValor);
      const saldoAtual = saldoCarteiras;

      const [recebiveisMes, parcelasFornecedoresAgg, despesasFixasAgg, pagamentosEstoqueAgg] = await Promise.all([
        prisma.accountReceivable.findMany({
          where: { storeId, status: { not: "CANCELADA" } },
          select: { valorParcela: true, saleId: true, payments: { where: { tipo: "ENTRADA", status: "ATIVA" }, select: { valor: true } } }
        }),
        prisma.accountPayable.aggregate({ where: { storeId, status: "PENDENTE", dataVencimento: { lte: endDate } }, _sum: { valor: true } }),
        prisma.financialTransaction.aggregate({ where: { storeId, tipo: "SAIDA", status: "ATIVA", dataTransacao: { gte: startDate, lte: endDate }, categoria: { in: ["ALUGUEL", "SALARIO", "PRO_LABORE", "AGUA", "LUZ", "INTERNET", "TELEFONE", "ASSINATURA", "SEGURO"] } }, _sum: { valor: true } }),
        prisma.financialTransaction.aggregate({ where: { storeId, tipo: "SAIDA", status: "ATIVA", dataTransacao: { gte: startDate, lte: endDate }, categoria: { in: ["COMPRA_ESTOQUE", "PAGAMENTO_FORNECEDOR"] } }, _sum: { valor: true } })
      ]);
      let fiadoAVencer = 0;
      let contasAReceber = 0;
      for (const r of recebiveisMes as any[]) {
        const totalPago = r.payments.reduce((s: number, p: any) => s + Number(p.valor), 0);
        const saldo = Number(r.valorParcela) - totalPago;
        if (r.saleId) {
          fiadoAVencer += saldo;
        } else {
          contasAReceber += saldo;
        }
      }
      const aReceberFiado = fiadoAVencer + contasAReceber;
      const parcelasFornecedoresMes = Number(parcelasFornecedoresAgg._sum.valor || 0);
      const despesasFixasMes = Number(despesasFixasAgg._sum.valor || 0);
      const pagamentosEstoque1 = Number(pagamentosEstoqueAgg._sum.valor || 0);
      const capitalLivre = saldoCarteiras + aReceberFiado - parcelasFornecedoresMes - despesasFixasMes - pagamentosEstoque1;

      // Chart — consulta única agregada por dia/mês
      const tz = getTimezone();
      const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const trunc = diffDays <= 31 ? 'day' : 'month';
      const chartRaw = trunc === 'day'
        ? await prisma.$queryRaw<Array<{ periodo: Date; receitas: number; despesas: number }>>`
            SELECT DATE_TRUNC('day', "data_transacao") AS periodo,
                   COALESCE(SUM(CASE WHEN "tipo" = 'ENTRADA' AND "status" = 'ATIVA' THEN "valor" ELSE 0 END), 0) AS receitas,
                   COALESCE(SUM(CASE WHEN "tipo" = 'SAIDA' AND "status" = 'ATIVA' AND "categoria" != 'CANCELAMENTO' THEN "valor" ELSE 0 END), 0) AS despesas
            FROM "financial_transactions"
            WHERE "store_id" = ${storeId} AND "data_transacao" >= ${startDate}::timestamp AND "data_transacao" <= ${endDate}::timestamp
            GROUP BY periodo ORDER BY periodo
          `
        : await prisma.$queryRaw<Array<{ periodo: Date; receitas: number; despesas: number }>>`
            SELECT DATE_TRUNC('month', "data_transacao") AS periodo,
                   COALESCE(SUM(CASE WHEN "tipo" = 'ENTRADA' AND "status" = 'ATIVA' THEN "valor" ELSE 0 END), 0) AS receitas,
                   COALESCE(SUM(CASE WHEN "tipo" = 'SAIDA' AND "status" = 'ATIVA' AND "categoria" != 'CANCELAMENTO' THEN "valor" ELSE 0 END), 0) AS despesas
            FROM "financial_transactions"
            WHERE "store_id" = ${storeId} AND "data_transacao" >= ${startDate}::timestamp AND "data_transacao" <= ${endDate}::timestamp
            GROUP BY periodo ORDER BY periodo
          `;
      const chartMap = new Map<string, { receitas: number; despesas: number }>();
      for (const row of chartRaw) {
        const key = trunc === 'day'
          ? format(toZonedTime(row.periodo, tz), "dd/MM")
          : format(toZonedTime(row.periodo, tz), "MMM/yy");
        chartMap.set(key, { receitas: Number(row.receitas), despesas: Number(row.despesas) });
      }
      const chartData: Array<{ name: string; receitas: number; despesas: number }> = [];
      if (diffDays <= 31) {
        for (let d = 0; d <= diffDays; d++) {
          const day = addDays(toZonedTime(startDate, tz), d);
          const key = format(day, "dd/MM");
          const row = chartMap.get(key) || { receitas: 0, despesas: 0 };
          chartData.push({ name: key, ...row });
        }
      } else {
        let current = startOfMonth(toZonedTime(startDate, tz));
        const lastMonth = endOfMonth(toZonedTime(endDate, tz));
        while (current <= lastMonth) {
          const key = format(current, "MMM/yy");
          const row = chartMap.get(key) || { receitas: 0, despesas: 0 };
          chartData.push({ name: key, ...row });
          current = addMonths(startOfMonth(current), 1);
        }
      }

      return res.status(200).json({
        vendasHoje: dinheiroCaixaRealizado,
        faturamentoPeriodo: faturamentoLiquido,
        faturamentoBruto, faturamentoLiquido, volumeVendasMes,
        impostosEstimados: Math.round(impostosEstimados * 100) / 100, aliquotaImposto,
        receitaLiquida: Math.round(receitaLiquida * 100) / 100,
        dinheiroCaixaRealizado, aReceberFiado, faturamentoCrescimento, faturamentoTotal,
        pedidosHoje: qtdPedidosPeriodo, pedidosPeriodo: qtdPedidosPeriodo,
        ticketMedio: ticketMedioPeriodo,
        cmvPeriodo: Math.round(cmvPeriodo * 100) / 100,
        lucroBruto: Math.round(lucroBruto * 100) / 100,
        margemBruta: Math.round(margemBruta * 100) / 100,
        despesasPeriodo: Math.round(despesasPeriodo * 100) / 100,
        saidasMensais: Math.round(saidasMensais * 100) / 100,
        saidasTotais: Math.round(saidasFinanceiras * 100) / 100,
        lucroLiquido: Math.round(lucroLiquido * 100) / 100,
        margemLiquida: Math.round(margemLiquida * 100) / 100,
        estoqueBaixoCount: produtosEstoqueBaixo.length, produtosEstoqueBaixo,
        ultimasVendas: ultimasVendas.map(v => ({ id: v.id, data: v.dataVenda, cliente: v.customer?.nomeCompleto || "Cliente Avulso", pagamento: v.formaPagamento, valor: Number(v.valorTotalLiquido) })),
        topProdutos,
        saldoAnterior: Math.round(saldoAnterior * 100) / 100,
        saldoAtual: Math.round(saldoAtual * 100) / 100,
        capitalLivre: Math.round(capitalLivre * 100) / 100,
        saldoCarteiras: Math.round(saldoCarteiras * 100) / 100,
        crediarioAVencerMes: Math.round(aReceberFiado * 100) / 100,
        fiadoAVencer: Math.round(fiadoAVencer * 100) / 100,
        contasAReceber: Math.round(contasAReceber * 100) / 100,
        parcelasFornecedoresMes: Math.round(parcelasFornecedoresMes * 100) / 100,
        despesasFixasMes: Math.round(despesasFixasMes * 100) / 100,
        pagamentosEstoque: Math.round(pagamentosEstoque1 * 100) / 100,
        chartData
      });
    } catch (error) {
      console.error("Erro no Dashboard V2:", error);
      return res.status(500).json({ message: "Erro interno" });
    }
  }

  static async getPjMetrics(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: "Tenant ID não encontrado" });

      const queryStart = req.query.startDate as string;
      const queryEnd = req.query.endDate as string;
      const { firstDay, lastDay } = buildDateRange(queryStart, queryEnd);
      const { prevFirstDay, prevLastDay } = calcPrevBounds(firstDay, lastDay);

      const [aggEntrada, aggSaida] = await Promise.all([
        prisma.financialTransaction.aggregate({
          where: { storeId, tipo: "ENTRADA", status: "ATIVA", dataTransacao: { lte: lastDay } },
          _sum: { valor: true }
        }),
        prisma.financialTransaction.aggregate({
          where: { storeId, tipo: "SAIDA", status: "ATIVA", dataTransacao: { lte: lastDay } },
          _sum: { valor: true }
        })
      ]);
      const saldoAcumulado = Number(aggEntrada._sum.valor || 0) - Number(aggSaida._sum.valor || 0);

      const products = await prisma.product.findMany({
        where: { storeId, status: "ATIVO" },
        select: { precoCusto: true, qtdEstoqueAtual: true }
      });
      const dinheiroImobilizado = products.reduce((acc, p) => acc + (Number(p.precoCusto) * Number(p.qtdEstoqueAtual)), 0);

      const [salesAgg, petOrdersAgg, receitasCaixa, saidasFinanceirasAgg, despesasAgg, salesPeriodo] = await Promise.all([
        prisma.sale.aggregate({ where: { storeId, status: { not: "CANCELADA" }, dataVenda: { gte: firstDay, lte: lastDay } }, _sum: { cmvTotal: true, valorTotalLiquido: true, valorTotalBruto: true, valorDesconto: true, valorTaxasGateway: true } }),
        prisma.petServiceOrder.aggregate({ where: { storeId, status: "CONCLUIDO", dataConclusao: { gte: firstDay, lte: lastDay } }, _sum: { valorFinal: true } }),
        prisma.financialTransaction.aggregate({ where: { storeId, tipo: "ENTRADA", status: "ATIVA", dataTransacao: { gte: firstDay, lte: lastDay } }, _sum: { valor: true } }),
        prisma.financialTransaction.aggregate({ where: { storeId, tipo: "SAIDA", status: "ATIVA", dataTransacao: { gte: firstDay, lte: lastDay } }, _sum: { valor: true } }),
        prisma.financialTransaction.aggregate({ where: { storeId, tipo: "SAIDA", status: "ATIVA", dataTransacao: { gte: firstDay, lte: lastDay }, categoria: { notIn: ["PRO_LABORE", "RETIRADA_LUCRO", "DEVOLUCAO", "CANCELAMENTO", "PAGAMENTO_FORNECEDOR", "COMPRA_ESTOQUE"] } }, _sum: { valor: true } }),
        prisma.sale.findMany({ where: { storeId, status: { not: "CANCELADA" }, dataVenda: { gte: firstDay, lte: lastDay } }, select: { id: true } }),
      ]);
      const saleIdsPeriodo = new Set(salesPeriodo.map(s => s.id));

      const [receitasVendasPeriodo] = await Promise.all([
        prisma.financialTransaction.aggregate({
          where: { storeId, tipo: "ENTRADA", status: "ATIVA", dataTransacao: { gte: firstDay, lte: lastDay }, saleId: { in: Array.from(saleIdsPeriodo) } },
          _sum: { valor: true }
        }),
      ]);
      const dinheiroRecebidoVendasPeriodo = Number(receitasVendasPeriodo._sum.valor || 0);

      const petRevenue = Number(petOrdersAgg._sum.valorFinal || 0);
      const cmvMes = Number(salesAgg._sum.cmvTotal || 0);
      const volumeVendasMes = Number(salesAgg._sum.valorTotalLiquido || 0) + petRevenue;
      const faturamentoBruto = Number(salesAgg._sum.valorTotalBruto || 0) + petRevenue;
      const totalDescontos = Number(salesAgg._sum.valorDesconto || 0);
      const totalTaxasGateway = Number(salesAgg._sum.valorTaxasGateway || 0);
      const faturamentoLiquido = faturamentoBruto - totalDescontos - totalTaxasGateway;
      const dinheiroCaixaRealizado = Number(receitasCaixa._sum.valor || 0);
      const saidasFinanceiras = Number(saidasFinanceirasAgg._sum.valor || 0);
      const despesasOperacionais = Number(despesasAgg._sum.valor || 0);
      const saidasMensais = saidasFinanceiras;
      const saidasTotais = saidasFinanceiras;
      const lucroBruto = faturamentoLiquido - cmvMes;
      const lucroLiquidoReal = lucroBruto - despesasOperacionais;

      const [prevSalesAgg, prevDespesasAggr, prevPetOrdersAgg] = await Promise.all([
        prisma.sale.aggregate({ where: { storeId, status: { not: "CANCELADA" }, dataVenda: { gte: prevFirstDay, lte: prevLastDay } }, _sum: { cmvTotal: true, valorTotalLiquido: true, valorTotalBruto: true, valorDesconto: true, valorTaxasGateway: true } }),
        prisma.financialTransaction.aggregate({ where: { storeId, tipo: "SAIDA", status: "ATIVA", dataTransacao: { gte: prevFirstDay, lte: prevLastDay }, categoria: { notIn: ["CANCELAMENTO"] } }, _sum: { valor: true } }),
        prisma.petServiceOrder.aggregate({ where: { storeId, status: "CONCLUIDO", dataConclusao: { gte: prevFirstDay, lte: prevLastDay } }, _sum: { valorFinal: true } }),
      ]);

      const prevPetRevenue = Number(prevPetOrdersAgg._sum.valorFinal || 0);
      const prevFatBruto = Number(prevSalesAgg._sum.valorTotalBruto || 0) + prevPetRevenue;
      const prevDescontos = Number(prevSalesAgg._sum.valorDesconto || 0);
      const prevTaxas = Number(prevSalesAgg._sum.valorTaxasGateway || 0);
      const prevFatLiq = prevFatBruto - prevDescontos - prevTaxas;
      const prevLucroLiquido = (prevFatLiq - Number(prevSalesAgg._sum.cmvTotal || 0)) - Number(prevDespesasAggr._sum.valor || 0);

      const storeData = await prisma.store.findUnique({ where: { id: storeId }, select: { aliquotaImposto: true } });
      const aliquotaImposto = Number(storeData?.aliquotaImposto || 0);
      const salesForTax = await prisma.sale.findMany({
        where: { storeId, status: { not: "CANCELADA" }, dataVenda: { gte: firstDay, lte: lastDay } },
        select: { saleItems: { select: { precoUnitarioVendido: true, quantidade: true, product: { select: { impostoEstimadoPercentual: true, category: { select: { aliquotaImposto: true } } } } } } }
      });
      let impostosEstimados = 0;
      for (const sale of salesForTax) {
        for (const item of sale.saleItems) {
          const itemValor = Number(item.precoUnitarioVendido) * Number(item.quantidade);
          const prodRate = Number(item.product?.impostoEstimadoPercentual || 0);
          const catRate = Number(item.product?.category?.aliquotaImposto || 0);
          const effectiveRate = prodRate > 0 ? prodRate : (catRate > 0 ? catRate : aliquotaImposto);
          if (effectiveRate > 0) impostosEstimados += itemValor * effectiveRate / 100;
        }
      }
      impostosEstimados = Math.round(impostosEstimados * 100) / 100;

      // Saldo Anterior: derivado da cascata para consistência
      const saldoAnterior = saldoAcumulado - (dinheiroCaixaRealizado - saidasTotais);
      const saldoAtual = saldoAcumulado;

      // Capital Livre: saldo - contas a pagar do mês (conservador)
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const inadimplenciaData = hoje;

      const [recebiveisMes, parcelasFornecedoresAgg, despesasFixasAgg, pagamentosEstoqueAgg] = await Promise.all([
        prisma.accountReceivable.findMany({
          where: { storeId, status: { not: "CANCELADA" } },
          select: { dataVencimento: true, valorParcela: true, saleId: true, payments: { where: { tipo: "ENTRADA", status: "ATIVA" }, select: { valor: true } } }
        }),
        prisma.accountPayable.aggregate({ where: { storeId, status: "PENDENTE" }, _sum: { valor: true } }),
        prisma.financialTransaction.aggregate({ where: { storeId, tipo: "SAIDA", status: "ATIVA", dataTransacao: { gte: hoje, lte: lastDay }, categoria: { in: ["ALUGUEL", "SALARIO", "PRO_LABORE", "AGUA", "LUZ", "INTERNET", "TELEFONE", "ASSINATURA", "SEGURO"] } }, _sum: { valor: true } }),
        prisma.financialTransaction.aggregate({ where: { storeId, tipo: "SAIDA", status: "ATIVA", dataTransacao: { gte: hoje, lte: lastDay }, categoria: { in: ["COMPRA_ESTOQUE", "PAGAMENTO_FORNECEDOR"] } }, _sum: { valor: true } })
      ]);
      let fiadoAVencer = 0;
      let contasAReceber = 0;
      let contasAReceberPeriodo = 0;
      let contasAReceberAnterior = 0;
      let contasAReceberFuturo = 0;
      let fiadoPeriodo = 0;
      let inadimplenciaTotal = 0;
      for (const r of recebiveisMes as any[]) {
        const totalPago = r.payments.reduce((s: number, p: any) => s + Number(p.valor), 0);
        const saldo = Number(r.valorParcela) - totalPago;
        if (saldo <= 0) continue;
        const vencimento = new Date(r.dataVencimento);
        vencimento.setHours(0, 0, 0, 0);
        if (vencimento < inadimplenciaData) {
          inadimplenciaTotal += saldo;
        }
        if (vencimento >= firstDay && vencimento <= lastDay) {
          contasAReceberPeriodo += saldo;
        } else if (vencimento < firstDay) {
          contasAReceberAnterior += saldo;
        } else {
          contasAReceberFuturo += saldo;
        }
        if (r.saleId) {
          fiadoAVencer += saldo;
          if (vencimento >= firstDay && vencimento <= lastDay) {
            fiadoPeriodo += saldo;
          }
        } else {
          contasAReceber += saldo;
        }
      }
      const aReceberFiado = fiadoAVencer + contasAReceber;
      const parcelasFornecedoresMes = Number(parcelasFornecedoresAgg._sum.valor || 0);
      const despesasFixasMes = Number(despesasFixasAgg._sum.valor || 0);
      const pagamentosEstoque = Number(pagamentosEstoqueAgg._sum.valor || 0);
      const capitalLivre = saldoAtual + aReceberFiado - parcelasFornecedoresMes - despesasFixasMes - pagamentosEstoque;

      // Payment Methods Breakdown
      const salesForPaymentMethod = await prisma.sale.findMany({
        where: { storeId, status: { not: "CANCELADA" }, dataVenda: { gte: firstDay, lte: lastDay } },
        select: { formaPagamento: true, valorTotalLiquido: true, numeroParcelas: true, valorSinal: true }
      });
      const pmBreakdown: Record<string, number> = {};
      for (const s of salesForPaymentMethod) {
        const pm = s.formaPagamento;
        if (pm === 'CARTAO_CREDITO') {
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
        { method: 'CREDIARIO', label: 'Crediário', value: pmBreakdown['CREDIARIO'] || 0 },
      ];

      const faturamentoCrescimento = prevFatLiq === 0 ? 100 : ((faturamentoLiquido - prevFatLiq) / prevFatLiq) * 100;
      const lucroCrescimento = prevLucroLiquido === 0 ? 100 : ((lucroLiquidoReal - prevLucroLiquido) / Math.abs(prevLucroLiquido)) * 100;

      const saldoProjetado = saldoAtual + aReceberFiado - parcelasFornecedoresMes - despesasFixasMes - pagamentosEstoque;
      const inadimplenciaPercentual = aReceberFiado > 0 ? Math.round((inadimplenciaTotal / aReceberFiado) * 10000) / 100 : 0;
      const dinheiroRecebidoOutros = Math.max(0, dinheiroCaixaRealizado - dinheiroRecebidoVendasPeriodo);

      return res.json({
        metrics: {
          saldoAcumulado, volumeVendasMes, aReceberFiado, dinheiroImobilizado,
          dinheiroCaixaRealizado, faturamentoBruto, faturamentoLiquido,
          faturamentoCrescimento, cmvMes,
          impostosEstimados: Math.round(impostosEstimados * 100) / 100, aliquotaImposto,
          lucroBruto, despesasOperacionais, lucroLiquidoReal, lucroCrescimento,
          saldoAnterior: Math.round(saldoAnterior * 100) / 100,
          saldoAtual: Math.round(saldoAtual * 100) / 100,
          saidasTotais: Math.round(saidasTotais * 100) / 100,
          saidasMensais: Math.round(saidasMensais * 100) / 100,
          capitalLivre: Math.round(capitalLivre * 100) / 100,
          crediarioAVencerMes: Math.round(aReceberFiado * 100) / 100,
          fiadoAVencer: Math.round(fiadoAVencer * 100) / 100,
          fiadoPeriodo: Math.round(fiadoPeriodo * 100) / 100,
          contasAReceber: Math.round(contasAReceber * 100) / 100,
          parcelasFornecedoresMes: Math.round(parcelasFornecedoresMes * 100) / 100,
          despesasFixasMes: Math.round(despesasFixasMes * 100) / 100,
          pagamentosEstoque: Math.round(pagamentosEstoque * 100) / 100,
          saldoProjetado: Math.round(saldoProjetado * 100) / 100,
          paymentMethodsBreakdown,
          // Novos campos de breakdown
          dinheiroRecebidoVendasPeriodo: Math.round(dinheiroRecebidoVendasPeriodo * 100) / 100,
          dinheiroRecebidoOutros: Math.round(dinheiroRecebidoOutros * 100) / 100,
          contasAReceberPeriodo: Math.round(contasAReceberPeriodo * 100) / 100,
          contasAReceberAnterior: Math.round(contasAReceberAnterior * 100) / 100,
          contasAReceberFuturo: Math.round(contasAReceberFuturo * 100) / 100,
          inadimplenciaTotal: Math.round(inadimplenciaTotal * 100) / 100,
          inadimplenciaPercentual,
        }
      });
    } catch (error) {
      console.error("Erro no Dashboard PJ V2:", error);
      return res.status(500).json({ message: "Erro interno ao calcular métricas." });
    }
  }
}
