import { comparePassword } from "../utils/password";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { verifyCaptchaToken } from "./captcha.service";
import { notifyNewDevice } from "./securityNotifications";

const MAX_LOGIN_ATTEMPTS = 5;
const CAPTCHA_AFTER_ATTEMPTS = 5;

// Lockout progressivo: 5ª falha → 5min; 6ª → 15min; 7ª → 30min; 8+ → 60min
function lockoutMinutesFor(attempts: number): number {
  if (attempts <= 5) return 5;
  if (attempts === 6) return 15;
  if (attempts === 7) return 30;
  return 60;
}

// Hash dummy para equalizar o tempo de resposta quando o e-mail NÃO existe
// (mesma duração de um comparePassword real → anti-enumeração por timing).
const DUMMY_HASH = "$2b$10$Bi2BY/hvkY0GNOQuXuDAJuBr6qp2yXrJtFOdMxV6mFNmKD6d60Ijq";

function genericInvalidCreds(captchaRequired = false): Error & { status: number; captchaRequired?: boolean } {
  const err = Object.assign(new Error("Credenciais inválidas"), { status: 401 }) as Error & {
    status: number;
    captchaRequired?: boolean;
  };
  if (captchaRequired) err.captchaRequired = true;
  return err;
}

export interface ValidateUserOptions {
  captchaToken?: string;
  ip?: string;
  userAgent?: string;
}

export async function validateUser(
  email: string,
  passwordPlain: string,
  opts: ValidateUserOptions = {}
): Promise<{ user: any; token: string }> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      clientAccess: true,
      storeAccess: true
    }
  });

  // E-mail inexistente: mesma resposta E mesmo custo de tempo do fluxo real
  if (!user) {
    await comparePassword(passwordPlain, DUMMY_HASH);
    throw genericInvalidCreds(false);
  }

  // Bloqueio ativo (resposta genérica — não revela existência nem o tempo)
  if (user.lockoutUntil && user.lockoutUntil > new Date()) {
    throw genericInvalidCreds(true);
  }

  // Após N tentativas falhas, exige CAPTCHA na próxima tentativa
  if (user.loginAttempts >= CAPTCHA_AFTER_ATTEMPTS) {
    const captchaOk = await verifyCaptchaToken(opts.captchaToken);
    if (!captchaOk) throw genericInvalidCreds(true);
  }

  const isValid = await comparePassword(passwordPlain, user.senhaHash);
  if (!isValid) {
    const attempts = user.loginAttempts + 1;
    const lockout = attempts >= MAX_LOGIN_ATTEMPTS
      ? new Date(Date.now() + lockoutMinutesFor(attempts) * 60000)
      : null;
    await prisma.user.update({
      where: { id: user.id },
      data: { loginAttempts: attempts, lockoutUntil: lockout }
    }).catch(() => {});
    throw genericInvalidCreds(attempts >= CAPTCHA_AFTER_ATTEMPTS);
  }

  // Senha correta: zera contador e bloqueio
  if (user.loginAttempts > 0 || user.lockoutUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { loginAttempts: 0, lockoutUntil: null }
    }).catch(() => {});
  }

  // Conta self-service sem e-mail confirmado: acesso negado até confirmar.
  // (Exige senha válida para chegar aqui → não é vetor de enumeração.)
  if (user.emailVerificationRequired && !user.emailVerifiedAt) {
    throw Object.assign(
      new Error("Confirme seu e-mail para acessar sua conta. Verifique sua caixa de entrada."),
      { status: 403, emailVerificationRequired: true }
    );
  }

  // Verificar se a conta do cliente está ativa (pós-senha: sem enumeração)
  const clientAccess = user.clientAccess?.[0];
  if (clientAccess) {
    const client = await prisma.client.findUnique({ where: { id: clientAccess.clientId } });
    if (client && client.status === 'PENDENTE') {
      throw Object.assign(new Error("Sua conta ainda não foi aprovada. Aguarde o administrador."), { status: 403 });
    }
    if (client && client.deletedAt) {
      throw Object.assign(new Error("Sua conta foi arquivada. Contate o suporte."), { status: 403 });
    }
  }

  // Detecção de novo dispositivo: IP diferente do último login → notifica
  const ip = opts.ip || 'desconhecido';
  const previousIp = user.lastLoginIp;
  // Login novo = atividade nova: reseta lastActivityAt para o controle de
  // sessão inativa (idle) do auth.ts — sem isso, quem ficou inativo além do
  // limite fica preso num lockout sem recuperação (re-login não resolvia).
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date(), lastLoginIp: ip, lastActivityAt: new Date() }
  }).catch(() => {});

  if (previousIp && previousIp !== ip) {
    notifyNewDevice(user.email, ip, opts.userAgent);
  }

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    throw Object.assign(new Error("JWT_SECRET não configurado"), { status: 500 });
  }

  const storeAccesses = user.storeAccess || [];
  const allowedStoreIds = storeAccesses.map((acc: any) => acc.storeId);
  const storeId = allowedStoreIds.length > 0 ? allowedStoreIds[0] : null;

  const clientId = user.clientAccess?.[0]?.clientId || null;

  const token = jwt.sign(
    {
      id: user.id,
      storeId,
      allowedStoreIds,
      clientId,
      role: user.role,
      internalRoleId: user.internalRoleId,
      tv: user.tokenVersion
    },
    JWT_SECRET,
    { expiresIn: "12h" }
  );

  const availableStores = await prisma.store.findMany({
    where: { id: { in: allowedStoreIds } },
    select: { id: true, nomeFantasia: true, control: { select: { id: true, nome: true, tipo: true } } }
  });

  const userWithStores = {
    ...user,
    availableStores
  };

  return { user: userWithStores, token };
}
