import { describe, it, expect } from 'vitest';
import Redis from 'ioredis';
import { RedisRateLimitStore } from '../lib/rateLimit';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Probe síncrono na coleta (top-level await): runIf/skipIf são avaliados
// antes de beforeAll — a suíte continua hermetica sem Redis (tests skipped).
let redisUp = false;
{
  const probe = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  });
  probe.on('error', () => {});
  try {
    redisUp = (await probe.connect().then(() => probe.ping())) === 'PONG';
  } catch {
    redisUp = false;
  } finally {
    probe.disconnect();
  }
}

describe('Rate limiting distribuído (Redis)', () => {

  it.runIf(redisUp)('INCR atômico + PEXPIRE na primeira chamada (janela fixa)', async () => {
    const store = new RedisRateLimitStore(REDIS_URL);
    const key = `rl:smoke:${Date.now()}:janela`;
    try {
      const r1 = await store.incr(key, 60_000);
      expect(r1.count).toBe(1);
      expect(r1.ttlMs).toBeGreaterThan(50_000);
      expect(r1.ttlMs).toBeLessThanOrEqual(60_000);

      const r2 = await store.incr(key, 60_000);
      expect(r2.count).toBe(2);
      expect(r2.ttlMs).toBeLessThanOrEqual(r1.ttlMs);

      const r3 = await store.incr(key, 60_000);
      expect(r3.count).toBe(3);
    } finally {
      await store.client.del(key);
      await store.quit();
    }
  });

  it.runIf(redisUp)('chaves de janelas diferentes contam separadamente', async () => {
    const store = new RedisRateLimitStore(REDIS_URL);
    const base = `rl:smoke:${Date.now()}`;
    try {
      const min = await store.incr(`${base}:60000`, 60_000);
      const hora = await store.incr(`${base}:3600000`, 3_600_000);
      expect(min.count).toBe(1);
      expect(hora.count).toBe(1);
    } finally {
      await store.client.del(`${base}:60000`, `${base}:3600000`);
      await store.quit();
    }
  });
});
