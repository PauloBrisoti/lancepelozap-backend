import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

/**
 * 2FA obrigatório para contas administrativas (equipe interna / SUPER_ADMIN)
 * em PRODUÇÃO. Em dev/test não é aplicado (não há usuários reais) — a
 * suíte cobre a regra invertendo NODE_ENV (ver account-security.test.ts).
 */
export async function requireAdmin2FA(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV !== 'production') return next();

  const user = req.user;
  if (!user) return next();
  const isAdmin = user.role === 'SUPER_ADMIN' || !!user.internalRoleId;
  if (!isAdmin) return next();

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { twoFactorEnabled: true },
    });
    if (!dbUser?.twoFactorEnabled) {
      return res.status(403).json({
        error: 'Ative a autenticação em duas etapas para acessar esta área.',
        twoFactorSetupRequired: true,
      });
    }
    next();
  } catch {
    // Fail-closed: se a verificação de 2FA falhar, nega o acesso em vez de
    // deixar passar (fail-open permitiria contornar o 2FA com erro de banco).
    return res.status(500).json({ error: 'Erro ao verificar autenticação em duas etapas.' });
  }
}
