import { createHash } from 'crypto';

/**
 * Tokens de verificação/redefinição NUNCA são armazenados em texto puro:
 * apenas o hash SHA-256 é persistido (busca por hash; o token cru vai
 * somente no e-mail).
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function generateToken(bytes = 32): string {
  const { randomBytes } = require('crypto') as typeof import('crypto');
  return randomBytes(bytes).toString('hex');
}
