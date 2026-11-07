import path from 'path';
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler, getStoreId, HttpError } from '../lib/asyncHandler';
import { BankStatementService } from '../services/BankStatementService';

const ALLOWED_EXTENSIONS = new Set(['.csv', '.ofx']);

function decodeContent(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  return utf8.includes('\uFFFD') ? buffer.toString('latin1') : utf8;
}

function validateStatementFile(file: Express.Multer.File): void {
  const extension = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new HttpError('Envie um arquivo .csv ou .ofx.', 400);
  }
  if (file.buffer.includes(0)) {
    throw new HttpError('Arquivo inválido: o conteúdo não é um extrato textual.', 400);
  }
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

function linkPayload(req: Request): string | null {
  const body = req.body ?? {};
  const hasField = Object.prototype.hasOwnProperty.call(body, 'financialTransactionId')
    || Object.prototype.hasOwnProperty.call(body, 'transactionId');

  if (!hasField) {
    throw new HttpError('Informe financialTransactionId (ou null para desconciliação).', 400);
  }

  const raw = body.financialTransactionId !== undefined
    ? body.financialTransactionId
    : body.transactionId;

  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') {
    throw new HttpError('financialTransactionId deve ser uma string ou null.', 400);
  }

  return raw.trim() ? raw.trim() : null;
}

export class BankStatementController {
  static importStatement = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);

    if (!req.file) {
      throw new HttpError('Arquivo do extrato não fornecido.', 400);
    }

    validateStatementFile(req.file);

    const walletId = typeof req.body?.walletId === 'string' && req.body.walletId.trim()
      ? req.body.walletId.trim()
      : undefined;

    const result = await BankStatementService.importStatement({
      storeId,
      walletId,
      filename: req.file.originalname,
      banco: typeof req.body?.banco === 'string' ? req.body.banco : undefined,
      content: decodeContent(req.file.buffer),
    });

    return res.status(201).json(result);
  }, 'importar extrato bancário');

  static reconcile = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const { importId, dateToleranceDays } = req.body ?? {};
    const param = req.params.importId;
    const importIdParam = Array.isArray(param) ? param[0] : param;

    const result = await BankStatementService.reconcile(storeId, {
      importId: typeof importId === 'string' && importId.trim()
        ? importId
        : (typeof importIdParam === 'string' && importIdParam.trim() ? importIdParam : undefined),
      dateToleranceDays: dateToleranceDays === undefined ? undefined : Number(dateToleranceDays),
    });

    return res.json(result);
  }, 'conciliar extrato bancário');

  static updateItem = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const itemId = routeParam(req, 'itemId');

    const item = await BankStatementService.setItemLink({
      storeId,
      itemId,
      financialTransactionId: linkPayload(req),
    });

    return res.json(item);
  }, 'vincular item do extrato bancário');

  static linkItem = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const itemId = routeParam(req, 'itemId');
    const body = req.body ?? {};
    const raw = body.financialTransactionId ?? body.transactionId;

    if (typeof raw !== 'string' || !raw.trim()) {
      throw new HttpError('Informe financialTransactionId.', 400);
    }

    const item = await BankStatementService.setItemLink({
      storeId,
      itemId,
      financialTransactionId: raw.trim(),
    });

    return res.json(item);
  }, 'vincular item do extrato bancário');

  static unlinkItem = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const itemId = routeParam(req, 'itemId');

    const item = await BankStatementService.setItemLink({
      storeId,
      itemId,
      financialTransactionId: null,
    });

    return res.json(item);
  }, 'desvincular item do extrato bancário');

  static deleteImport = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const importId = routeParam(req, 'importId');

    const result = await BankStatementService.deleteImport(storeId, importId);

    return res.json(result);
  }, 'excluir importação de extrato');

  static listImports = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);

    const [imports, reconciledGroups] = await Promise.all([
      prisma.bankStatementImport.findMany({
        where: { storeId },
        orderBy: { importedAt: 'desc' },
        include: {
          _count: { select: { items: true } },
          wallet: { select: { id: true, nome: true, tipo: true } },
        },
      }),
      prisma.bankStatementItem.groupBy({
        by: ['importId'],
        where: { import: { storeId }, conciliado: true },
        _count: { _all: true },
      }),
    ]);

    const reconciledByImport = new Map(
      reconciledGroups.map((group) => [group.importId, group._count._all]),
    );

    return res.json(imports.map((bankImport) => {
      const totalItems = bankImport._count.items;
      const reconciledItems = reconciledByImport.get(bankImport.id) ?? 0;
      const { _count, ...rest } = bankImport;

      return {
        ...rest,
        totalItems,
        reconciledItems,
        pendingItems: totalItems - reconciledItems,
      };
    }));
  }, 'listar importações de extratos');

  static listItems = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const importIdParam = req.params.importId;
    const importId = Array.isArray(importIdParam) ? importIdParam[0] : importIdParam;
    const { conciliado } = req.query;

    const bankImport = await prisma.bankStatementImport.findFirst({
      where: { id: importId, storeId },
      include: { wallet: { select: { id: true, nome: true, tipo: true } } },
    });

    if (!bankImport) {
      throw new HttpError('Importação de extrato não encontrada.', 404);
    }

    const where: any = { importId };
    if (conciliado === 'true' || conciliado === 'false') {
      where.conciliado = conciliado === 'true';
    }

    const items = await prisma.bankStatementItem.findMany({
      where,
      orderBy: [{ data: 'asc' }, { id: 'asc' }],
      include: {
        financialTransaction: {
          select: {
            id: true,
            descricao: true,
            valor: true,
            tipo: true,
            dataTransacao: true,
            wallet: { select: { nome: true } },
          },
        },
      },
    });

    return res.json({ import: bankImport, items });
  }, 'listar itens do extrato bancário');
}
