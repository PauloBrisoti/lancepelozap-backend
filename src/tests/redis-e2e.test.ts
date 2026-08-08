import { describe, it, expect } from 'vitest';
import request from 'supertest';
import Redis from 'ioredis';
import app from '../app';
import { createClientWithStore } from './factory';
import { resetRateLimitStoreForTests } from '../lib/rateLimit';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Probe na coleta (top-level await): sem Redis, o arquivo inteiro é skipped
// (suíte hermética — o caminho em memória é coberto por rate-limit.test.ts).
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

describe.runIf(redisUp)('Rate limiting distribuído — E2E (Redis real)', () => {
  it('login 51x → 429 com Retry-After e chaves rl:auth-login por IP e e-mail no Redis', async () => {
    const client = await createClientWithStore();
    const original = { env: process.env.NODE_ENV, url: process.env.REDIS_URL };
    process.env.NODE_ENV = 'production';
    process.env.REDIS_URL = REDIS_URL;
    resetRateLimitStoreForTests();
    const r = new Redis(REDIS_URL);
    try {
      let res: any;
      for (let i = 0; i < 51; i++) {
        res = await request(app)
          .post('/api/auth/login')
          .send({ email: client.user.email, password: 'senha-errada' });
      }
      expect(res.status).toBe(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      const keys = await r.keys('rl:auth-login:*');
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.some((k: string) => k.includes('ip:'))).toBe(true);
      expect(keys.some((k: string) => k.includes('email:'))).toBe(true);
    } finally {
      process.env.NODE_ENV = original.env;
      process.env.REDIS_URL = original.url;
      resetRateLimitStoreForTests();
      r.disconnect();
    }
  }, 30000);
});
