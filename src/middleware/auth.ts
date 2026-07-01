import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Aceita ambos os cookies: authToken (lojista) e adminToken (Super Admin)
  const token = req.cookies?.authToken || req.cookies?.adminToken;
  
  if (!token) {
    res.status(401).json({ error: "Acesso negado. Não autenticado." });
    return;
  }
  
  try {
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) {
      res.status(500).json({ error: "Erro de configuração de servidor" });
      return;
    }

    const payload = jwt.verify(token, JWT_SECRET) as any;
    
    const requestedStoreId = (req.headers['x-workspace-id'] || req.headers['x-store-id']) as string;
    
    if (requestedStoreId && requestedStoreId !== 'null' && requestedStoreId !== 'undefined') {
      if (payload.isImpersonating) {
        // If the token is an impersonation token, trust the token's storeId, ignore the header
        // because the header might be a stale ID from localStorage
      } else if (payload.role === 'SUPER_ADMIN') {
        payload.storeId = requestedStoreId;
      } else if (payload.allowedStoreIds?.includes(requestedStoreId)) {
        payload.storeId = requestedStoreId;
      } else {
        return res.status(403).json({ error: "Acesso negado a esta loja" });
      }
    }

    // Map tenant_id to storeId for backwards compatibility
    if (payload.tenant_id && !payload.storeId) {
      payload.storeId = payload.tenant_id;
    }
    
    // @ts-ignore
    req.user = payload;
    next();
  } catch (err) {
    res.status(403).json({ error: "Token inválido ou expirado" });
    return;
  }
}
