import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";

const methodToAction = (req: Request): string => {
  switch (req.method) {
    case "POST":
      return "create";
    case "PUT":
    case "PATCH":
      return "update";
    case "DELETE":
      return "delete";
    default:
      return "read";
  }
};

const isAccessExpired = (user: { expiresAt?: Date | null }): boolean => {
  return !!user.expiresAt && user.expiresAt.getTime() < Date.now();
};

const isLockdownActive = async (): Promise<boolean> => {
  const setting = await prisma.systemSetting.findUnique({ where: { chave: 'PAINEL_LOCKDOWN' } });
  return setting?.valor === true;
};

export const requireInternalPermission = (moduleName: string, requiredLevel: "FULL" | "VIEW") => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      // Se não for admin e não tiver internalRoleId
      if (user.role !== "SUPER_ADMIN" && !user.internalRoleId) {
        return res.status(403).json({ error: "Acesso negado." });
      }

      // Modo de emergência: apenas Super Admin raiz acessa
      if (user.role !== "SUPER_ADMIN" || user.internalRoleId) {
        if (await isLockdownActive()) {
          return res.status(403).json({ error: "Modo de emergência ativado. Apenas administradores raiz podem acessar." });
        }
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
        if (isAccessExpired(dbUser)) {
          return res.status(403).json({ error: "Acesso expirado. Contate um administrador." });
        }
        return next();
      }

      // Acesso temporário expirado bloqueia tudo
      if (isAccessExpired(dbUser)) {
        return res.status(403).json({ error: "Acesso expirado. Contate um administrador." });
      }

      // Verifica permissões
      const permission = dbUser.internalRole.permissions.find(p => p.module === moduleName);

      if (!permission || (permission.accessLevel === "NONE" && permission.actions.length === 0)) {
        return res.status(403).json({ error: "Você não tem acesso a este módulo." });
      }

      // FULL cobre todas as ações
      if (permission.accessLevel === "FULL") {
        return next();
      }

      const action = methodToAction(req);

      // VIEW cobre leitura
      if (permission.accessLevel === "VIEW" && action === "read") {
        return next();
      }

      // Granular: lista fina de ações autorizadas
      if (permission.actions.includes(action)) {
        return next();
      }

      if (requiredLevel === "FULL") {
        return res.status(403).json({ error: "Acesso somente leitura. Ação não permitida." });
      }

      return res.status(403).json({ error: "Você não tem acesso a este módulo." });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Erro interno de autorização." });
    }
  };
};
