import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { setContext } from "../lib/logger";
import { startOfDay, differenceInCalendarDays } from "date-fns";
import { getVarreduraConfig } from "../services/configuracaoFinanceira";

interface JwtPayload {
  id: string;
  storeId: string;
  role: string;
  clientId?: string;
  tenant_id?: string;
  isImpersonating?: boolean;
  allowedStoreIds?: string[];
  tv?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// Inatividade máxima permitida por sessão (configurável). Padrão: 8h —
// acima disso a sessão morre mesmo que o token (12h) ainda seja válido.
// O token absoluto de 12h continua valendo como teto.
const DEFAULT_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
// Janela de gravação de atividade: evita 1 UPDATE por request (só grava
// quando a última marca tem mais de 10 minutos)
const ACTIVITY_WRITE_WINDOW_MS = 10 * 60 * 1000;

function getIdleTimeoutMs(): number {
  const hours = Number(process.env.SESSION_IDLE_TIMEOUT_HOURS);
  if (Number.isFinite(hours) && hours > 0) return hours * 60 * 60 * 1000;
  return DEFAULT_IDLE_TIMEOUT_MS;
}

async function validateSessionState(payload: { id: string; tv?: number }) {
  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: { ativo: true, tokenVersion: true, lastActivityAt: true }
  });
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente.", status: 401 };
  }
  if (!user.ativo) {
    return { error: "Sua conta foi arquivada. Contate o suporte.", status: 403 };
  }
  if (payload.tv !== user.tokenVersion) {
    return { error: "Sessão expirada. Faça login novamente.", status: 403 };
  }
  if (user.lastActivityAt) {
    const idleMs = Date.now() - user.lastActivityAt.getTime();
    if (idleMs > getIdleTimeoutMs()) {
      return { error: "Sessão expirada por inatividade. Faça login novamente.", status: 403 };
    }
  }

  // Registra atividade com janela de 10 min (fire-and-forget, não bloqueia o request)
  prisma.user.updateMany({
    where: {
      id: payload.id,
      OR: [
        { lastActivityAt: null },
        { lastActivityAt: { lt: new Date(Date.now() - ACTIVITY_WRITE_WINDOW_MS) } },
      ],
    },
    data: { lastActivityAt: new Date() },
  }).catch(() => {});

  return null;
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
        const sessionError = await validateSessionState(payload);
        if (sessionError) {
          return res.status(sessionError.status).json({ error: sessionError.error });
        }
      req.user = payload;
      setContext({ userId: payload.id, storeId: payload.storeId, role: payload.role });
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

      // Impersonação: o token herda o `id` do impersonador — revalida a sessão
      // dele por request (ativo, tokenVersion, idle), evitando token de 24h
      // que sobrevive a desativação/reset de senha do admin.
      if (payload.isImpersonating) {
        const sessionError = await validateSessionState(payload);
        if (sessionError) {
          return res.status(sessionError.status).json({ error: sessionError.error });
        }
        return next();
      }

      if (payload.role === "SUPER_ADMIN") {
        return next();
      }

      const sessionError = await validateSessionState(payload);
      if (sessionError) {
        return res.status(sessionError.status).json({ error: sessionError.error });
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

  const config = await getVarreduraConfig();
  const hoje = startOfDay(new Date());
  const venc = startOfDay(new Date(sub.dataVencimento));
  const diasAtraso = differenceInCalendarDays(hoje, venc);
  const vencido = venc < hoje;
  // Período de graça configurável (mesma config da varredura financeira)
  const dentroDaTolerancia = diasAtraso <= config.toleranciaAcessoDias;

  // PENDENTE: libera dentro do período de graça — a varredura só marca
  // VENCIDO após bloqueioAposDias (após o aviso de bloqueio)
  if (sub.statusPagamento === "PENDENTE") {
    return dentroDaTolerancia;
  }

  // INADIMPLENTE / VENCIDO: bloqueia (já passou do período de graça)
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

  // PAGO: período de graça antes de bloquear
  if (sub.statusPagamento === "PAGO" && vencido) {
    return dentroDaTolerancia;
  }

  return true;
}
