import { Request, Response, NextFunction } from 'express';
import { auditLog } from '../lib/audit';
import { prisma } from '../lib/prisma';

const MODEL_MAP: Record<string, { delegate: any; singular: string }> = {
  products: { delegate: prisma.product, singular: 'product' },
  customers: { delegate: prisma.customer, singular: 'customer' },
  categories: { delegate: prisma.category, singular: 'category' },
  sales: { delegate: prisma.sale, singular: 'sale' },
  stores: { delegate: prisma.store, singular: 'store' },
  'product-entries': { delegate: prisma.productEntry, singular: 'product_entry' },
  'cash-register': { delegate: prisma.cashRegister, singular: 'cash_register' },
  'payment-fees': { delegate: prisma.paymentMethodFee, singular: 'payment_method_fee' },
  commissions: { delegate: prisma.commissionRule, singular: 'commission_rule' },
  'commission-payments': { delegate: prisma.commissionPayment, singular: 'commission_payment' },
  inventory: { delegate: prisma.stockMovement, singular: 'stock_movement' },
  subscriptions: { delegate: prisma.subscription, singular: 'subscription' },
  suppliers: { delegate: prisma.supplier, singular: 'supplier' },
};

function extractModelKey(req: Request): string | null {
  const url = req.originalUrl || req.url;
  const match = url.match(/\/api\/([\w-]+)/);
  return match ? match[1] : null;
}

function extractIdFromUrl(url: string): string | null {
  // Match URLs like /api/categories/SOME_ID or /api/categories/SOME_ID/action
  const match = url.match(/\/api\/[\w-]+\/([\w-]+)/);
  return match ? match[1] : null;
}

function determineAction(method: string, hasId: boolean): string | null {
  if (!hasId && method === 'POST') return 'CRIAR';
  if (method === 'PUT' || method === 'PATCH') return 'ATUALIZAR';
  if (method === 'DELETE') return 'EXCLUIR';
  return null;
}

export function autoAudit() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id as string;
    if (!userId || req.method === 'GET') return next();

    const modelKey = extractModelKey(req);
    if (!modelKey) return next();

    const config = MODEL_MAP[modelKey];
    if (!config) return next();

    const id = req.params.id || extractIdFromUrl(req.originalUrl || req.url);
    const acao = determineAction(req.method, !!id);
    if (!acao) return next();

    if (id && (acao === 'ATUALIZAR' || acao === 'EXCLUIR')) {
      try {
        (req as any).__oldData = await config.delegate.findUnique({ where: { id } });
      } catch { /* ignore */ }
    }

    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        auditLog({
          storeId: req.user?.storeId,
          userId,
          acao,
          tabelaAfetada: config.singular,
          dadosAntigos: (req as any).__oldData || undefined,
          dadosNovos: acao === 'EXCLUIR' ? undefined : req.body,
        }).catch(console.error);
      }
    });

    next();
  };
}
