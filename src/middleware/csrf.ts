import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

/**
 * Middleware de proteção CSRF via validação de Origin/Referer.
 *
 * Como funciona:
 * - Requisições com Origin diferente do domínio permitido são bloqueadas
 * - Requisições sem Origin (ex: curl, webhooks, chamadas internas) são permitidas
 * - Chamadas internas (mesmo servidor) ou sem header são permitidas
 *
 * SEGURANÇA: comparamos o HOSTNAME EXATO. O erro clássico é usar startsWith —
 * "app.lancepelozap.com.br.ataque.com" começaria com o domínio permitido e passaria.
 * Aqui, extraímos o hostname da URL e comparamos o nome inteiro.
 */

const ALLOWED_HOSTS = [
  'app.lancepelozap.com.br',
  'www.app.lancepelozap.com.br',
];

const DEV_HOSTS = ['localhost', '127.0.0.1'];

function hostIsAllowed(source: string): boolean {
  let host: string;
  try {
    // new URL aceita também "hostname" sem protocolo; normaliza para minúsculas
    host = new URL(source).hostname.toLowerCase();
  } catch {
    return false; // origem inválida → bloqueia
  }

  if (ALLOWED_HOSTS.includes(host)) return true;

  // Subdomínios reais do domínio (ex.: algo.lancepelozap.com.br)
  if (host.endsWith('.lancepelozap.com.br')) return true;

  // Ambiente de desenvolvimento local
  if (DEV_HOSTS.includes(host)) return true;

  return false;
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Métodos GET/HEAD/OPTIONS são seguros (não alteram estado)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // Chamadas sem Origin (ex: curl, Postman, webhooks, mesmo servidor) são permitidas
  const origin = req.headers['origin'] as string | undefined;
  const referer = req.headers['referer'] as string | undefined;
  if (!origin && !referer) {
    // DEFESA EM PROFUNDIDADE (produção): requisição de escrita sem Origin/Referer
    // com cookie de sessão é vetor clássico de CSRF (form auto-submit em
    // navegadores que não enviam Origin). Browsers sempre enviam Origin em
    // fetch/XHR cross-origin; integrações usam Bearer, não cookie — bloqueamos.
    const sessionCookie = req.cookies?.authToken || req.cookies?.adminToken;
    if (sessionCookie && process.env.NODE_ENV === 'production') {
      logger.warn(`[CSRF] Sem Origin/Referer + cookie de sessão: ${req.method} ${req.path}`);
      return res.status(403).json({ error: 'Origem não informada' });
    }
    return next();
  }

  const source = origin || referer || '';

  if (hostIsAllowed(source)) return next();

  if (process.env.NODE_ENV === 'production') {
    logger.warn(`[CSRF] Bloqueado: ${req.method} ${req.path} de ${source}`);
    return res.status(403).json({ error: 'Origem não permitida' });
  }

  // Fora de produção, bloqueamos origens estranhas, mas permitimos localhost puro
  const devLocal = ['http://localhost', 'http://127.0.0.1'].some((p) => source.startsWith(p));
  if (devLocal) return next();

  logger.warn(`[CSRF] Bloqueado (dev): ${req.method} ${req.path} de ${source}`);
  return res.status(403).json({ error: 'Origem não permitida' });
}
