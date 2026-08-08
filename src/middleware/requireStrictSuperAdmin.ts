import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

/** Verifica se o usuário do request é SUPER_ADMIN real (raiz ou papel interno 'SUPER_ADMIN' vigente). */
export async function isStrictSuperAdmin(req: Request): Promise<boolean> {
  if (req.user?.role !== 'SUPER_ADMIN') return false;
  if (req.user.internalRoleId) {
    const dbUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { internalRole: { select: { name: true } } },
    });
    if (!dbUser?.internalRole || dbUser.internalRole.name !== 'SUPER_ADMIN') return false;
    if (dbUser.expiresAt && dbUser.expiresAt.getTime() < Date.now()) return false;
  }
  return true;
}

/**
 * Exige SUPER_ADMIN real (papel raiz ou papel interno 'SUPER_ADMIN' vigente).
 * Usado nas rotas de impacto de raiz: equipe, lockdown, reset-database,
 * purge de clientes, resets em massa e impersonação.
 */
export async function requireStrictSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (await isStrictSuperAdmin(req)) return next();
  return res.status(403).json({ error: 'Acesso negado. Apenas SUPER_ADMIN.' });
}
