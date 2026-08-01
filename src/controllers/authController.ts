import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { validateUser } from "../services/authService";
import { hashPassword } from "../utils/password";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { sendPasswordReset } from "../services/email.service";

/**
 * Login de usuário.
 * Recebe { email, password } no body.
 * Se válido -> cria JWT, devolve cookie HttpOnly `authToken`.
 */
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email e senha são obrigatórios" });
      return;
    }

    const { user, token } = await validateUser(email, password);

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
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Se logou como Super Admin, limpa o cookie de lojista e vice-versa
    if (user.role === 'SUPER_ADMIN') {
      res.clearCookie('authToken');
    } else {
      res.clearCookie('adminToken');
    }

    // Extrai workspaces (lojas que o usuário tem acesso)
    // ⚠️ Nunca enviar senhaHash para o frontend
    const safeUser = { ...user };
    delete safeUser.senhaHash;
    delete safeUser.storeAccess;

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
    
    // Fetch dadosCompletos do Client
    const finalUser: Record<string, any> = { ...safeUser, workspaces };
    const clientAccessItem = finalUser.clientAccess?.[0];
    finalUser.clientId = clientAccessItem?.clientId || null;
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
export async function updateProfile(req: Request, res: Response) {
  try {
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
      if (novaSenha.length < 6) {
        res.status(400).json({ error: "A nova senha deve ter no mínimo 6 caracteres" });
        return;
      }
      updateData.senhaHash = await hashPassword(novaSenha);
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "Nenhum dado para atualizar" });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    const safeUser = { ...updated };
    delete (safeUser as any).senhaHash;

    res.json({ message: "Perfil atualizado", user: safeUser });
  } catch (err) {
    console.error("Erro ao atualizar perfil:", err);
    res.status(500).json({ error: "Erro ao atualizar perfil" });
  }
}

/**
 * Solicita redefinição de senha.
 * Gera token, salva no banco e envia email com link.
 */
export async function forgotPassword(req: Request, res: Response) {
  try {
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

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExpires: expires },
    });

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;

    await sendPasswordReset(email, resetLink);

    res.json({ message: "Se o email existir, você receberá um link de recuperação." });
  } catch (err) {
    console.error("Erro ao solicitar recuperação de senha:", err);
    res.status(500).json({ error: "Erro ao processar solicitação" });
  }
}

/**
 * Redefine a senha usando o token de recuperação.
 */
export async function resetPassword(req: Request, res: Response) {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      res.status(400).json({ error: "Token e nova senha são obrigatórios" });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: "A senha deve ter no mínimo 6 caracteres" });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
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
      },
    });

    res.json({ message: "Senha redefinida com sucesso." });
  } catch (err) {
    console.error("Erro ao redefinir senha:", err);
    res.status(500).json({ error: "Erro ao redefinir senha" });
  }
}

/**
 * Logout de usuário.
 */
export function logout(req: Request, res: Response) {
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
    if (user.storeId) {
      const store = await prisma.store.findUnique({
        where: { id: user.storeId },
        select: { features: true }
      });
      if (store?.features) {
        try { user.features = JSON.parse(store.features); } catch { user.features = {}; }
      } else {
        user.features = {};
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

export async function completeProfile(req: Request, res: Response) {
  try {
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
  } catch (error) {
    console.error('Erro ao completar cadastro:', error);
    return res.status(500).json({ error: 'Erro ao salvar dados do cadastro.' });
  }
}
