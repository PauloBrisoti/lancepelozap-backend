import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { fail } from '../lib/response';

export function requireWorkspaceType(...types: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.user?.role === 'SUPER_ADMIN') {
        return next();
      }

      const storeId = req.user?.storeId;
      if (!storeId) {
        return fail(res, 'Loja não identificada', 401);
      }

      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { tipoWorkspace: true }
      });

      if (!store) {
        return fail(res, 'Loja não encontrada', 404);
      }

      if (!types.includes(store.tipoWorkspace)) {
        return fail(res, `Acesso restrito a workspaces do tipo ${types.join(' ou ')}.`, 403);
      }

      next();
    } catch (error) {
      console.error('Erro no middleware de workspace:', error);
      next();
    }
  };
}
