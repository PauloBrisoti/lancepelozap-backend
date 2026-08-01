import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { comparePassword } from '../utils/password';

export async function requireDestructiveConfirmation(req: Request, res: Response, next: NextFunction) {
  const userId = (req.user as any)?.id;
  if (!userId) return res.status(401).json({ error: 'Não autenticado.' });

  const { confirmPassword } = req.body;
  if (!confirmPassword) {
    return res.status(400).json({ error: 'Confirmação necessária. Envie { confirmPassword } no body.' });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { senhaHash: true } });
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const valid = await comparePassword(confirmPassword, user.senhaHash);
  if (!valid) return res.status(403).json({ error: 'Senha de confirmação inválida.' });

  next();
}
