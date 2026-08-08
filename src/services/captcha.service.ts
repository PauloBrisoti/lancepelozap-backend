
import { logger } from '../lib/logger';
/**
 * Verificação de CAPTCHA (Cloudflare Turnstile) para login após tentativas falhas.
 *
 * - Provider configurado (TURNSTILE_SECRET_KEY): verifica via siteverify.
 * - Sem provider: fail-closed em produção (login com captcha é NEGADO e o
 *   admin é avisado no log); em NODE_ENV=test aceita o token mock
 *   'test-captcha-token' para permitir testes do fluxo.
 */

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TEST_TOKEN = 'test-captcha-token';

export async function verifyCaptchaToken(token?: string): Promise<boolean> {
  if (!token) return false;

  if (!TURNSTILE_SECRET) {
    if (process.env.NODE_ENV === 'test' && token === TEST_TOKEN) return true;
    logger.warn('[captcha] TURNSTILE_SECRET_KEY não configurado — login com captcha negado (fail-closed).');
    return false;
  }

  try {
    const form = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body: form });
    const data = (await res.json()) as { success?: boolean };
    return data?.success === true;
  } catch (err) {
    logger.warn(`[captcha] Falha ao verificar com Turnstile (fail-closed): ${(err as Error)?.message}`);
    return false;
  }
}
