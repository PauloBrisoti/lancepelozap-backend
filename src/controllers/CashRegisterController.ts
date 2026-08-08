import { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { asyncHandler } from "../lib/asyncHandler";
import { prisma } from '../lib/prisma';

export class CashRegisterController {
  open = asyncHandler(async (req: Request, res: Response) => {
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
    
  }, "abrir");

  close = asyncHandler(async (req: Request, res: Response) => {
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

      // Em CREDIARIO só o sinal entra de fato no caixa; o restante vai para AccountReceivable.
      const salesForBalance = await prisma.sale.findMany({
        where: { cashRegisterId: cashRegister.id, status: 'FINALIZADA' },
        select: { formaPagamento: true, valorTotalLiquido: true, valorSinal: true },
      });
      const totalRecebidoEmCaixa = salesForBalance.reduce((acc, s) => {
        const valorRecebido = s.formaPagamento === 'CREDIARIO'
          ? Number(s.valorSinal)
          : Number(s.valorTotalLiquido);
        return acc + valorRecebido;
      }, 0);

      const transactions = await prisma.cashTransaction.findMany({
        where: { cashRegisterId: cashRegister.id },
      });

      let saldoEsperado = Number(cashRegister.valorTrocoInicial) + totalRecebidoEmCaixa;
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
    
  }, "fechar");

  getCurrent = asyncHandler(async (req: Request, res: Response) => {
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

      const salesForTotal = await prisma.sale.findMany({
        where: { cashRegisterId: cashRegister.id, status: 'FINALIZADA' },
        select: { formaPagamento: true, valorTotalLiquido: true, valorSinal: true },
      });
      const totalRecebidoEmCaixa = salesForTotal.reduce((acc, s) => {
        const valorRecebido = s.formaPagamento === 'CREDIARIO'
          ? Number(s.valorSinal)
          : Number(s.valorTotalLiquido);
        return acc + valorRecebido;
      }, 0);

      res.json({
        data: {
          ...cashRegister,
          totalVendas: totalRecebidoEmCaixa,
        }
      });
    
  }, "obter current");

  getSummary = asyncHandler(async (req: Request, res: Response) => {
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
        select: { formaPagamento: true, valorTotalLiquido: true, valorSinal: true },
      });

      const byPaymentMethod: Record<string, number> = {};
      let totalVendas = 0;
      let totalRecebidoEmCaixa = 0;
      for (const s of sales) {
        const method = s.formaPagamento || 'OUTROS';
        const valorRecebido = s.formaPagamento === 'CREDIARIO' ? Number(s.valorSinal) : Number(s.valorTotalLiquido);
        byPaymentMethod[method] = (byPaymentMethod[method] || 0) + Number(s.valorTotalLiquido);
        totalVendas += Number(s.valorTotalLiquido);
        totalRecebidoEmCaixa += valorRecebido;
      }

      // Calculate expected balance
      let saldoEsperado = Number(cashRegister.valorTrocoInicial) + totalRecebidoEmCaixa;
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
    
  }, "obter summary");

  getHistory = asyncHandler(async (req: Request, res: Response) => {
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
    
  }, "obter history");

  addTransaction = asyncHandler(async (req: Request, res: Response) => {
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
    
  }, "criar transaction");
}
