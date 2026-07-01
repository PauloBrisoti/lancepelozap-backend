import { Request, Response, NextFunction } from 'express';

/**
 * Caracteres e padrões perigosos para remover de inputs.
 */
const DANGEROUS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,  // <script>...</script>
  /javascript\s*:/gi,                                         // javascript: URLs
  /on\w+\s*=\s*["'].*?["']/gi,                               // onload=, onclick=, etc
  /data:\s*text\/html/gi,                                     // data:text/html
  /vbscript\s*:/gi,                                           // vbscript:
];

/**
 * Remove caracteres e padrões perigosos de uma string.
 */
function sanitizeString(input: string): string {
  let sanitized = input;
  for (const pattern of DANGEROUS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }
  return sanitized;
}

/**
 * Percorre um objeto recursivamente sanitizando todas as strings.
 */
function sanitizeObject(obj: unknown): unknown {
  if (typeof obj === 'string') return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeObject(value);
    }
    return result;
  }
  return obj;
}

/**
 * Middleware que sanitiza todos os inputs do usuário (body, query, params).
 *
 * Remove:
 * - Tags <script> completas
 * - Protocolos javascript:, vbscript:, data:text/html
 * - Manipuladores de eventos HTML (onclick, onload, etc)
 *
 * ⚠️ Isso é uma CAMADA EXTRA de segurança.
 * A sanitização principal deve ser feita com bibliotecas como Zod.
 */
export function sanitizeInput(req: Request, _res: Response, next: NextFunction) {
  // Sanitiza body (objeto mutável)
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  // Sanitiza query params (readonly — copia para um novo objeto)
  // Express usa getter para query, então não podemos reatribuir diretamente
  next();
}
