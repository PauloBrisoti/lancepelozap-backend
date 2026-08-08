import { Request, Response, NextFunction } from "express";
import { logger } from '../lib/logger';
import jwt from "jsonwebtoken";
import { validateUser } from "../services/authService";
import { hashPassword } from "../utils/password";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { sendPasswordReset, sendVerificationEmail } from "../services/email.service";
import { generateToken, sha256Hex } from "../utils/tokens";
import { notifyPasswordChanged, notifyPasswordReset } from "../services/securityNotifications";
import { asyncHandler } from "../lib/asyncHandler";

/**
 * Login de usuário.
 * Recebe { email, password, captchaToken? } no body.
 * Se válido -> cria JWT, devolve cookie HttpOnly `authToken`.
 */
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, captchaToken } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email e senha são obrigatórios" });
      return;
    }

    const ip = (req.ip || "").replace(/^::ffff:/, "");
    const userAgent = req.headers["user-agent"] as string | undefined;
    const { user, token } = await validateUser(email, password, { captchaToken, ip, userAgent });

    // 2FA Interception
    if (user.twoFactorEnabled) {
      const storeId = user.storeAccess?.[0]?.storeId || null;
      const tempToken = jwt.sign(
        { userId: user.id, type: "2FA_TEMP", storeId },
        JWT_SECRET,
        { expiresIn: "10m" }
      );
      return res.json({ require2FA: true, tempToken, message: "Código 2FA obrigatório" });
    }
    
    // Cookie separado para Super Admin (não conflitar com sessão de lojista)
    // Usa 'authToken' para lojistas e 'adminToken' para Super Admin
    const cookieName = user.role === 'SUPER_ADMIN' ? 'adminToken' : 'authToken';
    res.cookie(cookieName, token, {
      httpOnly: true,
      path: '/',
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 12 * 60 * 60 * 1000,
    });

    // Se logou como Super Admin, limpa o cookie de lojista e vice-versa
    if (user.role === 'SUPER_ADMIN') {
      res.clearCookie('authToken');
    } else {
      res.clearCookie('adminToken');
    }

    // Extrai workspaces (lojas que o usuário tem acesso)
    // ⚠️ SEGURANÇA: montamos o objeto do zero com WHITELIST — nunca espalhamos o
    // registro inteiro (isso vazaria resetToken e twoFactorSecret).
    const workspaces = [];
    if (Array.isArray(user.storeAccess)) {
      const accesses = await prisma.storeUserAccess.findMany({
        where: { userId: user.id },
        include: { store: true }
      });
      for (const acc of accesses) {
        workspaces.push({
          id: acc.storeId,
          nome: acc.store.nomeFantasia,
          tipo: acc.store.tipoWorkspace,
          role: acc.role
        });
      }
    }

    const clientAccessItem = user.clientAccess?.[0];
    const finalUser: Record<string, any> = {
      id: user.id,
      nome: user.nome,
      email: user.email,
      role: user.role,
      ativo: user.ativo,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      twoFactorEnabled: user.twoFactorEnabled,
      emailVerified: !!user.emailVerifiedAt,
      emailVerificationRequired: user.emailVerificationRequired,
      clientId: clientAccessItem?.clientId || null,
      workspaces,
    };
    if (clientAccessItem?.clientId) {
      const client = await prisma.client.findUnique({
        where: { id: clientAccessItem.clientId },
        select: { dadosCompletos: true }
      });
      finalUser.dadosCompletos = client?.dadosCompletos ?? false;
    }

    res.json({ message: "Login realizado com sucesso", user: finalUser });
  } catch (err) {
    next(err);
  }
}

/**
 * Atualiza o perfil do usuário autenticado (nome, email, senha).
 */
