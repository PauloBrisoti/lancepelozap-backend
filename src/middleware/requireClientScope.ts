import { Request, Response, NextFunction } from "express";
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
    console.error("[scopedClientFilter] Error:", error);
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
    console.error("[requireScopedClientParam] Error:", error);
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
    console.error("[requireScopedStoreParam] Error:", error);
    res.status(500).json({ error: "Erro interno de autorização." });
  }
};
