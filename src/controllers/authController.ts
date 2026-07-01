import { Request, Response, NextFunction } from "express";
import { validateUser } from "../services/authService";
import { prisma } from "../lib/prisma";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";

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
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
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
    
    const finalUser = { ...safeUser, workspaces };

    res.json({ message: "Login realizado com sucesso", user: finalUser });
  } catch (err) {
    next(err);
  }
}

/**
 * Logout de usuário.
 */
export function logout(req: Request, res: Response) {
  res.clearCookie("authToken");
  res.json({ message: "Logout realizado com sucesso" });
}

/**
 * Retorna dados do usuário logado (baseado no JWT extraído pelo middleware).
 */
export async function me(req: Request, res: Response) {
  // @ts-ignore
  const user = req.user;
  
  if (user && user.id) {
    const accesses = await prisma.storeUserAccess.findMany({
      where: { userId: user.id },
      include: { store: true }
    });
    
    user.workspaces = accesses.map(acc => ({
      id: acc.storeId,
      nome: acc.store.nomeFantasia,
      tipo: acc.store.tipoWorkspace,
      role: acc.role
    }));
  }

  res.json({ user });
}