export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }

  const { nome, email, senhaAtual, novaSenha } = req.body;
  const updateData: any = {};

  if (nome) updateData.nome = nome;

  if (email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.id !== userId) {
      res.status(400).json({ error: "Este email já está em uso" });
      return;
    }
    updateData.email = email;
    // Novo e-mail exige confirmação antes de novas ações sensíveis
    if (existing?.id !== userId) {
      const newVerifyToken = generateToken(32);
      updateData.emailVerifiedAt = null;
      updateData.emailVerificationRequired = true;
      updateData.emailVerifyToken = sha256Hex(newVerifyToken);
      updateData.emailVerifyTokenExpires = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      void (async () => {
        try {
          const { sendVerificationEmail } = await import("../services/email.service");
          await sendVerificationEmail(email, `${frontendUrl}/verificar-email?token=${newVerifyToken}`);
        } catch (err) {
          logger.error('Erro ao enviar e-mail de verificação:', err);
        }
      })();
    }
  }

  if (novaSenha) {
    if (!senhaAtual) {
      res.status(400).json({ error: "Informe a senha atual para alterar" });
      return;
    }
    const { comparePassword } = await import("../utils/password");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await comparePassword(senhaAtual, user.senhaHash))) {
      res.status(400).json({ error: "Senha atual incorreta" });
      return;
    }
    if (novaSenha.length < 8) {
      res.status(400).json({ error: "A nova senha deve ter no mínimo 8 caracteres" });
      return;
    }
    updateData.senhaHash = await hashPassword(novaSenha);
    // Invalida todas as sessões existentes (incluindo esta)
    updateData.tokenVersion = { increment: 1 };
    // Invalida tokens de recuperação pendentes e limpa lockout
    updateData.resetToken = null;
    updateData.resetTokenExpires = null;
    updateData.loginAttempts = 0;
    updateData.lockoutUntil = null;
    // Notifica (fire-and-forget — nunca quebra o fluxo)
    notifyPasswordChanged(user.email);
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "Nenhum dado para atualizar" });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    // SEGURANÇA: devolve apenas campos seguros (whitelist)
    select: {
      id: true,
      nome: true,
      email: true,
      role: true,
      ativo: true,
      twoFactorEnabled: true,
      createdAt: true,
      lastLogin: true,
    },
  });

  res.json({ message: "Perfil atualizado", user: updated });
}, "atualizar perfil");

/**
 * Solicita redefinição de senha.
 * Token de uso único, expira em 30 minutos, armazenado apenas em hash.
 * Resposta genérica (anti-enumeração) tanto para e-mail existente quanto inexistente.
 */
export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email é obrigatório" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.json({ message: "Se o email existir, você receberá um link de recuperação." });
    return;
  }

  const token = generateToken(32);
  const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos

  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetToken: sha256Hex(token),
      resetTokenExpires: expires,
      // NÃO limpa loginAttempts/lockoutUntil aqui: isso permitiria ao
      // atacante alternar login+forgot para nunca ser bloqueado.
    },
  });

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const resetLink = `${frontendUrl}/reset-password?token=${token}`;

  // Fire-and-forget: falha no SMTP nunca quebra o fluxo nem revela
  // se o e-mail existe (resposta é genérica em qualquer caso).
  void sendPasswordReset(email, resetLink).catch((err) => {
    logger.error("Falha ao enviar e-mail de recuperação de senha", err, { action: "send_password_reset" });
  });

  res.json({ message: "Se o email existir, você receberá um link de recuperação." });
}, "solicitar recuperação de senha");

/**
 * Redefine a senha usando o token de recuperação (uso único).
 */
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = req.body;
  if (!token || !password) {
    res.status(400).json({ error: "Token e nova senha são obrigatórios" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "A senha deve ter no mínimo 8 caracteres" });
    return;
  }

  const user = await prisma.user.findFirst({
    where: {
      resetToken: sha256Hex(token),
      resetTokenExpires: { gt: new Date() },
    },
  });

  if (!user) {
    res.status(400).json({ error: "Token inválido ou expirado" });
    return;
  }

  const senhaHash = await hashPassword(password);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      senhaHash,
      resetToken: null,
      resetTokenExpires: null,
      loginAttempts: 0,
      lockoutUntil: null,
      // Invalida sessões antigas que ainda estivessem válidas
      tokenVersion: { increment: 1 },
    },
  });

  notifyPasswordReset(user.email);

  res.json({ message: "Senha redefinida com sucesso." });
}, "redefinir senha");

/**
 * Confirma o e-mail do usuário via token de verificação (uso único, 48h).
 */
export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) {
    res.status(400).json({ error: "Token é obrigatório" });
    return;
  }

  const user = await prisma.user.findFirst({
    where: {
      emailVerifyToken: sha256Hex(token),
      emailVerifyTokenExpires: { gt: new Date() },
    },
  });

  if (!user) {
    res.status(400).json({ error: "Link de verificação inválido ou expirado" });
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      emailVerifyToken: null,
      emailVerifyTokenExpires: null,
    },
  });

  res.json({ message: "E-mail confirmado com sucesso." });
}, "confirmar e-mail");

/**
 * Reenvia o link de verificação de e-mail.
 * Resposta genérica (anti-enumeração) — nunca revela se o e-mail existe.
 */
