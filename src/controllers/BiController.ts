import { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { asyncHandler } from "../lib/asyncHandler";
import { buildDateRange } from '../lib/dateUtils';

export class BiController {
  comparativo = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { dataInicio1, dataFim1, dataInicio2, dataFim2 } = req.query;

      if (!dataInicio1 || !dataFim1 || !dataInicio2 || !dataFim2) {
        return res.status(400).json({ message: 'dataInicio1, dataFim1, dataInicio2, dataFim2 são obrigatórios' });
      }

      const buscarPeriodo = async (inicio: string, fim: string) => {
        const { firstDay, lastDay } = buildDateRange(inicio, fim);
        const where = {
          storeId,
          status: { not: 'CANCELADA' },
          dataVenda: { gte: firstDay, lte: lastDay },
        };

        const [vendas, totalVendas, totalItens] = await Promise.all([
          prisma.sale.findMany({ where, select: { valorTotalLiquido: true, cmvTotal: true, dataVenda: true } }),
          prisma.sale.count({ where }),
          prisma.saleItem.count({ where: { sale: { storeId,           status: { not: 'CANCELADA' }, dataVenda: { gte: firstDay, lte: lastDay } } } }),
        ]);

        const receita = vendas.reduce((s, v) => s + Number(v.valorTotalLiquido), 0);
        const cmv = vendas.reduce((s, v) => s + Number(v.cmvTotal), 0);
        const ticketMedio = totalVendas > 0 ? receita / totalVendas : 0;

        return { totalVendas, totalItens, receita, cmv, margem: receita > 0 ? ((receita - cmv) / receita * 100) : 0, ticketMedio };
      };

      const [periodo1, periodo2] = await Promise.all([
        buscarPeriodo(dataInicio1 as string, dataFim1 as string),
        buscarPeriodo(dataInicio2 as string, dataFim2 as string),
      ]);

      res.json({ periodo1, periodo2 });
    
  }, "comparativo");

  abcCurve = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { dataInicio, dataFim } = req.query;
      let dateFilter = undefined;
      if (dataInicio && dataFim) {
        const d = buildDateRange(dataInicio as string, dataFim as string);
        dateFilter = { gte: d.firstDay, lte: d.lastDay };
      }

      const saleItems = await prisma.saleItem.findMany({
        where: {
          sale: { storeId, status: { not: 'CANCELADA' }, ...(dateFilter ? { dataVenda: dateFilter } : {}) },
        },
        include: { product: { select: { id: true, nome: true, precoCusto: true } } },
      });

      const aggregated = new Map<string, { nome: string; receita: number; custo: number; qtd: number }>();
      for (const item of saleItems) {
        const key = item.productId;
        const existing = aggregated.get(key) || { nome: item.product.nome, receita: 0, custo: 0, qtd: 0 };
        existing.receita += Number(item.precoUnitarioVendido) * Number(item.quantidade);
        existing.custo += Number(item.custoUnitarioHistorico) * Number(item.quantidade);
        existing.qtd += Number(item.quantidade);
        aggregated.set(key, existing);
      }

      const sorted = Array.from(aggregated.entries())
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.receita - a.receita);

      const totalReceita = sorted.reduce((s, p) => s + p.receita, 0);

      let acum = 0;
      const classified = sorted.map(p => {
        acum += p.receita;
        const pct = totalReceita > 0 ? (acum / totalReceita) * 100 : 0;
        return {
          ...p,
          receita: Math.round(p.receita * 100) / 100,
          custo: Math.round(p.custo * 100) / 100,
          margem: p.receita > 0 ? Math.round(((p.receita - p.custo) / p.receita) * 10000) / 100 : 0,
          classificacao: pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C',
          participacao: totalReceita > 0 ? Math.round((p.receita / totalReceita) * 10000) / 100 : 0,
        };
      });

      const resumo = { a: 0, b: 0, c: 0, receitaA: 0, receitaB: 0, receitaC: 0 };
      classified.forEach(p => {
        resumo[p.classificacao.toLowerCase() as 'a' | 'b' | 'c']++;
        resumo[`receita${p.classificacao}` as 'receitaA' | 'receitaB' | 'receitaC'] += p.receita;
      });

      res.json({ produtos: classified, resumo, totalReceita: Math.round(totalReceita * 100) / 100 });
    
  }, "abc curve");

  profitability = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { dataInicio, dataFim } = req.query;
      let dateFilter = undefined;
      if (dataInicio && dataFim) {
        const d = buildDateRange(dataInicio as string, dataFim as string);
        dateFilter = { gte: d.firstDay, lte: d.lastDay };
      }

      const categories = await prisma.category.findMany({
        where: { storeId },
        select: { id: true, nome: true, margemLucroPadrao: true },
      });

      const saleItems = await prisma.saleItem.findMany({
        where: {
          sale: { storeId, status: { not: 'CANCELADA' }, ...(dateFilter ? { dataVenda: dateFilter } : {}) },
        },
        include: { product: { select: { categoryId: true } } },
      });

      const catMap = new Map(categories.map(c => [c.id, c.nome]));

      const aggregated = new Map<string, { receita: number; custo: number; qtd: number }>();
      for (const item of saleItems) {
        const catId = item.product.categoryId;
        const existing = aggregated.get(catId) || { receita: 0, custo: 0, qtd: 0 };
        existing.receita += Number(item.precoUnitarioVendido) * Number(item.quantidade);
        existing.custo += Number(item.custoUnitarioHistorico) * Number(item.quantidade);
        existing.qtd += Number(item.quantidade);
        aggregated.set(catId, existing);
      }

      const result = Array.from(aggregated.entries()).map(([catId, data]) => ({
        categoriaId: catId,
        categoria: catMap.get(catId) || 'Sem categoria',
        receita: Math.round(data.receita * 100) / 100,
        custo: Math.round(data.custo * 100) / 100,
        lucro: Math.round((data.receita - data.custo) * 100) / 100,
        margem: data.receita > 0 ? Math.round(((data.receita - data.custo) / data.receita) * 10000) / 100 : 0,
        qtd: data.qtd,
      })).sort((a, b) => b.receita - a.receita);

      const total = result.reduce((s, r) => ({ receita: s.receita + r.receita, custo: s.custo + r.custo, lucro: s.lucro + r.lucro }), { receita: 0, custo: 0, lucro: 0 });

      res.json({ categorias: result, total: { ...total, margem: total.receita > 0 ? Math.round((total.lucro / total.receita) * 10000) / 100 : 0 } });
    
  }, "profitability");

  salesHeatmap = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { dataInicio, dataFim } = req.query;
      let dateFilter: any;
      if (dataInicio && dataFim) {
        const d = buildDateRange(dataInicio as string, dataFim as string);
        dateFilter = { gte: d.firstDay, lte: d.lastDay };
      } else {
        const d = buildDateRange();
        dateFilter = { gte: d.firstDay, lte: d.lastDay };
      }

      const sales = await prisma.sale.findMany({
        where: { storeId,           status: { not: 'CANCELADA' }, dataVenda: dateFilter },
        select: { dataVenda: true, valorTotalLiquido: true },
      });

      const porDiaSemana = Array(7).fill(0);
      const porHora = Array(24).fill(0);
      const porDiaMes = Array(31).fill(0);
      let totalDias = 0;

      for (const sale of sales) {
        const d = new Date(sale.dataVenda);
        porDiaSemana[d.getDay()]++;
        porHora[d.getHours()]++;
        porDiaMes[d.getDate() - 1]++;
        totalDias = Math.max(totalDias, d.getDate());
      }

      const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

      res.json({
        porDiaSemana: diasSemana.map((nome, i) => ({ nome, vendas: porDiaSemana[i] })),
        porHora: porHora.map((vendas, hora) => ({ hora: `${hora}h`, vendas })),
        porDiaMes: porDiaMes.slice(0, totalDias).map((vendas, dia) => ({ dia: dia + 1, vendas })),
      });
    
  }, "registrar venda s heatmap");

  topFlop = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { dataInicio, dataFim, limit } = req.query;
      let dateFilter = undefined;
      if (dataInicio && dataFim) {
        const d = buildDateRange(dataInicio as string, dataFim as string);
        dateFilter = { gte: d.firstDay, lte: d.lastDay };
      }
      const maxResults = Number(limit) || 10;

      const saleItems = await prisma.saleItem.findMany({
        where: {
          sale: { storeId,           status: { not: 'CANCELADA' }, ...(dateFilter ? { dataVenda: dateFilter } : {}) },
        },
        include: { product: { select: { id: true, nome: true, precoCusto: true, imageUrl: true, category: { select: { nome: true } } } } },
      });

      const aggregated = new Map<string, { nome: string; imageUrl: string | null; categoria: string; receita: number; custo: number; qtd: number }>();
      for (const item of saleItems) {
        const key = item.productId;
        const existing = aggregated.get(key) || {
          nome: item.product.nome,
          imageUrl: item.product.imageUrl,
          categoria: item.product.category?.nome || '',
          receita: 0, custo: 0, qtd: 0,
        };
        existing.receita += Number(item.precoUnitarioVendido) * Number(item.quantidade);
        existing.custo += Number(item.custoUnitarioHistorico) * Number(item.quantidade);
        existing.qtd += Number(item.quantidade);
        aggregated.set(key, existing);
      }

      const entries = Array.from(aggregated.entries()).map(([id, v]) => ({ id, ...v, receita: Math.round(v.receita * 100) / 100 }));

      const top = entries.sort((a, b) => b.receita - a.receita).slice(0, maxResults);
      const flop = entries.sort((a, b) => a.receita - b.receita).slice(0, maxResults);

      res.json({ top, flop });
    
  }, "top flop");
}
