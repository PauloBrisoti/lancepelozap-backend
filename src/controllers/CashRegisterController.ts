import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export class CashRegisterController {
  async open(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      const userId = req.user?.id;
      if (!storeId || !userId) return res.status(401).json({ message: 'Usuário ou loja não identificados' });

      const { valorTrocoInicial } = req.body;
      if (valorTrocoInicial === undefined || Number(valorTrocoInicial) < 0) {
        return res.status(400).json({ message: 'Valor do troco inicial é obrigatório e deve ser >= 0' });
      }

      const existing = await prisma.cashRegister.findFirst({
        where: { storeId, status: 'ABERTO' }
      });
      if (existing) return res.status(400).json({ message: 'Já existe um caixa aberto para esta loja' });

      const cashRegister = await prisma.cashRegister.create({
        data: {
          storeId,
          userId,
          valorTrocoInicial: Number(valorTrocoInicial),
        },
      });

      res.status(201).json({ message: 'Caixa aberto com sucesso', cashRegister });
    } catch (error: any) {
      console.error('Erro ao abrir caixa:', error);
      res.status(500).json({ message: error.message || 'Erro ao abrir caixa' });
    }
  }

  async close(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { valorTotalFechamento } = req.body;
      if (valorTotalFechamento === undefined || Number(valorTotalFechamento) < 0) {
        return res.status(400).json({ message: 'Valor total de fechamento é obrigatório' });
      }

      const cashRegister = await prisma.cashRegister.findFirst({
        where: { storeId, status: 'ABERTO' }
      });
      if (!cashRegister) return res.status(404).json({ message: 'Nenhum caixa aberto encontrado' });

      // Calculate expected balance
      const salesTotal = await prisma.sale.aggregate({
        where: { cashRegisterId: cashRegister.id, status: 'FINALIZADA' },
        _sum: { valorTotalLiquido: true },
      });

      const transactions = await prisma.cashTransaction.findMany({
        where: { cashRegisterId: cashRegister.id },
      });

      let saldoEsperado = Number(cashRegister.valorTrocoInicial) + Number(salesTotal._sum.valorTotalLiquido || 0);
      for (const t of transactions) {
        if (t.tipo === 'SUPRIMENTO') saldoEsperado += Number(t.valor);
        else if (t.tipo === 'SANGRIA') saldoEsperado -= Number(t.valor);
      }

      const declarado = Number(valorTotalFechamento);
      const diferenca = declarado - saldoEsperado;

      const updated = await prisma.cashRegister.update({
        where: { id: cashRegister.id },
        data: {
          status: 'FECHADO',
          dataFechamento: new Date(),
          valorTotalFechamento: declarado,
          saldoEsperado,
          diferenca,
        },
      });

      res.json({
        message: 'Caixa fechado com sucesso',
        cashRegister: updated,
        saldoEsperado,
        diferenca,
      });
    } catch (error: any) {
      console.error('Erro ao fechar caixa:', error);
      res.status(500).json({ message: error.message || 'Erro ao fechar caixa' });
    }
  }

  async getCurrent(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const cashRegister = await prisma.cashRegister.findFirst({
        where: { storeId, status: 'ABERTO' },
        include: {
          user: { select: { id: true, nome: true } },
          cashTransactions: { orderBy: { createdAt: 'desc' } },
          _count: { select: { sales: true } },
        },
      });

      if (!cashRegister) return res.json({ data: null });

      const salesTotal = await prisma.sale.aggregate({
        where: { cashRegisterId: cashRegister.id, status: 'FINALIZADA' },
        _sum: { valorTotalLiquido: true },
      });

      res.json({
        data: {
          ...cashRegister,
          totalVendas: Number(salesTotal._sum.valorTotalLiquido || 0),
        }
      });
    } catch (error: any) {
      console.error('Erro ao buscar caixa atual:', error);
      res.status(500).json({ message: error.message || 'Erro ao buscar caixa' });
    }
  }

  async getSummary(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const id = req.params.id as string;

      const cashRegister = await prisma.cashRegister.findFirst({
        where: { id, storeId },
        include: {
          user: { select: { id: true, nome: true } },
          cashTransactions: { orderBy: { createdAt: 'asc' } },
          _count: { select: { sales: true } },
        },
      });
      if (!cashRegister) return res.status(404).json({ message: 'Caixa não encontrado' });

      // Sales by payment method
      const sales = await prisma.sale.findMany({
        where: { cashRegisterId: id, status: 'FINALIZADA' },
        select: { formaPagamento: true, valorTotalLiquido: true },
      });

      const byPaymentMethod: Record<string, number> = {};
      let totalVendas = 0;
      for (const s of sales) {
        const method = s.formaPagamento || 'OUTROS';
        byPaymentMethod[method] = (byPaymentMethod[method] || 0) + Number(s.valorTotalLiquido);
        totalVendas += Number(s.valorTotalLiquido);
      }

      // Calculate expected balance
      let saldoEsperado = Number(cashRegister.valorTrocoInicial) + totalVendas;
      for (const t of cashRegister.cashTransactions) {
        if (t.tipo === 'SUPRIMENTO') saldoEsperado += Number(t.valor);
        else if (t.tipo === 'SANGRIA') saldoEsperado -= Number(t.valor);
      }

      res.json({
        cashRegister,
        totais: {
          totalVendas,
          quantidadeVendas: sales.length,
          trocoInicial: Number(cashRegister.valorTrocoInicial),
          saldoEsperado,
          valorDeclarado: Number(cashRegister.valorTotalFechamento || 0),
          diferenca: Number(cashRegister.diferenca || (cashRegister.valorTotalFechamento ? Number(cashRegister.valorTotalFechamento) - saldoEsperado : 0)),
          porFormaPagamento: byPaymentMethod,
        },
      });
    } catch (error: any) {
      console.error('Erro ao buscar resumo do caixa:', error);
      res.status(500).json({ message: error.message || 'Erro interno' });
    }
  }

  async getHistory(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      const [records, total] = await Promise.all([
        prisma.cashRegister.findMany({
          where: { storeId },
          orderBy: { dataAbertura: 'desc' },
          skip,
          take: limit,
          include: {
            user: { select: { id: true, nome: true } },
            _count: { select: { sales: true } },
          },
        }),
        prisma.cashRegister.count({ where: { storeId } }),
      ]);

      res.json({ data: { records, total, page, limit } });
    } catch (error: any) {
      console.error('Erro ao listar histórico de caixas:', error);
      res.status(500).json({ message: error.message || 'Erro ao listar caixas' });
    }
  }

  async addTransaction(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId;
      const userId = req.user?.id;
      if (!storeId || !userId) return res.status(401).json({ message: 'Usuário ou loja não identificados' });

      const { tipo, valor, descricao } = req.body;
      if (!tipo || !['SANGRIA', 'SUPRIMENTO'].includes(tipo)) {
        return res.status(400).json({ message: 'Tipo deve ser SANGRIA ou SUPRIMENTO' });
      }
      if (!valor || Number(valor) <= 0) {
        return res.status(400).json({ message: 'Valor deve ser positivo' });
      }

      const cashRegister = await prisma.cashRegister.findFirst({
        where: { storeId, status: 'ABERTO' }
      });
      if (!cashRegister) return res.status(404).json({ message: 'Nenhum caixa aberto encontrado' });

      const transaction = await prisma.cashTransaction.create({
        data: {
          cashRegisterId: cashRegister.id,
          tipo,
          valor: Number(valor),
          descricao: descricao || `${tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'}`,
        },
      });

      res.status(201).json({
        message: `${tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'} registrado com sucesso`,
        transaction
      });
    } catch (error: any) {
      console.error('Erro ao registrar transação de caixa:', error);
      res.status(500).json({ message: error.message || 'Erro ao registrar transação' });
    }
  }
}
