import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Middleware que garante um ID único por requisição.
 *
 * - Se o cliente/nginx enviar `X-Request-Id` válido, ele é reutilizado
 *   (rastreabilidade fim-a-fim: o mesmo ID atravessa proxy → app → logs → banco).
 * - Caso contrário, um UUID v4 é gerado.
 * - Injetado em `req.requestId`, devolvido no header `X-Request-Id` da resposta
 *   e usado pelo logger via contexto AsyncLocalStorage.
 */

const INBOUND_PATTERN = /^[A-Za-z0-9._-]{8,80}$/;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const inbound = req.headers['x-request-id'];
  const requestId =
    typeof inbound === 'string' && INBOUND_PATTERN.test(inbound) ? inbound : randomUUID();

  (req as any).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  next();
}

/** Helper para tipar o requestId */
export function getRequestId(req: Request): string {
  return (req as any).requestId || 'unknown';
}
