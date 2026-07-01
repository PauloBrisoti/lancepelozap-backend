import { Request, Response, NextFunction } from 'express';

/**
 * Middleware de proteção CSRF via validação de Origin/Referer.
 *
 * Como funciona:
 * - Requisições com Origin diferente do domínio permitido são bloqueadas
 * - Requisições sem Origin (ex: fetch nativo) usam Referer como fallback
 * - Chamadas internas (mesmo servidor) ou sem header são permitidas
 *
 * Por que não CSRF token?
 * - Como usamos cookie HttpOnly + SameSite=Lax, o próprio navegador já protege
 * - SameSite=Lax bloqueia POST de sites externos automaticamente
 * - Esta validação é uma camada extra de defesa em profundidade
 */

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://localhost',
  'https://app.lancepelozap.com.br',
  'https://www.app.lancepelozap.com.br',
];

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Métodos GET/HEAD/OPTIONS são seguros (não alteram estado)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // Chamadas sem Origin (ex: curl, Postman, mesmo servidor) são permitidas
  const origin = req.headers['origin'] as string | undefined;
  const referer = req.headers['referer'] as string | undefined;
  if (!origin && !referer) return next();

  // Verifica se a origem está na lista de permitidas
  const source = origin || referer || '';
  const isAllowed = ALLOWED_ORIGINS.some((allowed) => source.startsWith(allowed));

  // Em produção, permite qualquer subdomínio do app
  if (process.env.NODE_ENV === 'production' && !isAllowed) {
    const isProdDomain = source.includes('.lancepelozap.com.br') ||
      source.includes('//localhost') ||
      source.includes('//127.0.0.1');
    if (isProdDomain) return next();
  }

  if (!isAllowed && process.env.NODE_ENV === 'production') {
    console.warn(`[CSRF] Bloqueado: ${req.method} ${req.path} de ${source}`);
    return res.status(403).json({ error: 'Origem não permitida' });
  }

  next();
}
