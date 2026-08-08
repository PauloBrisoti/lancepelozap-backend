import { Request, Response, NextFunction } from "express";
import { logger } from '../lib/logger';
import { prisma } from "../lib/prisma";

// Obtém o clientId do escopo do papel interno do usuário
const getScopedClientId = async (req: Request): Promise<string | null> => {
  const user = req.user;
  if (!user || !user.internalRoleId) return null;
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { internalRole: { select: { clientId: true } } }
  });
  return dbUser?.internalRole?.clientId ?? null;
};

// Injeta req.scopedClientId para que listagens filtrem pelo escopo do papel
export const scopedClientFilter = async (req: Request, res: Response, next: NextFunction) => {
  try {
    (req as any).scopedClientId = await getScopedClientId(req);
    next();
  } catch (error) {
    logger.error("[scopedClientFilter] Error:", error);
    next();
  }
};

// Valida que o recurso (:id/:clientId) pertence ao escopo do papel
export const requireScopedClientParam = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await getScopedClientId(req);
    if (!scope) return next();
    const id = (req.params.id ?? req.params.clientId) as string | undefined;
    if (id && id !== scope) {
      return res.status(403).json({ error: "Acesso negado. Escopo restrito ao seu cliente." });
    }
    next();
  } catch (error) {
    logger.error("[requireScopedClientParam] Error:", error);
    res.status(500).json({ error: "Erro interno de autorização." });
  }
};

// Valida que a loja (:storeId) pertence ao escopo do papel
export const requireScopedStoreParam = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await getScopedClientId(req);
    if (!scope) return next();
    const storeId = req.params.storeId as string | undefined;
    if (!storeId) return next();
    const store = await prisma.store.findUnique({ where: { id: storeId }, select: { controlId: true } });
    if (!store) return res.status(404).json({ error: "Loja não encontrada" });
    const control = await prisma.control.findUnique({ where: { id: store.controlId }, select: { clientId: true } });
    if (!control || control.clientId !== scope) {
      return res.status(403).json({ error: "Acesso negado. Escopo restrito ao seu cliente." });
    }
    next();
  } catch (error) {
    logger.error("[requireScopedStoreParam] Error:", error);
    res.status(500).json({ error: "Erro interno de autorização." });
  }
};

// Valida que o usuário alvo (:id) pertence ao escopo do papel interno
export const requireScopedUserParam = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await getScopedClientId(req);
    if (!scope) return next();
    const userId = req.params.id as string | undefined;
    if (!userId) return next();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        clientAccess: { select: { clientId: true } },
        internalRole: { select: { clientId: true } },
      },
    });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    const userClientIds = new Set([
      ...user.clientAccess.map(ca => ca.clientId),
      ...(user.internalRole?.clientId ? [user.internalRole.clientId] : []),
    ]);
    if (!userClientIds.has(scope)) {
      return res.status(403).json({ error: 'Acesso negado. Escopo restrito ao seu cliente.' });
    }
    next();
  } catch (error) {
    logger.error("[requireScopedUserParam] Error:", error);
      return res.status(500).json({ error: 'Erro interno de autorização.' });
  }
};

// Valida que a assinatura (:id) pertence ao escopo do papel interno
export const requireScopedSubscriptionParam = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await getScopedClientId(req);
    if (!scope) return next();
    const id = req.params.id as string | undefined;
    if (!id) return next();
    const subscription = await prisma.subscription.findUnique({
      where: { id },
      select: { clientId: true },
    });
    if (!subscription) return res.status(404).json({ error: 'Assinatura não encontrada' });
    if (subscription.clientId !== scope) {
      return res.status(403).json({ error: 'Acesso negado. Escopo restrito ao seu cliente.' });
    }
    next();
  } catch (error) {
    logger.error("[requireScopedSubscriptionParam] Error:", error);
      return res.status(500).json({ error: 'Erro interno de autorização.' });
  }
};

// Valida que a fatura (:id) pertence ao escopo do papel interno
export const requireScopedInvoiceParam = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = await getScopedClientId(req);
    if (!scope) return next();
    const id = req.params.id as string | undefined;
    if (!id) return next();
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { subscription: { select: { clientId: true } } },
    });
    if (!invoice) return res.status(404).json({ error: 'Fatura não encontrada' });
    if (invoice.subscription.clientId !== scope) {
      return res.status(403).json({ error: 'Acesso negado. Escopo restrito ao seu cliente.' });
    }
    next();
  } catch (error) {
    logger.error("[requireScopedInvoiceParam] Error:", error);
      return res.status(500).json({ error: 'Erro interno de autorização.' });
  }
};
