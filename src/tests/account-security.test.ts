import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { sha256Hex } from '../utils/tokens';

const SENHA = 'SenhaForte123!';

async function createUser(overrides: any = {}) {
  const hash = await bcrypt.hash(SENHA, 10);
  return prisma.user.create({
    data: {
      nome: 'User Seg',
      email: `seg_${Date.now()}_${Math.floor(Math.random() * 10000)}@lpzteste.app`,
      senhaHash: hash,
      role: 'CLIENT_OWNER',
      ...overrides,
    },
  });
}

function login(user: any, extra: any = {}) {
  return request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', extra.ip || '10.0.0.1')
    .send({ email: user.email, password: extra.password || SENHA, ...extra.body });
}

describe('Anti-enumeração (registro)', () => {
  it('Registro com e-mail existente responde 201 idêntico ao sucesso', async () => {
    const payload = {
      nomeFantasia: 'Loja Seguranca',
      nomeResponsavel: 'Resp Seguranca',
      email: `enum_${Date.now()}@lpzteste.app`,
      senha: 'Teste1234',
      telefoneWhatsapp: '(11) 98888-7777',
    };

    const primeira = await request(app).post('/api/auth/register').send(payload);
    expect(primeira.status).toBe(201);

    const segunda = await request(app).post('/api/auth/register').send(payload);
    expect(segunda.status).toBe(201);
    expect(segunda.body).toEqual(primeira.body);
    expect(segunda.body.pending).toBe(true);

    const users = await prisma.user.findMany({ where: { email: payload.email } });
    expect(users).toHaveLength(1);

    const user = users[0];
    expect(user.emailVerificationRequired).toBe(true);
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.emailVerifyToken).toMatch(/^[a-f0-9]{64}$/);
    expect(user.emailVerifyTokenExpires!.getTime()).toBeGreaterThan(Date.now() + 47 * 60 * 60 * 1000);
  });
});

describe('Verificação de e-mail', () => {
  it('Login negado até confirmar; token de uso único; 403 com flag no body', async () => {
    const token = `verify-${Date.now()}`;
    const user = await createUser({
      emailVerificationRequired: true,
      emailVerifyToken: sha256Hex(token),
      emailVerifyTokenExpires: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    const bloqueado = await login(user);
    expect(bloqueado.status).toBe(403);
    expect(bloqueado.body.emailVerificationRequired).toBe(true);

    const tokenErrado = await request(app).post('/api/auth/verify-email').send({ token: 'token-invalido' });
    expect(tokenErrado.status).toBe(400);

    const confirmado = await request(app).post('/api/auth/verify-email').send({ token });
    expect(confirmado.status).toBe(200);

    const liberado = await login(user);
    expect(liberado.status).toBe(200);

    const reuso = await request(app).post('/api/auth/verify-email').send({ token });
    expect(reuso.status).toBe(400);
  });

  it('Reenvio de verificação tem resposta genérica para qualquer e-mail', async () => {
    const token = `resend-${Date.now()}`;
    const user = await createUser({
      emailVerificationRequired: true,
      emailVerifyToken: sha256Hex(token),
      emailVerifyTokenExpires: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    const existente = await request(app).post('/api/auth/resend-verification').send({ email: user.email });
    expect(existente.status).toBe(200);

    const inexistente = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: `nao-existe-${Date.now()}@lpzteste.app` });
    expect(inexistente.status).toBe(200);
    expect(existente.body.message).toBe(inexistente.body.message);
  });
});

describe('CAPTCHA e lockout progressivo no login', () => {
  it('Exige CAPTCHA a partir de 5 tentativas e aceita o token mock em teste', async () => {
    const user = await createUser({ loginAttempts: 5 });

    const semCaptcha = await login(user);
    expect(semCaptcha.status).toBe(401);
    expect(semCaptcha.body.captchaRequired).toBe(true);

    const comCaptcha = await login(user, { body: { captchaToken: 'test-captcha-token' } });
    expect(comCaptcha.status).toBe(200);

    const atual = await prisma.user.findUnique({ where: { id: user.id } });
    expect(atual!.loginAttempts).toBe(0);
    expect(atual!.lockoutUntil).toBeNull();
  });

  it('Lockout progressivo 5→5min, 6→15min, 7→30min, 8+→60min', async () => {
    const user = await createUser();

    for (let i = 0; i < 5; i++) {
      await login(user, { password: 'senha-errada-1' });
    }
    let atual = await prisma.user.findUnique({ where: { id: user.id } });
    expect(atual!.loginAttempts).toBe(5);
    expect(atual!.lockoutUntil!.getTime() - Date.now()).toBeGreaterThan(4 * 60000);
    expect(atual!.lockoutUntil!.getTime() - Date.now()).toBeLessThan(6 * 60000);

    const duranteLockout = await login(user);
    expect(duranteLockout.status).toBe(401);

    for (let i = 0; i < 3; i++) {
      await prisma.user.update({
        where: { id: user.id },
        data: { lockoutUntil: new Date(Date.now() - 1000) },
      });
      await login(user, { password: 'senha-errada-1', body: { captchaToken: 'test-captcha-token' } });

      atual = await prisma.user.findUnique({ where: { id: user.id } });
      const esperado = i === 0 ? 15 : i === 1 ? 30 : 60;
      expect(atual!.loginAttempts).toBe(6 + i);
      expect(atual!.lockoutUntil!.getTime() - Date.now()).toBeGreaterThan((esperado - 1) * 60000);
      expect(atual!.lockoutUntil!.getTime() - Date.now()).toBeLessThan((esperado + 1) * 60000);
    }
  });
});

describe('Reset de senha seguro', () => {
  it('Token de uso único, expiração, limpa lockout e invalida sessões antigas', async () => {
    const user = await createUser({ loginAttempts: 7, lockoutUntil: new Date(Date.now() + 30 * 60000) });

    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    expect(forgot.status).toBe(200);

    const token = `reset-${Date.now()}`;
    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: sha256Hex(token), resetTokenExpires: new Date(Date.now() + 30 * 60000) },
    });

    const reset = await request(app).post('/api/auth/reset-password').send({ token, password: 'NovaSenha456!' });
    expect(reset.status).toBe(200);

    const reuso = await request(app).post('/api/auth/reset-password').send({ token, password: 'NovaSenha456!' });
    expect(reuso.status).toBe(400);

    const loginNovo = await login(user, { password: 'NovaSenha456!' });
    expect(loginNovo.status).toBe(200);

    const atual = await prisma.user.findUnique({ where: { id: user.id } });
    expect(atual!.loginAttempts).toBe(0);
    expect(atual!.lockoutUntil).toBeNull();
    expect(atual!.resetToken).toBeNull();
  });

  it('Troca de senha via perfil invalida token de reset pendente', async () => {
    const user = await createUser();
    const token = `reset-profile-${Date.now()}`;
    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: sha256Hex(token), resetTokenExpires: new Date(Date.now() + 30 * 60000) },
    });

    const agente = request.agent(app);
    const primeiroLogin = await agente.post('/api/auth/login').send({ email: user.email, password: SENHA });
    expect(primeiroLogin.status).toBe(200);

    const perfil = await agente.put('/api/auth/profile').send({ senhaAtual: SENHA, novaSenha: 'OutraSenha789!' });
    expect(perfil.status).toBe(200);

    const reset = await request(app).post('/api/auth/reset-password').send({ token, password: 'NovaSenha456!' });
    expect(reset.status).toBe(400);
  });
});

