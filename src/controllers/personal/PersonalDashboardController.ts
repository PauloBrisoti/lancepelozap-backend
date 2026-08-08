import { Request, Response } from 'express';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { ensureCategories, getCycleRange, getEffectiveUserId } from './helpers';

export class PersonalDashboardController {
  async dashboard(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });

      await ensureCategories(userId);

      const now = new Date();
      const mesReq = Number(req.query.mes) || (now.getMonth() + 1);
      const anoReq = Number(req.query.ano) || now.getFullYear();

      const { start: dataInicio, end: dataFim } = await getCycleRange(userId, mesReq, anoReq);

      // Previous cycle
      const mesPassado = mesReq === 1 ? 12 : mesReq - 1;
      const anoPassado = mesReq === 1 ? anoReq - 1 : anoReq;
      const { start: dataInicioPassado, end: dataFimPassado } = await getCycleRange(userId, mesPassado, anoPassado);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { monthlyBudgetLimit: true },
      });
      const monthlyBudgetLimit = Number(user?.monthlyBudgetLimit || 0);

      const [entradas, saidas, entradasPassado, saidasPassado, budgets, gastosPorCategoria, acumulado] = await Promise.all([
        prisma.personalTransaction.aggregate({
          where: { userId, tipo: 'ENTRADA', data: { gte: dataInicio, lt: dataFim } },
          _sum: { valor: true },
        }),
        prisma.personalTransaction.aggregate({
          where: { userId, tipo: 'SAIDA', data: { gte: dataInicio, lt: dataFim } },
          _sum: { valor: true },
        }),
        prisma.personalTransaction.aggregate({
          where: { userId, tipo: 'ENTRADA', data: { gte: dataInicioPassado, lt: dataFimPassado } },
          _sum: { valor: true },
        }),
        prisma.personalTransaction.aggregate({
          where: { userId, tipo: 'SAIDA', data: { gte: dataInicioPassado, lt: dataFimPassado } },
          _sum: { valor: true },
        }),
        prisma.personalBudget.findMany({
          where: { userId, mes: mesReq, ano: anoReq },
          include: { category: { select: { id: true, nome: true, icone: true, cor: true } } },
        }),
        prisma.personalTransaction.groupBy({
          by: ['categoryId'],
          where: { userId, tipo: 'SAIDA', data: { gte: dataInicio, lt: dataFim } },
          _sum: { valor: true },
        }),
        prisma.personalTransaction.groupBy({
          by: ['tipo', 'walletId'],
          where: { userId, data: { lt: dataFim } },
          _sum: { valor: true },
        }),
      ]);

      const totalEntradas = Number(entradas._sum.valor || 0);
      const totalSaidas = Number(saidas._sum.valor || 0);
      const totalEntradasPassado = Number(entradasPassado._sum.valor || 0);
      const totalSaidasPassado = Number(saidasPassado._sum.valor || 0);
      const sobraMes = totalEntradas - totalSaidas;

      const categoriasComGasto = await Promise.all(
        gastosPorCategoria.map(async (g) => {
          const cat = await prisma.personalCategory.findUnique({ where: { id: g.categoryId } });
          const budget = budgets.find(b => b.categoryId === g.categoryId);
          const gasto = Number(g._sum.valor || 0);
          const limite = budget ? Number(budget.valorLimite) : 0;
          return {
            categoryId: g.categoryId,
            nome: cat?.nome || 'Desconhecida',
            icone: cat?.icone || '💵',
            cor: cat?.cor || '#6366f1',
            gasto,
            limite,
            estourou: limite > 0 && gasto > limite,
          };
        })
      );

      const categoriasEstouradas = categoriasComGasto.filter(c => c.estourou).length;

      let saudeFinanceira: 'SAUDAVEL' | 'ATENCAO' | 'PERDA_DE_CONTROLE' = 'SAUDAVEL';
      const proporcaoGastos = totalEntradas > 0 ? totalSaidas / totalEntradas : 0;
      if (proporcaoGastos > 0.85 || categoriasEstouradas >= 3) {
        saudeFinanceira = 'PERDA_DE_CONTROLE';
      } else if (proporcaoGastos > 0.7 || categoriasEstouradas >= 1) {
        saudeFinanceira = 'ATENCAO';
      }

      const variacaoEntradas = totalEntradasPassado > 0
        ? ((totalEntradas - totalEntradasPassado) / totalEntradasPassado) * 100
        : 0;
      const variacaoSaidas = totalSaidasPassado > 0
        ? ((totalSaidas - totalSaidasPassado) / totalSaidasPassado) * 100
        : 0;

      const ultimasTransacoes = await prisma.personalTransaction.findMany({
        where: { userId, data: { gte: dataInicio, lt: dataFim } },
        include: { category: { select: { id: true, nome: true, icone: true, cor: true } } },
        orderBy: { data: 'desc' },
        take: 10,
      });

      const wallets = await prisma.personalWallet.findMany({
        where: { userId },
        select: { id: true, nome: true, icone: true, saldo: true },
      });
      const saldoTotal = wallets.reduce((s, w) => s + Number(w.saldo), 0);

      const isCreditCard = (w: { nome: string; icone?: string | null }) =>
        w.icone === '💳' || w.nome.toLowerCase().includes('cartão');

      const saldosAcumuladosPorConta = wallets.map(w => {
        const entradas = acumulado.filter(a => a.tipo === 'ENTRADA' && a.walletId === w.id).reduce((s, a) => s + Number(a._sum.valor || 0), 0);
        const saidas = acumulado.filter(a => a.tipo === 'SAIDA' && a.walletId === w.id).reduce((s, a) => s + Number(a._sum.valor || 0), 0);
        return { id: w.id, nome: w.nome, saldo: entradas - saidas, isCreditCard: isCreditCard(w) };
      });

      const saldoAcumulado = saldosAcumuladosPorConta
        .filter(w => !w.isCreditCard)
        .reduce((s, w) => s + w.saldo, 0);

      return res.json({
                periodo: { mes: mesReq, ano: anoReq },
                ganhos: totalEntradas,
                gastos: totalSaidas,
                entradasMes: totalEntradas,
                saidasMes: totalSaidas,
                receitasMes: totalEntradas,
                despesasMes: totalSaidas,
                wallets,
                saldosPorConta: wallets.map(w => ({ id: w.id, nome: w.nome, saldo: w.saldo })),
                saldoTotal,
                sobraMes,
                saldoAcumulado,
                saldosAcumuladosPorConta,
                variacaoGanhos: Math.round(variacaoEntradas * 100) / 100,
                variacaoGastos: Math.round(variacaoSaidas * 100) / 100,
                saudeFinanceira,
                categoriasEstouradas,
                proporcaoGastos: Math.round(proporcaoGastos * 10000) / 100,
                gastosPorCategoria: categoriasComGasto,
                budgets,
                ultimasTransacoes,
                monthlyBudgetLimit,
            });
    } catch (error) {
      logger.error('Erro no dashboard PF:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  async budgetSummary(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });

      const now = new Date();
      const mes = Number(req.query.mes) || now.getMonth() + 1;
      const ano = Number(req.query.ano) || now.getFullYear();

      const { start, end } = await getCycleRange(userId, mes, ano);

      const budgets = await prisma.personalBudget.findMany({
        where: { userId, mes, ano },
        include: { category: { select: { id: true, nome: true, icone: true, cor: true } } },
      });

      const gastos = await prisma.personalTransaction.groupBy({
        by: ['categoryId'],
        where: {
          userId, tipo: 'SAIDA',
          data: { gte: start, lt: end },
        },
        _sum: { valor: true },
      });

      const resultado = budgets.map(b => {
        const gasto = gastos.find(g => g.categoryId === b.categoryId);
        const valorGasto = Number(gasto?._sum.valor || 0);
        return {
          ...b,
          valorGasto,
          percentual: Number(b.valorLimite) > 0 ? Math.round((valorGasto / Number(b.valorLimite)) * 100) : 0,
          estourou: valorGasto > Number(b.valorLimite),
        };
      });

      return res.json(resultado);
    } catch (error) {
      logger.error('Erro no resumo de orçamentos PF:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  async getCycleConfig(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { billingCycleStartDay: true, monthlyBudgetLimit: true },
      });
      return res.json({
        billingCycleStartDay: user?.billingCycleStartDay || 1,
        monthlyBudgetLimit: Number(user?.monthlyBudgetLimit || 0),
      });
    } catch (error) {
      logger.error('Erro ao buscar config de ciclo:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  async updateCycleConfig(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });
      const { billingCycleStartDay, monthlyBudgetLimit } = req.body;
      const data: any = {};
      if (billingCycleStartDay !== undefined) {
        if (billingCycleStartDay < 1 || billingCycleStartDay > 31) {
          return res.status(400).json({ error: 'Dia deve ser entre 1 e 31' });
        }
        data.billingCycleStartDay = billingCycleStartDay;
      }
      if (monthlyBudgetLimit !== undefined) {
        data.monthlyBudgetLimit = monthlyBudgetLimit;
      }
      await prisma.user.update({
        where: { id: userId },
        data,
      });
      return res.json({ billingCycleStartDay: billingCycleStartDay ?? 1, monthlyBudgetLimit });
    } catch (error) {
      logger.error('Erro ao atualizar config de ciclo:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  async upsertBudget(req: Request, res: Response) {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });

      const { categoryId, mes, ano, valorLimite } = req.body;
      if (!categoryId || !mes || !ano || valorLimite === undefined) {
        return res.status(400).json({ error: 'categoryId, mes, ano e valorLimite são obrigatórios' });
      }

      const budget = await prisma.personalBudget.upsert({
        where: { userId_categoryId_mes_ano: { userId, categoryId, mes, ano } },
        update: { valorLimite },
        create: { userId, categoryId, mes, ano, valorLimite },
      });

      return res.json(budget);
    } catch (error) {
      logger.error('Erro ao salvar orçamento PF:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }
}
