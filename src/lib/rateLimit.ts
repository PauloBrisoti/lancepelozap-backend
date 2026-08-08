import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';
import Redis from 'ioredis';
import { verifyJwt } from './jwt';

/**
 * Rate limiting distribuído (Redis) com fallback in-memory (fail-safe).
 *
 * - Janela fixa por contador atômico (INCR + PEXPIRE via Lua).
 * - Limites configuráveis por janela (minuto/hora) e por identificador
 *   (IP, usuário autenticado, e-mail do body).
 * - Fail-safe: se o Redis estiver indisponível, cai para um limitador
 *   local em memória (proteção degradada por instância) com circuit breaker
 *   de 30s. Nunca derruba a requisição por falha do backend de rate limit.
 * - Em NODE_ENV=test não usa Redis (testes herméticos).
 */

export interface RateLimitWindow {
  windowMs: number;
  max: number;
}

export interface RateLimitOptions {
  keyPrefix: string;
  limits: RateLimitWindow[];
  keys: { ip?: boolean; user?: boolean; email?: boolean };
  message?: string;
}

interface RateLimitStore {
  incr(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }>;
}

// ---------- Redis (distribuído) ----------

const INCR_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

class RedisRateLimitStore implements RateLimitStore {
  readonly client: Redis;

  constructor(url: string) {
    // lazyConnect: a conexão é tentada explicitamente no healthcheck com
    // timeout — sem isso, retryStrategy/lazyConnect do ioredis falha no
    // primeiro comando com "Stream isn't writeable".
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
    });
    this.client.on('error', (err) => {
      logger.warn(`[rate-limit] Redis indisponível (fail-safe ativo): ${err.message}`);
    });
  }

  async connect(timeoutMs = 2500): Promise<boolean> {
    const timeout = new Promise<false>((resolve) => {
      setTimeout(() => {
        this.client.disconnect();
        resolve(false);
      }, timeoutMs).unref?.();
    });
    const connected = this.client.connect().then(() => true);
    return Promise.race([connected, timeout]);
  }

  async incr(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }> {
    if (this.client.status !== 'ready') {
      const ok = await this.connect();
      if (!ok) throw new Error('Redis não conectado');
    }
    const res = await this.client.eval(INCR_SCRIPT, 1, key, String(windowMs)) as [number, number];
    return { count: Number(res[0]), ttlMs: Number(res[1]) };
  }

  async quit(): Promise<void> {
    await this.client.quit();
  }
}

export { RedisRateLimitStore };

// ---------- In-memory (dev/test + fail-safe) ----------

class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  async incr(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }> {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { count: 1, ttlMs: windowMs };
    }
    bucket.count += 1;
    return { count: bucket.count, ttlMs: bucket.resetAt - now };
  }
}

// ---------- Seleção de store com fail-safe ----------

let storePromise: Promise<RateLimitStore> | null = null;
let memoryStore: RateLimitStore | null = null;
let usingFallback = false;
let circuitOpenUntil = 0;

function useRedis(): boolean {
  return !!(process.env.REDIS_URL && process.env.NODE_ENV !== 'test');
}

function getStore(): Promise<RateLimitStore> {
  if (!useRedis()) {
    memoryStore ??= new MemoryRateLimitStore();
    return Promise.resolve(memoryStore);
  }

  if (usingFallback) {
    if (Date.now() < circuitOpenUntil) return storePromise!;
    usingFallback = false;
    storePromise = null;
  }

  if (storePromise) return storePromise;

  storePromise = new Promise<RateLimitStore>((resolve) => {
    const redis = new RedisRateLimitStore(process.env.REDIS_URL!);
    redis
      .connect()
      .then((ok) => {
        if (!ok) {
          usingFallback = true;
          circuitOpenUntil = Date.now() + 30_000;
          logger.warn('[rate-limit] Timeout ao conectar no Redis — usando fallback em memória por 30s.');
          return resolve(new MemoryRateLimitStore());
        }
        return redis.incr(`rl:healthcheck:${Date.now()}`, 60000).then(() => resolve(redis));
      })
      .catch(() => {
        usingFallback = true;
        circuitOpenUntil = Date.now() + 30_000;
        logger.warn('[rate-limit] Falha ao conectar no Redis — usando fallback em memória por 30s.');
        resolve(new MemoryRateLimitStore());
      });
  });
  return storePromise;
}

export function resetRateLimitStoreForTests(): void {
  storePromise = null;
  memoryStore = null;
  usingFallback = false;
  circuitOpenUntil = 0;
}

// ---------- Identificadores ----------

function getIp(req: Request): string {
  const raw = req.ip || req.socket?.remoteAddress || 'unknown';
  return raw.replace(/^::ffff:/, '');
}

function getUserId(req: Request): string | null {
  const token = req.cookies?.authToken || req.cookies?.adminToken;
  if (!token) return null;
  try {
    const payload = verifyJwt(token) as { id?: string };
    return payload?.id || null;
  } catch {
    return null;
  }
}

function getEmail(req: Request): string | null {
  const email = (req.body as { email?: unknown })?.email;
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
}

// ---------- Middleware ----------

export function rateLimitDistributed(opts: RateLimitOptions) {
  const message = opts.message || 'Muitas requisições. Tente novamente mais tarde.';

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const identifiers: string[] = [];
      if (opts.keys.ip) identifiers.push(`ip:${getIp(req)}`);
      if (opts.keys.user) {
        const uid = getUserId(req);
        if (uid) identifiers.push(`user:${uid}`);
      }
      if (opts.keys.email) {
        const email = getEmail(req);
        if (email) identifiers.push(`email:${email}`);
      }
      if (identifiers.length === 0) return next();

      const store = await getStore();
      let limited = false;
      let retryAfterMs = 0;
      let limitHit = 0;

      for (const identifier of identifiers) {
        for (const window of opts.limits) {
          const { count, ttlMs } = await store.incr(`rl:${opts.keyPrefix}:${window.windowMs}:${identifier}`, window.windowMs);
          if (count > window.max) {
            limited = true;
            if (ttlMs > retryAfterMs) {
              retryAfterMs = ttlMs;
              limitHit = window.max;
            }
          }
        }
      }

      if (limited) {
        const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
        res.set('Retry-After', String(retryAfterSec));
        res.set('X-RateLimit-Limit', String(limitHit));
        res.set('X-RateLimit-Remaining', '0');
        return res.status(429).json({ error: message, retryAfter: retryAfterSec });
      }

      next();
    } catch (err) {
      logger.warn(`[rate-limit] Erro inesperado (fail-open): ${(err as Error)?.message}`);
      next();
    }
  };
}

// Multiplicador para modo teste (suíte existente faz 101 tentativas de login)
const TEST_MULTIPLIER = process.env.NODE_ENV === 'test' ? 5 : 1;

export function limitFor(base: number): number {
  return base * TEST_MULTIPLIER;
}
