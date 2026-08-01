import jwt from 'jsonwebtoken';

/**
 * Retorna o JWT_SECRET validado.
 *
 * Não há fallback: se a variável de ambiente não estiver definida, a aplicação
 * deve falhar rápido em vez de assinar/verificar tokens com um secret público.
 * Um fallback hardcoded ("fallback_secret") permitiria forjar tokens de
 * SUPER_ADMIN caso o .env não carregue — vulnerabilidade crítica.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'JWT_SECRET não configurado ou inseguro (mínimo 16 caracteres). Defina a variável de ambiente.'
    );
  }
  return secret;
}

/** Constante resolvida na carga do módulo. Lança em caso de má configuração. */
export const JWT_SECRET: string = getJwtSecret();

export function signJwt(payload: jwt.JwtPayload, options?: jwt.SignOptions): string {
  return jwt.sign(payload, getJwtSecret(), options);
}

export function verifyJwt(token: string): jwt.JwtPayload | string {
  return jwt.verify(token, getJwtSecret());
}
