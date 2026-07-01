import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";

export const requireInternalPermission = (moduleName: string, requiredLevel: "FULL" | "VIEW") => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      // Se não for admin e não tiver internalRoleId
      if (user.role !== "SUPER_ADMIN" && !user.internalRoleId) {
        return res.status(403).json({ error: "Acesso negado." });
      }

      // Se não houver internalRoleId carregado, podemos tentar buscar
      // mas vamos assumir que o user sempre terá que ser carregado ou o req.user
      // não tem o internalRole por padrão. Vamos buscar no banco:
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        include: { internalRole: { include: { permissions: true } } }
      });

      if (!dbUser || !dbUser.internalRole) {
        // Se for SUPER_ADMIN raiz mas não tem papel associado ainda, liberamos (fallback)
        if (dbUser?.role === "SUPER_ADMIN") return next();
        return res.status(403).json({ error: "Acesso negado. Papel não definido." });
      }

      // SUPER_ADMIN nativo sempre passa
      if (dbUser.internalRole.name === "SUPER_ADMIN") {
        return next();
      }

      // Verifica permissões
      const permission = dbUser.internalRole.permissions.find(p => p.module === moduleName);

      if (!permission || permission.accessLevel === "NONE") {
        return res.status(403).json({ error: "Você não tem acesso a este módulo." });
      }

      if (requiredLevel === "FULL" && permission.accessLevel === "VIEW") {
        return res.status(403).json({ error: "Acesso somente leitura. Ação não permitida." });
      }

      next();
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Erro interno de autorização." });
    }
  };
};
