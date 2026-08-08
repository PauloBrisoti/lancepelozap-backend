import { Request, Response, NextFunction } from "express";

// Bloqueia usuários comuns (lojistas) de endpoints da plataforma.
// Passa apenas quem faz parte da equipe interna (papel interno atribuído
// ou role SUPER_ADMIN nativo). O escopo por cliente é resolvido depois,
// pelo scopedClientFilter.
export const requireInternalTeam = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.internalRoleId && req.user?.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Acesso negado. Apenas equipe interna.' });
  }
  next();
};
