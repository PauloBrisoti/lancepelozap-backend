import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { ensureCategories, getCycleRange, getEffectiveUserId } from './helpers';

const CATEGORIAS_FIXAS = ['Moradia', 'Saúde', 'Educação', 'Assinaturas', 'Impostos', 'Pensão', 'Água', 'Luz', 'Aluguel', 'Condomínio', 'Transporte'];
const CATEGORIAS_SUPERFLUAS = ['Compras', 'Lazer', 'Delivery', 'Adega', 'Ifood', 'Restaurante', 'Assinatura Streaming', 'Vestuário', 'Beleza', 'Presente', 'Jogos'];
const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export class PersonalAIAnalysisController {
  async analysis(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });
      await ensureCategories(userId);

      const now = new Date();
      const mesReq = Number(req.query.mes) || (now.getMonth() + 1);
      const anoReq = Number(req.query.ano) || now.getFullYear();
      const diaAtual = now.getDate();

      const { start: dataInicio, end: dataFim } = await getCycleRange(userId, mesReq, anoReq);

      const [transacoes, budgets, entradasMes, entradasComCategoria] = await Promise.all([
        prisma.personalTransaction.findMany({
          where: { userId, tipo: 'SAIDA', data: { gte: dataInicio, lt: dataFim } },
          include: { category: { select: { id: true, nome: true, icone: true } } },
        }),
        prisma.personalBudget.findMany({
          where: { userId, mes: mesReq, ano: anoReq },
          include: { category: { select: { id: true, nome: true, icone: true } } },
        }),
        prisma.personalTransaction.aggregate({
          where: { userId, tipo: 'ENTRADA', data: { gte: dataInicio, lt: dataFim } },
          _sum: { valor: true },
        }),
        prisma.personalTransaction.findMany({
          where: { userId, tipo: 'ENTRADA', data: { gte: dataInicio, lt: dataFim } },
          include: { category: { select: { id: true, nome: true, icone: true } } },
        }),
      ]);

      const totalEntradas = Number(entradasMes._sum.valor || 0);
      const totalSaidas = transacoes.reduce((s, t) => s + Number(t.valor), 0);
      const sobraMes = totalEntradas - totalSaidas;

      // Aggregate gastos por categoria
      const gastoPorCat: Record<string, { nome: string; icone: string; total: number }> = {};
      for (const t of transacoes) {
        if (!gastoPorCat[t.categoryId]) {
          gastoPorCat[t.categoryId] = { nome: t.category.nome, icone: t.category.icone || '💵', total: 0 };
        }
        gastoPorCat[t.categoryId].total += Number(t.valor);
      }

      const gastosPorCategoria = Object.values(gastoPorCat).map(g => ({
        nome: g.nome,
        icone: g.icone,
        atual: g.total,
        passado: 0,
      }));

      // Filtra apenas categorias variáveis (exclui fixas)
      const gastosVariaveis: { nome: string; icone: string; total: number; orcamento?: number }[] = [];
      for (const [catId, g] of Object.entries(gastoPorCat)) {
        const isFixa = CATEGORIAS_FIXAS.some(f => g.nome.toLowerCase().includes(f.toLowerCase()));
        if (!isFixa) {
          const budget = budgets.find(b => b.categoryId === catId);
          gastosVariaveis.push({
            nome: g.nome,
            icone: g.icone,
            total: g.total,
            orcamento: budget ? Number(budget.valorLimite) : undefined,
          });
        }
      }

      const insights: string[] = [];

      // ---------- REGRA 1: Burn Rate (>80% antes do dia 20) ----------
      if (diaAtual <= 20) {
        for (const gv of gastosVariaveis) {
          if (gv.orcamento && gv.orcamento > 0) {
            const pct = Math.round((gv.total / gv.orcamento) * 100);
            if (pct > 80) {
              const dica = CATEGORIAS_SUPERFLUAS.some(s => gv.nome.toLowerCase().includes(s.toLowerCase()))
                ? `Que tal substituir por versões mais econômicas ou reduzir a frequência?`
                : `Distribua o restante do orçamento ao longo dos próximos dias para não estourar.`;
              insights.push(`💡 Atenção: Você já consumiu ${pct}% do seu orçamento de ${gv.nome}, mas o mês ainda está na metade. ${dica}`);
            }
          }
        }
      }

      // ---------- REGRA 2: Vilão do Mês (se regra 1 não disparou) ----------
      if (insights.length === 0 && gastosVariaveis.length > 0) {
        const vilao = [...gastosVariaveis].sort((a, b) => b.total - a.total)[0];
        const dica = CATEGORIAS_SUPERFLUAS.some(s => vilao.nome.toLowerCase().includes(s.toLowerCase()))
          ? `Estabeleça um teto semanal para ${vilao.nome} e evite compras por impulso.`
          : `Defina um orçamento mensal para ${vilao.nome} e monitore semanalmente.`;
        insights.push(`🔍 De olho no vazamento: Seus gastos com ${vilao.nome} representam a maior fatia do seu consumo variável (${fmtBRL(vilao.total)}). ${dica}`);
      }

      // ---------- REGRA 3: Parabéns (se todas < 50% e já passou dia 20) ----------
      if (insights.length === 0 && diaAtual >= 20 && gastosVariaveis.length > 0) {
        const todasAbaixo = gastosVariaveis.every(gv => {
          if (gv.orcamento && gv.orcamento > 0) {
            return (gv.total / gv.orcamento) < 0.5;
          }
          return gv.total < (totalSaidas / gastosVariaveis.length) * 0.5;
        });
        if (todasAbaixo) {
          insights.push(`🚀 Excelente controle! Seus gastos estão bem abaixo do limite. Mantenha o ritmo nesta última semana para turbinar seus investimentos.`);
        }
      }

      // ---------- INSIGHT DE GANHOS ----------
      const insightsGanhos: string[] = [];
      const extras: { nome: string; total: number }[] = [];
      for (const e of entradasComCategoria) {
        const isSalario = e.category.nome.toLowerCase().includes('salário') || e.category.nome.toLowerCase().includes('salario');
        if (!isSalario) {
          const idx = extras.findIndex(x => x.nome === e.category.nome);
          if (idx >= 0) extras[idx].total += Number(e.valor);
          else extras.push({ nome: e.category.nome, total: Number(e.valor) });
        }
      }
      if (extras.length > 0) {
        extras.sort((a, b) => b.total - a.total);
        for (const ex of extras) {
          insightsGanhos.push(`🚀 Boa notícia: Você registrou ${fmtBRL(ex.total)} extras com ${ex.nome} este mês.`);
        }
      } else if (entradasComCategoria.length > 0) {
        insightsGanhos.push(`📈 Seus ganhos estão consolidados em ${fmtBRL(totalEntradas)} neste ciclo.`);
      } else {
        insightsGanhos.push(`📥 Nenhum ganho registrado neste ciclo.`);
      }

      // Fallback: se nenhuma regra disparou
      if (insights.length === 0) {
        if (gastosPorCategoria.length > 0 && gastosVariaveis.length === 0) {
          const nomes = gastosPorCategoria.map(g => g.nome).join(', ');
          insights.push(`📋 Seus gastos estão concentrados em categorias fixas (${nomes}). Defina orçamentos para categorias variáveis como Alimentação e Lazer para ter mais controle financeiro.`);
        } else if (sobraMes > 0) {
          insights.push(`📊 Saldo positivo de ${fmtBRL(sobraMes)}. Cadastre gastos variáveis (Alimentação, Lazer, Compras) para receber alertas personalizados.`);
        } else if (sobraMes < 0) {
          insights.push(`⚠️ Suas despesas (${fmtBRL(totalSaidas)}) superaram sua renda (${fmtBRL(totalEntradas)}). Reveja gastos não essenciais urgentemente.`);
        } else {
          insights.push(`📊 Você está no equilíbrio. Registre mais transações de categorias variáveis para receber insights detalhados.`);
        }
      }

      return res.json({
        periodo: `${mesReq}/${anoReq}`,
        totalGanhos: totalEntradas,
        totalGastos: totalSaidas,
        sobraMes,
        gastosPorCategoria,
        insights,
        insightsGanhos,
        dicaInvestimento: sobraMes > 0 ? {
          reservaEmergencia: sobraMes * 0.5,
          curtoPrazo: sobraMes * 0.3,
          longoPrazo: sobraMes * 0.2,
          mensagem: `Com ${fmtBRL(sobraMes)} de sobra, sugerimos: 50% (${fmtBRL(sobraMes * 0.5)}) para reserva de emergência, 30% (${fmtBRL(sobraMes * 0.3)}) para metas de curto prazo e 20% (${fmtBRL(sobraMes * 0.2)}) para aportes de longo prazo.`,
        } : null,
      });
    } catch (error) {
      console.error('Erro na análise IA PF:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }
}
