import path from 'path';
import crypto from 'node:crypto';
import { differenceInCalendarDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { prisma } from '../lib/prisma';
import { getTimezone } from '../lib/dateUtils';
import { HttpError } from '../lib/asyncHandler';
import {
  BankStatementParserService,
  BankStatementType,
  normalizeStatementType,
} from './BankStatementParserService';

const MAX_ITEMS_PER_IMPORT = 5000;
const DEFAULT_DATE_TOLERANCE_DAYS = 2;

export interface ImportBankStatementInput {
  storeId: string;
  walletId?: string;
  filename: string;
  banco?: string;
  content: string;
}

export interface ReconcileBankStatementOptions {
  importId?: string;
  dateToleranceDays?: number;
}

export interface BankStatementMatch {
  itemId: string;
  financialTransactionId: string;
  data: Date;
  valor: number;
  tipo: BankStatementType;
}

export interface ReconcileBankStatementResult {
  analyzed: number;
  reconciled: number;
  pending: number;
  matches: BankStatementMatch[];
}

export interface SetBankStatementItemLinkInput {
  storeId: string;
  itemId: string;
  financialTransactionId: string | null;
}

interface TransactionCandidate {
  id: string;
  walletId: string;
  tipo: string;
  valor: unknown;
  dataTransacao: Date;
}

function cents(value: unknown): number {
  return Math.abs(Math.round(Number(value) * 100));
}

/**
 * Hash do conteúdo do extrato (normalizando quebras de linha e espaços finais)
 * para bloquear a reimportação acidental do mesmo arquivo.
 */
function statementContentHash(content: string): string {
  return crypto
    .createHash('sha256')
    .update(content.replace(/\r\n?/g, '\n').trim(), 'utf8')
    .digest('hex');
}

function transactionDirection(tipo: string): BankStatementType | null {
  if (tipo === 'ENTRADA') return 'CREDITO';
  if (tipo === 'SAIDA') return 'DEBITO';
  return null;
}

function normalizeTolerance(value?: number): number {
  if (value === undefined) return DEFAULT_DATE_TOLERANCE_DAYS;
  if (!Number.isFinite(value) || value < 0) return DEFAULT_DATE_TOLERANCE_DAYS;
  return Math.min(Math.floor(value), 30);
}

export class BankStatementService {
  static async importStatement(input: ImportBankStatementInput) {
    const parsed = BankStatementParserService.parse(input.content, input.filename);

    if (parsed.items.length > MAX_ITEMS_PER_IMPORT) {
      throw new HttpError(
        `Extrato excede o limite de ${MAX_ITEMS_PER_IMPORT} lançamentos por importação.`,
        400,
      );
    }

    if (input.walletId) {
      const wallet = await prisma.wallet.findFirst({
        where: { id: input.walletId, storeId: input.storeId },
        select: { id: true },
      });
      if (!wallet) {
        throw new HttpError('Carteira/conta não encontrada nesta loja.', 404);
      }
    }

    const banco = (input.banco?.trim() || parsed.banco || parsed.format).slice(0, 120);
    const filename = path.basename(input.filename || 'extrato').slice(0, 255);
    const contentHash = statementContentHash(input.content);

    const duplicate = await prisma.bankStatementImport.findFirst({
      where: { storeId: input.storeId, contentHash },
      select: { filename: true, importedAt: true },
    });
    if (duplicate) {
      const importedEm = duplicate.importedAt.toLocaleString('pt-BR', { timeZone: getTimezone() });
      throw new HttpError(
        `Este extrato já foi importado em ${importedEm} (${duplicate.filename}).`,
        409,
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const bankImport = await tx.bankStatementImport.create({
        data: {
          storeId: input.storeId,
          walletId: input.walletId || null,
          filename,
          banco,
          contentHash,
        },
      });

      await tx.bankStatementItem.createMany({
        data: parsed.items.map((item) => ({
          importId: bankImport.id,
          data: item.data,
          descricao: item.descricao,
          valor: item.valor,
          tipo: item.tipo,
          conciliado: false,
        })),
      });

      return bankImport;
    });

    return {
      ...created,
      format: parsed.format,
      totalItems: parsed.items.length,
    };
  }

  /**
   * Remove uma importação e todos os seus itens (cascade).
   * Lançamentos financeiros não são afetados: o vínculo morre com o item.
   */
  static async deleteImport(storeId: string, importId: string) {
    const bankImport = await prisma.bankStatementImport.findFirst({
      where: { id: importId, storeId },
      select: { id: true, _count: { select: { items: true } } },
    });

    if (!bankImport) {
      throw new HttpError('Importação de extrato não encontrada.', 404);
    }

    await prisma.bankStatementImport.delete({ where: { id: bankImport.id } });

    return { id: bankImport.id, deletedItems: bankImport._count.items };
  }

  static async setItemLink(input: SetBankStatementItemLinkInput) {
    const item = await prisma.bankStatementItem.findFirst({
      where: { id: input.itemId, import: { storeId: input.storeId } },
      select: { id: true, import: { select: { walletId: true } } },
    });

    if (!item) {
      throw new HttpError('Item do extrato não encontrado.', 404);
    }

    if (!input.financialTransactionId) {
      return prisma.bankStatementItem.update({
        where: { id: input.itemId },
        data: { conciliado: false, financialTransactionId: null },
        include: { financialTransaction: true },
      });
    }

    const transaction = await prisma.financialTransaction.findFirst({
      where: { id: input.financialTransactionId, storeId: input.storeId },
      select: { id: true, status: true, walletId: true },
    });

    if (!transaction) {
      throw new HttpError('Lançamento financeiro não encontrado nesta loja.', 404);
    }

    if (transaction.status !== 'ATIVA') {
      throw new HttpError('Apenas lançamentos financeiros ativos podem ser conciliados.', 409);
    }

    if (item.import.walletId && transaction.walletId !== item.import.walletId) {
      throw new HttpError('O lançamento pertence a outra carteira/conta bancária.', 409);
    }

    return prisma.$transaction(async (tx) => {
      const alreadyLinked = await tx.bankStatementItem.findFirst({
        where: {
          financialTransactionId: input.financialTransactionId as string,
          id: { not: input.itemId },
        },
        select: { id: true },
      });

      if (alreadyLinked) {
        throw new HttpError('Este lançamento já está conciliado com outro item do extrato.', 409);
      }

      return tx.bankStatementItem.update({
        where: { id: input.itemId },
        data: {
          conciliado: true,
          financialTransactionId: input.financialTransactionId,
        },
        include: { financialTransaction: true },
      });
    });
  }

  static async reconcile(
    storeId: string,
    options: ReconcileBankStatementOptions = {},
  ): Promise<ReconcileBankStatementResult> {
    const tolerance = normalizeTolerance(options.dateToleranceDays);
    const timezone = getTimezone();

    if (options.importId) {
      const bankImport = await prisma.bankStatementImport.findFirst({
        where: { id: options.importId, storeId },
        select: { id: true },
      });
      if (!bankImport) {
        throw new HttpError('Importação de extrato não encontrada.', 404);
      }
    }

    const items = await prisma.bankStatementItem.findMany({
      where: {
        conciliado: false,
        financialTransactionId: null,
        import: {
          storeId,
          ...(options.importId ? { id: options.importId } : {}),
        },
      },
      orderBy: [{ data: 'asc' }, { id: 'asc' }],
      include: { import: { select: { walletId: true } } },
    });

    if (items.length === 0) {
      return { analyzed: 0, reconciled: 0, pending: 0, matches: [] };
    }

    const timestamps = items.map((item) => item.data.getTime());
    const rangeStart = new Date(Math.min(...timestamps));
    rangeStart.setUTCHours(0, 0, 0, 0);
    rangeStart.setUTCDate(rangeStart.getUTCDate() - tolerance);

    const rangeEnd = new Date(Math.max(...timestamps));
    rangeEnd.setUTCHours(23, 59, 59, 999);
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + tolerance);

    const transactions = await prisma.financialTransaction.findMany({
      where: {
        storeId,
        status: 'ATIVA',
        dataTransacao: { gte: rangeStart, lte: rangeEnd },
        bankStatementItems: { none: {} },
      },
      orderBy: [{ dataTransacao: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        walletId: true,
        tipo: true,
        valor: true,
        dataTransacao: true,
      },
    });

    const candidatesByKey = new Map<string, TransactionCandidate[]>();
    for (const transaction of transactions) {
      const direction = transactionDirection(transaction.tipo);
      if (!direction) continue;

      const key = `${direction}:${cents(transaction.valor)}`;
      const list = candidatesByKey.get(key) ?? [];
      list.push(transaction);
      candidatesByKey.set(key, list);
    }

    const usedTransactionIds = new Set<string>();
    const matches: BankStatementMatch[] = [];

    for (const item of items) {
      const tipo = normalizeStatementType(item.tipo)
        ?? (Number(item.valor) < 0 ? 'DEBITO' : 'CREDITO');

      const key = `${tipo}:${cents(item.valor)}`;
      const candidates = candidatesByKey.get(key);
      if (!candidates || candidates.length === 0) continue;

      let best: TransactionCandidate | null = null;
      let bestDiff = Number.POSITIVE_INFINITY;

      for (const candidate of candidates) {
        if (usedTransactionIds.has(candidate.id)) continue;
        if (item.import.walletId && candidate.walletId !== item.import.walletId) continue;

        const diff = Math.abs(differenceInCalendarDays(
          toZonedTime(candidate.dataTransacao, timezone),
          toZonedTime(item.data, timezone),
        ));
        if (diff > tolerance) continue;

        if (
          diff < bestDiff
          || (diff === bestDiff && best !== null && candidate.id.localeCompare(best.id) < 0)
        ) {
          best = candidate;
          bestDiff = diff;
        }
      }

      if (!best) continue;

      usedTransactionIds.add(best.id);
      matches.push({
        itemId: item.id,
        financialTransactionId: best.id,
        data: item.data,
        valor: Number(item.valor),
        tipo,
      });
    }

    const confirmedMatches: BankStatementMatch[] = [];

    if (matches.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const match of matches) {
          const updated = await tx.bankStatementItem.updateMany({
            where: {
              id: match.itemId,
              conciliado: false,
              financialTransactionId: null,
            },
            data: {
              conciliado: true,
              financialTransactionId: match.financialTransactionId,
            },
          });

          if (updated.count === 1) {
            confirmedMatches.push(match);
          }
        }
      });
    }

    return {
      analyzed: items.length,
      reconciled: confirmedMatches.length,
      pending: items.length - confirmedMatches.length,
      matches: confirmedMatches,
    };
  }
}

export async function importBankStatement(input: ImportBankStatementInput) {
  return BankStatementService.importStatement(input);
}

export async function reconcileBankStatement(
  storeId: string,
  options?: ReconcileBankStatementOptions,
) {
  return BankStatementService.reconcile(storeId, options);
}

export async function setBankStatementItemLink(input: SetBankStatementItemLinkInput) {
  return BankStatementService.setItemLink(input);
}

export async function deleteBankStatementImport(storeId: string, importId: string) {
  return BankStatementService.deleteImport(storeId, importId);
}