export async function resendVerification(req: Request, res: Response) {
  const GENERIC = { message: "Se o email existir e precisar de confirmação, você receberá um link." };
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: "Email é obrigatório" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.emailVerificationRequired || user.emailVerifiedAt) {
      res.json(GENERIC);
      return;
    }

    const token = generateToken(32);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifyToken: sha256Hex(token),
        emailVerifyTokenExpires: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const link = `${frontendUrl}/verificar-email?token=${token}`;
    await sendVerificationEmail(email, link);

    res.json(GENERIC);
  } catch (err) {
    logger.error("Erro ao reenviar link de verificação", { err });
    res.json(GENERIC);
  }
}

/**
 * Logout de usuário.
 * Revoga a sessão server-side (incrementa tokenVersion) quando o token é válido,
 * mas nunca falha: mesmo com token inválido/expirado, limpa os cookies.
 */
export async function logout(req: Request, res: Response) {
  const JWT_SECRET = process.env.JWT_SECRET;
  const token = req.cookies?.adminToken || req.cookies?.authToken;
  if (JWT_SECRET && token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { id: string };
      await prisma.user.update({
        where: { id: payload.id },
        data: { tokenVersion: { increment: 1 } },
      }).catch((e) => {
        logger.warn("Falha ao incrementar tokenVersion no logout", { err: e, action: "logout" });
      });
    } catch {
      // token inválido/expirado — segue para limpar cookies
    }
  }
  res.clearCookie("authToken", { path: '/' });
  res.clearCookie("adminToken", { path: '/' });
  res.json({ message: "Logout realizado com sucesso" });
}

/**
 * Retorna dados do usuário logado (baseado no JWT extraído pelo middleware).
 */
export async function me(req: Request, res: Response) {
  // @ts-ignore
  const user = req.user;
  
  if (user && user.id) {
    // Flags de segurança (2FA + verificação de e-mail) para o frontend
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { twoFactorEnabled: true, emailVerifiedAt: true, emailVerificationRequired: true },
    });
    if (dbUser) {
      user.twoFactorEnabled = dbUser.twoFactorEnabled;
      user.emailVerified = !!dbUser.emailVerifiedAt;
      user.emailVerificationRequired = dbUser.emailVerificationRequired;
    }

    // When impersonating, fetch workspaces for the impersonated store
    // so the frontend can find the correct activeWorkspace
    const whereClause = user.isImpersonating && user.storeId
      ? { storeId: user.storeId }
      : { userId: user.id };

    const accesses = await prisma.storeUserAccess.findMany({
      where: whereClause,
      include: { store: true }
    });
    
    user.workspaces = accesses.map(acc => ({
      id: acc.storeId,
      nome: acc.store.nomeFantasia,
      tipo: acc.store.tipoWorkspace,
      role: acc.role
    }));

    // Fetch store-level features for the active store
    // Sem features configuradas (null/vazio) = todos os módulos habilitados por padrão
    if (user.storeId) {
      const store = await prisma.store.findUnique({
        where: { id: user.storeId },
        select: { features: true }
      });
      if (store?.features) {
        try {
          const parsed = JSON.parse(store.features);
          if (parsed && Object.keys(parsed).length > 0) {
            user.features = parsed;
          }
        } catch { /* features inválido — trata como não configurado */ }
      }
    }

    // Fetch dadosCompletos do Client
    if ((user as any).clientId) {
      const client = await prisma.client.findUnique({
        where: { id: (user as any).clientId },
        select: { dadosCompletos: true }
      });
      (user as any).dadosCompletos = client?.dadosCompletos ?? false;
    }
  }

  res.json({ user });
}

export const completeProfile = asyncHandler(async (req: Request, res: Response) => {
  const clientId = (req.user as any)?.clientId;
  if (!clientId) {
    return res.status(400).json({ error: 'Usuário não vinculado a um cliente.' });
  }

  const { telefoneWhatsapp, cep, logradouro, numero, complemento, bairro, cidade, uf } = req.body;

  await prisma.client.update({
    where: { id: clientId },
    data: {
      telefoneWhatsapp: telefoneWhatsapp || undefined,
      cep: cep || undefined,
      logradouro: logradouro || undefined,
      numero: numero || undefined,
      complemento: complemento || undefined,
      bairro: bairro || undefined,
      cidade: cidade || undefined,
      uf: uf || undefined,
      dadosCompletos: true,
    },
  });

  return res.json({ message: 'Cadastro completado com sucesso!' });
}, "salvar dados do cadastro");