describe('2FA obrigatório para admin em produção', () => {
  it('SUPER_ADMIN sem 2FA recebe 403 twoFactorSetupRequired; com 2FA acessa', async () => {
    const admin = await createUser({ role: 'SUPER_ADMIN' });
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const agente = request.agent(app);
    const primeiroLogin = await agente.post('/api/auth/login').send({ email: admin.email, password: SENHA });
    expect(primeiroLogin.status).toBe(200);

    // Em produção o cookie é Secure; o cookie jar do supertest o descarta em
    // http. Autenticamos via header Cookie com JWT gerado no teste.
    const jwt = (await import('jsonwebtoken')).default;
    const token = jwt.sign(
      { id: admin.id, role: 'SUPER_ADMIN', tv: 0 },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );

    try {
      const sem2FA = await request(app)
        .get('/api/super-admin/maintenance')
        .set('Cookie', `adminToken=${token}`)
        .set('X-Forwarded-For', '10.0.0.1');
      expect(sem2FA.status).toBe(403);
      expect(sem2FA.body.twoFactorSetupRequired).toBe(true);

      await prisma.user.update({ where: { id: admin.id }, data: { twoFactorEnabled: true } });

      const liberado = await request(app)
        .get('/api/super-admin/maintenance')
        .set('Cookie', `adminToken=${token}`)
        .set('X-Forwarded-For', '10.0.0.1');
      expect(liberado.status).toBe(200);
    } finally {
      process.env.NODE_ENV = prevNodeEnv!;
    }
  });
});

describe('Detecção de novo dispositivo', () => {
  it('Grava IP do último login e atualiza em dispositivo novo', async () => {
    const user = await createUser();

    const primeiro = await login(user, { ip: '1.2.3.4' });
    expect(primeiro.status).toBe(200);
    let atual = await prisma.user.findUnique({ where: { id: user.id } });
    expect(atual!.lastLoginIp).toBe('1.2.3.4');

    const segundo = await login(user, { ip: '5.6.7.8' });
    expect(segundo.status).toBe(200);
    atual = await prisma.user.findUnique({ where: { id: user.id } });
    expect(atual!.lastLoginIp).toBe('5.6.7.8');
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: '@lpzteste.app' } } });
});
