import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

const SENHA = 'SenhaForte123!';

async function createUser(overrides: any = {}) {
  const hash = await bcrypt.hash(SENHA, 10);
  return prisma.user.create({
    data: {
      nome: 'User WebSec',
      email: `websec_${Date.now()}_${Math.floor(Math.random() * 10000)}@lpzteste.app`,
      senhaHash: hash,
      role: 'CLIENT_OWNER',
      ...overrides,
    },
  });
}

function login(user: any) {
  return request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '10.0.0.1')
    .send({ email: user.email, password: SENHA });
}

describe('Headers de segurança (Helmet + CSP)', () => {
  it('aplica X-Frame-Options, X-Content-Type-Options e Referrer-Policy', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['strict-transport-security']).toContain('max-age=63072000');
  });

  it('CSP em produção bloqueia scripts inline/eval e libera Turnstile', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app).get('/api/health');
      const csp = res.headers['content-security-policy'] as string;
      const scriptSrc = csp.split(';').find((d) => d.startsWith('script-src')) || '';
      expect(scriptSrc).toContain("'self'");
      expect(scriptSrc).toContain('https://challenges.cloudflare.com');
      expect(scriptSrc).not.toContain('unsafe-inline');
      expect(scriptSrc).not.toContain('unsafe-eval');
    } finally {
      process.env.NODE_ENV = prevNodeEnv!;
    }
  });
});

describe('CSRF (Origin/Referer + cookie de sessão)', () => {
  it('bloqueia escrita com cookie de sessão e sem Origin/Referer em produção', async () => {
    const user = await createUser();
    const loginRes = await login(user);
    const token = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';

    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', token);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Origem não informada');
    } finally {
      process.env.NODE_ENV = prevNodeEnv!;
    }
  });

  it('permite escrita com cookie de sessão e Origin permitida', async () => {
    const user = await createUser();
    const loginRes = await login(user);
    const token = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';

    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', token)
        .set('Origin', 'https://app.lancepelozap.com.br');
      expect([200, 400]).toContain(res.status);
    } finally {
      process.env.NODE_ENV = prevNodeEnv!;
    }
  });

  it('bloqueia origem maliciosa (hostname prefixado não engana)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://app.lancepelozap.com.br.ataque.com')
      .send({ email: 'x@x.com', password: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('Sanitização de input (XSS no backend)', () => {
  it('remove tags script/event handlers de payloads', async () => {
    const user = await createUser();
    const loginRes = await login(user);
    const token = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';

    const res = await request(app)
      .put('/api/auth/profile')
      .set('Cookie', token)
      .set('Origin', 'http://localhost:5173')
      .send({ nome: '<script>alert(1)</script>John<img src=x onerror=alert(2)> Doe' });

    expect([200, 400]).toContain(res.status);
    const me = await request(app)
      .get('/api/auth/me')
      .set('Cookie', token);
    const nome = me.body?.user?.nome || me.body?.nome || '';
    expect(nome).not.toContain('<script');
    expect(nome).not.toContain('onerror');
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: 'websec_' } } });
  await prisma.$disconnect();
});
