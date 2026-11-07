import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler, getStoreId } from '../lib/asyncHandler';
import { PeriodCloseService } from '../services/PeriodCloseService';
import { AccountingService } from '../services/AccountingService';
import { TaxRetentionService, TaxRetentionType } from '../services/TaxRetentionService';
import { buildDateRange } from '../lib/dateUtils';

export class AccountingController {
  // ==========================================
  // PLANO DE CONTAS (CHART OF ACCOUNTS)
  // ==========================================

  static listAccounts = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    await AccountingService.ensureDefaultAccounts(storeId);

    const accounts = await prisma.chartOfAccount.findMany({
      where: {
        OR: [{ storeId }, { storeId: null }],
        ativo: true,
      },
      orderBy: { codigo: 'asc' },
    });

    return res.json(accounts);
  }, 'listar plano de contas');

  static createAccount = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const { codigo, nome, tipo, natureza, nivel = 4, isSintetica = false } = req.body;

    if (!codigo || !nome || !tipo || !natureza) {
      return res.status(400).json({ message: 'codigo, nome, tipo e natureza são obrigatórios' });
    }

    const existing = await prisma.chartOfAccount.findFirst({
      where: { storeId, codigo },
    });

    if (existing) {
      return res.status(409).json({ message: `Conta com código ${codigo} já existe nesta loja.` });
    }

    const account = await prisma.chartOfAccount.create({
      data: {
        storeId,
        codigo,
        nome,
        tipo,
        natureza,
        nivel: Number(nivel),
        isSintetica: Boolean(isSintetica),
        ativo: true,
      },
    });

    return res.status(201).json(account);
  }, 'criar conta contábil');

  // ==========================================
  // PARTIDAS DOBRADAS (JOURNAL ENTRIES)
  // ==========================================

  static listJournalEntries = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const { startDate, endDate, page = 1, limit = 50 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { storeId };

    if (startDate && endDate) {
      const { firstDay, lastDay } = buildDateRange(startDate as string, endDate as string);
      where.dataLancamento = { gte: firstDay, lte: lastDay };
    }

    const [records, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { dataLancamento: 'desc' },
        include: {
          lines: {
            include: { account: { select: { codigo: true, nome: true, tipo: true } } },
          },
        },
      }),
      prisma.journalEntry.count({ where }),
    ]);

    return res.json({ records, total, page: Number(page), limit: Number(limit) });
  }, 'listar lançamentos contábeis');

  static createManualEntry = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const userId = req.user?.id;
    const { dataLancamento = new Date(), descricao, lines } = req.body;

    if (!descricao || !lines || !Array.isArray(lines)) {
      return res.status(400).json({ message: 'descricao e lines são obrigatórios.' });
    }

    // Valida período aberto
    await PeriodCloseService.assertPeriodIsOpen(storeId, dataLancamento, undefined, 'lançamento contábil');

    const entry = await prisma.$transaction(async (tx) => {
      return AccountingService.recordJournalEntry(tx, {
        storeId,
        dataLancamento: new Date(dataLancamento),
        descricao,
        origemTipo: 'MANUAL',
        criadoPor: userId,
        lines,
      });
    });

    return res.status(201).json(entry);
  }, 'criar lançamento contábil manual');

  // ==========================================
  // FECHAMENTO DE PERÍODO (PERIOD CLOSE)
  // ==========================================

  static listPeriodCloses = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const closes = await PeriodCloseService.list(storeId);
    return res.json(closes);
  }, 'listar fechamentos contábeis');

  static closePeriod = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const userId = req.user?.id || 'sistema';
    const { ano, mes, observacao } = req.body;

    if (!ano || !mes) {
      return res.status(400).json({ message: 'ano e mes são obrigatórios.' });
    }

    const result = await PeriodCloseService.closePeriod({
      storeId,
      ano: Number(ano),
      mes: Number(mes),
      userId,
      observacao,
    });

    return res.status(201).json(result);
  }, 'fechar período contábil');

  static reopenPeriod = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const userId = req.user?.id || 'sistema';
    const { ano, mes, motivo } = req.body;

    if (!ano || !mes || !motivo) {
      return res.status(400).json({ message: 'ano, mes e motivo são obrigatórios.' });
    }

    const result = await PeriodCloseService.reopenPeriod({
      storeId,
      ano: Number(ano),
      mes: Number(mes),
      userId,
      motivo,
    });

    return res.json(result);
  }, 'reabrir período contábil');

  // ==========================================
  // RETENÇÕES FISCAIS (TAX RETENTIONS)
  // ==========================================

  static listTaxRetentions = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const { competencia, status } = req.query;

    const where: any = { storeId };
    if (competencia) where.competencia = String(competencia);
    if (status) where.status = String(status);

    const retencoes = await prisma.taxRetention.findMany({
      where,
      orderBy: { dataRetencao: 'desc' },
    });

    const totalRetido = retencoes.reduce((acc, r) => acc + Number(r.valorRetido), 0);

    return res.json({ retencoes, totalRetido });
  }, 'listar retenções fiscais');

  static createTaxRetention = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const {
      tipo,
      aliquota,
      valorBase,
      competencia,
      referenceId,
      referenciaId,
      origemTipo = 'VENDA',
    } = req.body;

    if (!tipo || !aliquota || !valorBase || !competencia) {
      return res.status(400).json({ message: 'tipo, aliquota, valorBase e competencia são obrigatórios.' });
    }

    const [retention] = await prisma.$transaction((tx) =>
      TaxRetentionService.record(
        tx,
        {
          storeId,
          referenceId: referenceId ?? referenciaId ?? null,
          origemTipo,
          valorBase: Number(valorBase),
          competencia,
          status: 'RETIDO',
        },
        [{ tipo: String(tipo).toUpperCase() as TaxRetentionType, aliquota: Number(aliquota) }]
      )
    );

    if (!retention) {
      return res.status(400).json({ message: 'Nenhuma retenção foi apurada para os dados informados.' });
    }

    return res.status(201).json(retention);
  }, 'registrar retenção fiscal');
}

