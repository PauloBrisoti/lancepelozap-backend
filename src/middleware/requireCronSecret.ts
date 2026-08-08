import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Protege endpoints de jobs/cron.
 *
 * - Exige `Authorization: Bearer <CRON_SECRET>` com comparação timing-safe.
 * - Bloqueia qualquer invocação que passe o segredo (ou qualquer parâmetro)
 *   via query string — credencial só é aceita no cabeçalho.
 * - Fail-closed: sem CRON_SECRET configurado, responde 503 (nunca executa).
 */

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function requireCronSecret(req: Request, res: Response, next: NextFunction) {
  if (req.originalUrl.includes('?')) {
    return res.status(400).json({
      error: 'Credenciais via query string são bloqueadas. Use o cabeçalho Authorization: Bearer <CRON_SECRET>.',
    });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'CRON_SECRET não configurado no servidor.' });
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Cabeçalho Authorization: Bearer <CRON_SECRET> obrigatório.' });
  }

  if (!safeEqual(header.slice(7), secret)) {
    return res.status(403).json({ error: 'Segredo inválido.' });
  }

  next();
}
