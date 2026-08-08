import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createClientWithStore } from './factory';
import { resetRateLimitStoreForTests } from '../lib/rateLimit';

describe('Rate limiting distribuído', () => {
  let client: any;

  beforeAll(async () => {
    client = await createClientWithStore();
  });

  it('login: 429 + Retry-After após estourar a janela de 1 minuto', async () => {
    let res: any;
    for (let i = 0; i < 51; i++) {
      res = await request(app)
        .post('/api/auth/login')
        .send({ email: client.user.email, password: 'senha-errada' });
    }
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.body.error).toBeTruthy();
  }, 30000);

  it('forgot-password: 429 após estourar 5/hora por IP', async () => {
    let res: any;
    for (let i = 0; i < 26; i++) {
      res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: client.user.email });
    }
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  }, 30000);

  it('jobs/cron sem CRON_SECRET configurado → 503 (fail-closed)', async () => {
    delete process.env.CRON_SECRET;
    const res = await request(app)
      .post('/api/jobs/pet-lembretes')
      .set('Authorization', 'Bearer qualquer-segredo');
    expect(res.status).toBe(503);
  });

  describe('jobs/cron com CRON_SECRET', () => {
    const CRON_SECRET = 'secret-de-teste-do-cron-1234567890';

    beforeAll(() => {
      process.env.CRON_SECRET = CRON_SECRET;
    });

    it('sem Authorization → 401', async () => {
      const res = await request(app).post('/api/jobs/pet-lembretes');
      expect(res.status).toBe(401);
    });

    it('segredo errado → 403', async () => {
      const res = await request(app)
        .post('/api/jobs/pet-lembretes')
        .set('Authorization', 'Bearer segredo-errado');
      expect(res.status).toBe(403);
    });

    it('query string (mesmo com segredo correto) → 400', async () => {
      const res = await request(app)
        .post('/api/jobs/pet-lembretes?cron_secret=xxx')
        .set('Authorization', `Bearer ${CRON_SECRET}`);
      expect(res.status).toBe(400);
    });

    it('/api/jobs/ping com Bearer correto → 200 (sem efeito colateral)', async () => {
      const res = await request(app)
        .post('/api/jobs/ping')
        .set('Authorization', `Bearer ${CRON_SECRET}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('Bearer correto → 200 e executa o job (idempotente em banco vazio)', async () => {
      const res = await request(app)
        .post('/api/jobs/pet-recorrencia')
        .set('Authorization', `Bearer ${CRON_SECRET}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    }, 15000);
  });

  describe('fail-safe quando o Redis está indisponível', () => {
    it('login segue funcionando via fallback em memória (sem 500)', async () => {
      // Usuário fresco: o email do cliente principal já está com lockout
      // (5 falhas no authService) por causa do teste de brute-force.
      const outro = await createClientWithStore();
      const originalNodeEnv = process.env.NODE_ENV;
      const originalRedisUrl = process.env.REDIS_URL;
      process.env.REDIS_URL = 'redis://127.0.0.1:6399';
      process.env.NODE_ENV = 'production';
      resetRateLimitStoreForTests();
      try {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ email: outro.user.email, password: 'senha-errada' });
        expect(res.status).toBe(401);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        process.env.REDIS_URL = originalRedisUrl;
        resetRateLimitStoreForTests();
      }
    }, 15000);
  });
});
