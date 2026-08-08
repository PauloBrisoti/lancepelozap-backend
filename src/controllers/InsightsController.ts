import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { subDays, format, startOfDay, endOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { getTimezone } from '../lib/dateUtils';
import { asyncHandler, getStoreId } from '../lib/asyncHandler';

export class InsightsController {
  static getForecast = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);

    const hoje = toZonedTime(new Date(), getTimezone());
    const daysBack = 90;
    const startDate = subDays(hoje, daysBack);

    const sales = await prisma.sale.findMany({
      where: {
        storeId,
        status: { not: 'CANCELADA' },
        dataVenda: { gte: startDate, lte: hoje }
      },
      select: { dataVenda: true, valorTotalLiquido: true },
      orderBy: { dataVenda: 'asc' }
    });

    if (sales.length < 7) {
      const diasFaltando = 7 - sales.length;
      return res.json({
        daily: sales.map(s => ({ date: format(s.dataVenda, 'yyyy-MM-dd'), total: Number(s.valorTotalLiquido) })),
        movingAvg: [],
        forecast: [],
        totalLast30Days: sales.reduce((s, sale) => s + Number(sale.valorTotalLiquido), 0),
        avgTicket: sales.length > 0
          ? Math.round(sales.reduce((s, sale) => s + Number(sale.valorTotalLiquido), 0) / sales.length * 100) / 100
          : 0,
        dadosInsuficientes: true,
        mensagem: `Sua loja ainda precisa de mais ${diasFaltando} dia${diasFaltando !== 1 ? 's' : ''} de movimentação para gerarmos uma previsão confiável. Continue vendendo e volte em alguns dias.`,
        diasComVenda: sales.length,
      });
    }

    const dailyMap = new Map<string, number>();
    for (let i = daysBack; i >= 0; i--) {
      const d = format(subDays(hoje, i), 'yyyy-MM-dd');
      dailyMap.set(d, 0);
    }
    for (const sale of sales) {
      const d = format(sale.dataVenda, 'yyyy-MM-dd');
      dailyMap.set(d, (dailyMap.get(d) || 0) + Number(sale.valorTotalLiquido));
    }

    const dailyData = Array.from(dailyMap.entries()).map(([date, total]) => ({ date, total }));

    const movingAvg7 = dailyData.map((_, i, arr) => {
      if (i < 6) return null;
      const slice = arr.slice(i - 6, i + 1);
      return Math.round(slice.reduce((s, d) => s + d.total, 0) / 7 * 100) / 100;
    });

    const lastMA = dailyData.length >= 7 ? dailyData.slice(-7).reduce((s, d) => s + d.total, 0) / 7 : 0;
    const forecast = [];
    for (let i = 1; i <= 7; i++) {
      const d = format(subDays(hoje, -i), 'yyyy-MM-dd');
      forecast.push({ date: d, predicted: Math.round(lastMA * 100) / 100 });
    }

    return res.json({
      daily: dailyData.slice(-30),
      movingAvg: movingAvg7.filter(Boolean).slice(-30),
      forecast,
      totalLast30Days: dailyData.slice(-30).reduce((s, d) => s + d.total, 0),
      avgTicket: sales.length > 0
        ? Math.round(sales.reduce((s, sale) => s + Number(sale.valorTotalLiquido), 0) / sales.length * 100) / 100
        : 0,
      dadosInsuficientes: false,
    });
  }, "calcular forecast");

  static getStockRecommendations = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);

    const hoje = toZonedTime(new Date(), getTimezone());
    const startDate = subDays(hoje, 30);

    const products = await prisma.product.findMany({
      where: { storeId, status: 'ATIVO' },
      include: {
        category: true,
        saleItems: {
          where: {
            sale: { dataVenda: { gte: startDate }, status: { not: 'CANCELADA' } }
          },
          select: { quantidade: true }
        }
      }
    });

    const recommendations = products.map(p => {
      const qtdEstoque = Number(p.qtdEstoqueAtual);
      const totalSold = p.saleItems.reduce((s, si) => s + Number(si.quantidade), 0);
      const dailyVelocity = totalSold / 30;
      const daysUntilStockout = dailyVelocity > 0 ? Math.round(qtdEstoque / dailyVelocity) : Infinity;
      const suggestedOrder = dailyVelocity > 0 ? Math.ceil(dailyVelocity * 30 - qtdEstoque) : 0;

      return {
        productId: p.id,
        nome: p.nome,
        category: p.category?.nome || '',
        qtdEstoque,
        estoqueMinimo: Number(p.estoqueMinimo),
        dailyVelocity: Math.round(dailyVelocity * 100) / 100,
        daysUntilStockout: daysUntilStockout === Infinity ? null : daysUntilStockout,
        suggestedOrder: suggestedOrder > 0 ? suggestedOrder : 0,
        needsReorder: daysUntilStockout !== Infinity && daysUntilStockout <= 30,
        lowStock: qtdEstoque <= Number(p.estoqueMinimo),
      };
    });

    const needsReorder = recommendations.filter(r => r.needsReorder).sort((a, b) => (a.daysUntilStockout ?? 999) - (b.daysUntilStockout ?? 999));
    const lowStock = recommendations.filter(r => r.lowStock).sort((a, b) => a.qtdEstoque - b.qtdEstoque);

    return res.json({
      needsReorder: needsReorder.slice(0, 20),
      lowStock: lowStock.slice(0, 20),
      totalProducts: products.length,
      productsAtRisk: needsReorder.length,
    });
  }, "gerar recomendações de estoque");

  static getAnomalies = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);

    const hoje = toZonedTime(new Date(), getTimezone());
    const last30 = subDays(hoje, 30);
    const last60 = subDays(hoje, 60);

    const products = await prisma.product.findMany({
      where: { storeId, status: 'ATIVO' },
      select: {
        id: true, nome: true, precoCusto: true, precoVendaSugerido: true, qtdEstoqueAtual: true, imageUrl: true,
        saleItems: {
          where: { sale: { dataVenda: { gte: last60 }, status: { not: 'CANCELADA' } } },
          select: { quantidade: true, precoUnitarioVendido: true, sale: { select: { dataVenda: true } } }
        }
      }
    });

    const soldInLast30 = new Set<string>();
    const soldInLast60 = new Set<string>();
    for (const p of products) {
      for (const si of p.saleItems) {
        const d = new Date(si.sale.dataVenda);
        if (d >= last30) soldInLast30.add(p.id);
        if (d >= last60) soldInLast60.add(p.id);
      }
    }

    const stagnantProducts = products
      .filter(p => !soldInLast30.has(p.id) && Number(p.qtdEstoqueAtual) > 0)
      .map(p => ({ productId: p.id, nome: p.nome, qtdEstoque: Number(p.qtdEstoqueAtual), imageUrl: p.imageUrl }));

    const deadProducts = products
      .filter(p => !soldInLast60.has(p.id) && Number(p.qtdEstoqueAtual) > 0)
      .map(p => ({ productId: p.id, nome: p.nome, qtdEstoque: Number(p.qtdEstoqueAtual), imageUrl: p.imageUrl }));

    const salesByDay = await prisma.sale.findMany({
      where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: last30 } },
      select: { dataVenda: true, valorTotalLiquido: true },
      orderBy: { dataVenda: 'asc' }
    });

    const dayOfWeekAvg = [0, 0, 0, 0, 0, 0, 0];
    const dayOfWeekCount = [0, 0, 0, 0, 0, 0, 0];
    for (const s of salesByDay) {
      const dow = new Date(s.dataVenda).getDay();
      dayOfWeekAvg[dow] += Number(s.valorTotalLiquido);
      dayOfWeekCount[dow]++;
    }
    for (let i = 0; i < 7; i++) {
      dayOfWeekAvg[i] = dayOfWeekCount[i] > 0 ? Math.round(dayOfWeekAvg[i] / dayOfWeekCount[i] * 100) / 100 : 0;
    }

    const todaySales = await prisma.sale.aggregate({
      where: { storeId, status: { not: 'CANCELADA' }, dataVenda: { gte: startOfDay(hoje), lte: endOfDay(hoje) } },
      _sum: { valorTotalLiquido: true }
    });
    const todayTotal = Number(todaySales._sum.valorTotalLiquido || 0);
    const todayDow = hoje.getDay();
    const todayExpected = dayOfWeekAvg[todayDow];
    const anomalyToday = todayExpected > 0 ? Math.abs(todayTotal - todayExpected) / todayExpected > 0.5 : false;

    return res.json({
      stagnantProducts: stagnantProducts.slice(0, 15),
      deadProducts: deadProducts.slice(0, 15),
      todayAnomaly: {
        date: format(hoje, 'yyyy-MM-dd'),
        actual: todayTotal,
        expected: todayExpected,
        isAnomaly: anomalyToday,
        deviation: todayExpected > 0 ? Math.round((todayTotal - todayExpected) / todayExpected * 100) : 0,
      },
      stagnantCount: stagnantProducts.length,
      deadCount: deadProducts.length,
    });
  }, "detectar anomalias");
}
