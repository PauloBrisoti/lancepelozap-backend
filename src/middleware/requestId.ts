import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Middleware que adiciona um ID único a cada requisição.
 *
 * O ID é gerado automaticamente (UUID v4) e:
 * - Injetado em `req.requestId` para uso no código
 * - Enviado no header `X-Request-Id` na resposta
 * - Usado pelo logger para rastrear logs por requisição
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = randomUUID();

  // Anexa ao request para uso nos controllers
  (req as any).requestId = requestId;

  // Retorna no header da resposta (cliente pode correlacionar)
  res.setHeader('X-Request-Id', requestId);

  next();
}

/** Helper para tipar o requestId */
export function getRequestId(req: Request): string {
  return (req as any).requestId || 'unknown';
}
