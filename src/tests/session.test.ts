import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';
import speakeasy from 'speakeasy';

async function loginAndGetCookie(email: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  const cookies = res.headers['set-cookie'] as unknown as string[];
  const cookie = cookies?.find((c: string) => c.startsWith('authToken='));
  expect(cookie).toBeTruthy();
  return cookie!.split(';')[0];
}

describe('Invalidação de sessão (tokenVersion)', () => {
  let clientA: any;

  beforeAll(async () => {
    clientA = await createClientWithStore();
  });

  it('Logout revoga a sessão server-side', async () => {
    const cookie = await loginAndGetCookie(clientA.user.email, '123456');

    const ok = await request(app).get('/api/auth/me').set('Cookie', [cookie]);
    expect(ok.status).toBe(200);

    const logout = await request(app).post('/api/auth/logout').set('Cookie', [cookie]);
    expect(logout.status).toBe(200);

    // O token antigo não é mais aceito — mesmo não estando expirado
    const after = await request(app).get('/api/auth/me').set('Cookie', [cookie]);
    expect(after.status).toBe(403);
    expect(after.body.error).toMatch(/Sessão expirada/i);
  });

  it('Troca de senha invalida todas as sessões anteriores', async () => {
    const cookie = await loginAndGetCookie(clientA.user.email, '123456');

    const change = await request(app)
      .put('/api/auth/profile')
      .set('Cookie', [cookie])
      .send({ senhaAtual: '123456', novaSenha: 'novaSenha123' });
    expect(change.status).toBe(200);

    const after = await request(app).get('/api/auth/me').set('Cookie', [cookie]);
    expect(after.status).toBe(403);
    expect(after.body.error).toMatch(/Sessão expirada/i);

    // Senha nova funciona; a antiga não
    const reLogin = await request(app).post('/api/auth/login')
      .send({ email: clientA.user.email, password: 'novaSenha123' });
    expect(reLogin.status).toBe(200);

    const oldPw = await request(app).post('/api/auth/login')
      .send({ email: clientA.user.email, password: '123456' });
    expect(oldPw.status).toBe(401);
  });

  it('Usuário arquivado (ativo=false) é bloqueado imediatamente', async () => {
    const cookie = await loginAndGetCookie(clientA.user.email, 'novaSenha123');

    await prisma.user.update({
      where: { id: clientA.user.id },
      data: { ativo: false },
    });

    const res = await request(app).get('/api/auth/me').set('Cookie', [cookie]);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/arquivada/i);

    // Reativa para não contaminar os demais testes
    await prisma.user.update({
      where: { id: clientA.user.id },
      data: { ativo: true },
    });
  });

  it('Sessão ociosa além do limite é encerrada (inatividade)', async () => {
    const cookie = await loginAndGetCookie(clientA.user.email, 'novaSenha123');

    // Simula 9h de inatividade (limite padrão: 8h)
    await prisma.user.update({
      where: { id: clientA.user.id },
      data: { lastActivityAt: new Date(Date.now() - 9 * 60 * 60 * 1000) },
    });

    const res = await request(app).get('/api/auth/me').set('Cookie', [cookie]);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/inatividade/i);

    // Restaura o estado para não contaminar os demais testes
    await prisma.user.update({
      where: { id: clientA.user.id },
      data: { lastActivityAt: null },
    });
  });

  it('2FA pode ser desativado com a senha atual, revogando sessões', async () => {
    const cookie = await loginAndGetCookie(clientA.user.email, 'novaSenha123');

    // Ativa 2FA de ponta a ponta
    const gen = await request(app).get('/api/auth/2fa/generate').set('Cookie', [cookie]);
    expect(gen.status).toBe(200);
    const secret = gen.body.secret;

    const code = speakeasy.totp({ secret, encoding: 'base32' });
    const enable = await request(app).post('/api/auth/2fa/enable').set('Cookie', [cookie]).send({ token: code });
    expect(enable.status).toBe(200);

    // Login passa a exigir 2FA
    const loginRes = await request(app).post('/api/auth/login').send({ email: clientA.user.email, password: 'novaSenha123' });
    expect(loginRes.body.require2FA).toBe(true);

    // Desativa exige a senha atual
    const wrongPw = await request(app).post('/api/auth/2fa/disable').set('Cookie', [cookie]).send({ senhaAtual: 'senha-errada' });
    expect(wrongPw.status).toBe(400);

    const disable = await request(app).post('/api/auth/2fa/disable').set('Cookie', [cookie]).send({ senhaAtual: 'novaSenha123' });
    expect(disable.status).toBe(200);

    // Sessões antigas revogadas
    const after = await request(app).get('/api/auth/me').set('Cookie', [cookie]);
    expect(after.status).toBe(403);

    // Login volta a ser direto (sem 2FA)
    const reLogin = await request(app).post('/api/auth/login').send({ email: clientA.user.email, password: 'novaSenha123' });
    expect(reLogin.status).toBe(200);
    expect(reLogin.body.require2FA).toBeUndefined();
  });
});
