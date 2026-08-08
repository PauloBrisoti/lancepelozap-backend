/**
 * Camada de cache com tracking de hit/miss.
 *
 * - Backend: Redis (chave `cache:<prefix>:<key>`, serialização JSON).
 * - Fallback: Map em memória com TTL (útil em dev/testes ou sem Redis).
 * - TODO acesso registra hit/miss nas métricas por namespace (`metrics.recordCache`),
 *   permitindo monitorar taxa de efetividade por fluxo.
 *
 * Uso:
 *   import { cache } from './cache';
 *   const valor = await cache.getOrSet('settings', 'maintenance', 5, () => loadDoBanco());
 *   await cache.set('quote', quoteId, dados, 60);
 *   const dados = await cache.get('quote', quoteId);
 */

import Redis from 'ioredis';
import { metrics } from './metrics';
import { logger } from './logger';

const REDIS_URL = process.env.REDIS_URL || '';

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

class Cache {
  private redis: Redis | null = null;
  private memory = new Map<string, MemoryEntry>();
  private redisOk = false;

  constructor() {
    if (REDIS_URL) {
      this.redis = new Redis(REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        retryStrategy: () => null,
      });
      this.redis.on('error', (err) => {
        if (this.redisOk) logger.warn('Cache Redis indisponível, usando fallback em memória', { err });
        this.redisOk = false;
      });
      this.redis.on('ready', () => { this.redisOk = true; });
      this.redis.connect().catch(() => { this.redisOk = false; });
    }
  }

  private memKey(prefix: string, key: string) {
    return `${prefix}:${key}`;
  }

  async get<T>(prefix: string, key: string): Promise<T | null> {
    if (this.redisOk && this.redis) {
      try {
        const raw = await this.redis.get(`cache:${prefix}:${key}`);
        if (raw) {
          metrics.recordCache(prefix, true);
          return JSON.parse(raw) as T;
        }
      } catch (err) {
        logger.warn('Falha ao ler cache Redis', { err, prefix });
      }
    }

    const memKey = this.memKey(prefix, key);
    const entry = this.memory.get(memKey);
    if (entry) {
      if (entry.expiresAt > Date.now()) {
        metrics.recordCache(prefix, true);
        return JSON.parse(entry.value) as T;
      }
      this.memory.delete(memKey);
    }

    metrics.recordCache(prefix, false);
    return null;
  }

  async set<T>(prefix: string, key: string, value: T, ttlSeconds: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (this.redisOk && this.redis) {
      try {
        await this.redis.set(`cache:${prefix}:${key}`, raw, 'EX', ttlSeconds);
        return;
      } catch (err) {
        logger.warn('Falha ao gravar cache Redis', { err, prefix });
      }
    }
    this.memory.set(this.memKey(prefix, key), { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(prefix: string, key: string): Promise<void> {
    if (this.redisOk && this.redis) {
      try { await this.redis.del(`cache:${prefix}:${key}`); } catch { /* best effort */ }
    }
    this.memory.delete(this.memKey(prefix, key));
  }

  /** Leitura com callback de carga: usa cache, senão executa `fn` e popula. */
  async getOrSet<T>(prefix: string, key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(prefix, key);
    if (cached !== null) return cached;
    const value = await fn();
    await this.set(prefix, key, value, ttlSeconds);
    return value;
  }

  /** Healthcheck do backend de cache (false se indisponível/fallback em memória). */
  async ping(): Promise<boolean> {
    if (this.redisOk && this.redis) {
      try { return (await this.redis.ping()) === 'PONG'; } catch { return false; }
    }
    return false;
  }

  /** Indica se o backend ativo é Redis ou fallback em memória. */
  get activeBackend(): 'redis' | 'memory' {
    return this.redisOk ? 'redis' : 'memory';
  }
}

export const cache = new Cache();
