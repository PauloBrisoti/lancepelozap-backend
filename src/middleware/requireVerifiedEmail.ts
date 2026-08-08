import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

/**
 * Bloqueia ações sensíveis de contas que exigiram verificação de e-mail
 * (cadastros self-service) e ainda não confirmaram o e-mail.
 * Contas legadas/fornecidas por admin têm `emailVerificationRequired=false`
 * e não são afetadas.
 */
export async function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
  const userId = req.user?.id;
  if (!userId) return next();

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerificationRequired: true, emailVerifiedAt: true },
    });
    if (user?.emailVerificationRequired && !user.emailVerifiedAt) {
      return res.status(403).json({
        error: 'Confirme seu e-mail antes de realizar esta ação.',
        emailVerificationRequired: true,
      });
    }
    next();
  } catch {
    next();
  }
}
