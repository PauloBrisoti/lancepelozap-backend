import bcrypt from "bcryptjs";
import crypto from "crypto";

/**
 * Hashing de senhas — Bcrypt com cost factor 12.
 *
 * O salt é gerado automaticamente pelo bcrypt a cada chamada (salt único
 * e dinâmico por usuário, embutido no hash) — nunca usar salt fixo.
 *
 * Modelo zero-knowledge: o hash é irreversível; nem administradores
 * conseguem ler ou reverter a senha original.
 */
const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Gera uma senha aleatória forte (256 bits) para resets.
 * Deve ser usada no lugar de senhas padrão conhecidas por administradores.
 */
export function randomPassword(): string {
  return crypto.randomBytes(24).toString('base64url');
}
