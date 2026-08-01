import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

interface JwtPayload {
  id: string;
  storeId: string;
  role: string;
  clientId?: string;
  tenant_id?: string;
  isImpersonating?: boolean;
  allowedStoreIds?: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    res.status(500).json({ error: "Erro de configuração de servidor" });
    return;
  }

  // SUPER_ADMIN sempre passa — checa adminToken primeiro
  if (req.cookies?.adminToken) {
    try {
      const payload = jwt.verify(req.cookies.adminToken, JWT_SECRET) as JwtPayload;
      if (payload.role === "SUPER_ADMIN") {
        req.user = payload;
        return next();
      }
    } catch {
      // adminToken inválido/expirado — continua para authToken
    }
  }

  // Fallback: authToken (lojista)
  if (req.cookies?.authToken) {
    try {
      const payload = jwt.verify(req.cookies.authToken, JWT_SECRET) as JwtPayload;
      const requestedStoreId = (req.headers["x-workspace-id"] || req.headers["x-store-id"]) as string;

      if (requestedStoreId && requestedStoreId !== "null" && requestedStoreId !== "undefined") {
        if (payload.isImpersonating) {
        } else if (payload.role === "SUPER_ADMIN") {
          payload.storeId = requestedStoreId;
        } else if (payload.allowedStoreIds?.includes(requestedStoreId)) {
          payload.storeId = requestedStoreId;
        } else {
          return res.status(403).json({ error: "Acesso negado a esta loja" });
        }
      }

      if (payload.tenant_id && !payload.storeId) {
        payload.storeId = payload.tenant_id;
      }

      req.user = payload;

      if (payload.role === "SUPER_ADMIN" || payload.isImpersonating) {
        return next();
      }

      if (await checkActiveSubscription(payload.clientId, payload.storeId, payload.allowedStoreIds)) {
        return next();
      }

      return res.status(403).json({
        error: "Acesso bloqueado. Assinatura vencida. Renove seu plano para continuar usando o sistema.",
        code: "SUBSCRIPTION_EXPIRED"
      });
    } catch {
      return res.status(403).json({ error: "Token inválido ou expirado" });
    }
  }

  res.status(401).json({ error: "Acesso negado. Não autenticado." });
}

async function checkActiveSubscription(
  clientId: string | undefined,
  storeId: string | undefined,
  allowedStoreIds: string[] | undefined
): Promise<boolean> {
  let cid = clientId;

  // Se não tem clientId direto, busca pelo storeId
  if (!cid && storeId) {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      include: { control: { select: { clientId: true } } }
    });
    cid = store?.control?.clientId;
  }

  // Se ainda não achou, tenta pelo primeiro allowedStoreId
  if (!cid && allowedStoreIds?.length) {
    const store = await prisma.store.findUnique({
      where: { id: allowedStoreIds[0] },
      include: { control: { select: { clientId: true } } }
    });
    cid = store?.control?.clientId;
  }

  if (!cid) return true;

  const sub = await prisma.subscription.findFirst({
    where: { clientId: cid },
    orderBy: { createdAt: "desc" }
  });

  if (!sub) return true;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const venc = new Date(sub.dataVencimento);
  venc.setHours(0, 0, 0, 0);

  const vencido = venc < hoje;

  // PENDENTE: nunca libera acesso — aguarda pagamento
  if (sub.statusPagamento === "PENDENTE") {
    return false;
  }

  // INADIMPLENTE / VENCIDO: bloqueia
  if (sub.statusPagamento === "INADIMPLENTE" || sub.statusPagamento === "VENCIDO") {
    return false;
  }

  // TRIAL: só libera se dentro do prazo
  if (sub.statusPagamento === "TRIAL" && vencido) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { statusPagamento: "INADIMPLENTE" }
    }).catch(() => {});
    return false;
  }

  // PAGO: verifica se não está vencido (segurança extra)
  if (sub.statusPagamento === "PAGO" && vencido) {
    return false;
  }

  return true;
}
