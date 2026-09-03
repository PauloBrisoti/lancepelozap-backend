import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createSuperAdmin, createClientWithStore } from './factory';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';

describe('Promoção de cargo GERENTE (Editar Usuário no Super Admin)', () => {
  let superToken: string;
  let targetUserId: string;
  let targetEmail: string;
  let storeId: string;
  let restrictedToken: string;

  beforeAll(async () => {
    const admin = await createSuperAdmin();
    const resA = await request(app).post('/api/auth/login').send({ email: admin.email, password: '123456' });
    superToken = resA.headers['set-cookie'][0].split(';')[0].split('=')[1];

    const hash = await bcrypt.hash('123456', 10);
    const { store } = await createClientWithStore();

    const target = await prisma.user.create({
      data: { nome: 'Funcionário Promovível', email: `promov_${Date.now()}@lpzteste.app`, senhaHash: hash, role: 'USER' }
    });
    await prisma.storeUserAccess.create({
      data: { storeId: store.id, userId: target.id, role: 'VENDEDOR' }
    });
    targetUserId = target.id;
    targetEmail = target.email;
    storeId = store.id;

    const login = await request(app).post('/api/auth/login').send({ email: targetEmail, password: '123456' });
    restrictedToken = login.headers['set-cookie'][0].split(';')[0].split('=')[1];
  });

  it('funcionário VENDEDOR é bloqueado nas rotas financeiras (403)', async () => {
    const res = await request(app)
      .get('/api/finance/dashboard')
      .set('Cookie', [`authToken=${restrictedToken}`])
      .set('x-workspace-id', storeId);
    expect(res.status).toBe(403);
  });

  it('promove USER → GERENTE: cargo global, lojas promovidas e auditoria dedicada', async () => {
    const res = await request(app)
      .put(`/api/super-admin/users/${targetUserId}`)
      .set('Cookie', [`authToken=${superToken}`])
      .send({ role: 'GERENTE' });
    expect(res.status).toBe(200);
    expect(res.body.lojasAjustadas).toBe(1);

    const updated = await prisma.user.findUnique({ where: { id: targetUserId } });
    expect(updated?.role).toBe('GERENTE');

    const access = await prisma.storeUserAccess.findUnique({
      where: { storeId_userId: { storeId, userId: targetUserId } }
    });
    expect(access?.role).toBe('GERENTE');

    const log = await prisma.auditLog.findFirst({
      where: { acao: 'USER_ROLE_CHANGED', dadosNovos: { path: ['userId'], equals: targetUserId } },
      orderBy: { createdAt: 'desc' }
    });
    expect(log).toBeTruthy();
    const adminUser = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', internalRoleId: null } });
    expect(log!.userId).toBe(adminUser?.id);
    expect(log!.dadosAntigos).toMatchObject({ de: 'USER' });
    expect(log!.dadosNovos).toMatchObject({ para: 'GERENTE' });
    expect(log!.createdAt).toBeTruthy();
  });

  it('promovido a Gerente acessa as rotas financeiras sem 403', async () => {
    const res = await request(app)
      .get('/api/finance/dashboard')
      .set('Cookie', [`authToken=${restrictedToken}`])
      .set('x-workspace-id', storeId);
    expect(res.status).toBe(200);
  });

  it('rebaixa GERENTE → USER e reverte as lojas para VENDEDOR', async () => {
    const res = await request(app)
      .put(`/api/super-admin/users/${targetUserId}`)
      .set('Cookie', [`authToken=${superToken}`])
      .send({ role: 'USER' });
    expect(res.status).toBe(200);
    expect(res.body.lojasAjustadas).toBe(1);

    const updated = await prisma.user.findUnique({ where: { id: targetUserId } });
    expect(updated?.role).toBe('USER');

    const access = await prisma.storeUserAccess.findUnique({
      where: { storeId_userId: { storeId, userId: targetUserId } }
    });
    expect(access?.role).toBe('VENDEDOR');
  });

  it('whitelist rígida: valores fora de USER/GERENTE/SUPER_ADMIN são rejeitados (400)', async () => {
    for (const invalido of ['admin', 'manager', 'user', 'super_admin', 'ROOT', 'OWNER']) {
      const res = await request(app)
        .put(`/api/super-admin/users/${targetUserId}`)
        .set('Cookie', [`authToken=${superToken}`])
        .send({ role: invalido });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Papel inválido/i);
    }
  });

  it('cargo intacto após tentativa de injeção de privilégio', async () => {
    const before = await prisma.user.findUnique({ where: { id: targetUserId } });
    await request(app)
      .put(`/api/super-admin/users/${targetUserId}`)
      .set('Cookie', [`authToken=${superToken}`])
      .send({ role: 'ROOT' });
    const after = await prisma.user.findUnique({ where: { id: targetUserId } });
    expect(after?.role).toBe(before?.role);
  });

  it('papel interno (não-raiz) com CLIENTES FULL não altera cargos (403)', async () => {
    const role = await prisma.internalRole.create({
      data: {
        name: `Gestor Clientes ${Date.now()}`,
        permissions: { create: [{ module: 'CLIENTES', accessLevel: 'FULL' }] }
      }
    });
    const hash = await bcrypt.hash('123456', 10);
    const internalUser = await prisma.user.create({
      data: {
        nome: 'Gestor Clientes',
        email: `gestor_${Date.now()}@lpzteste.app`,
        senhaHash: hash,
        role: 'SUPER_ADMIN',
        internalRoleId: role.id
      }
    });
    const login = await request(app).post('/api/auth/login').send({ email: internalUser.email, password: '123456' });
    const internalToken = login.headers['set-cookie'][0].split(';')[0].split('=')[1];

    const res = await request(app)
      .put(`/api/super-admin/users/${targetUserId}`)
      .set('Cookie', [`authToken=${internalToken}`])
      .send({ role: 'GERENTE' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Apenas SUPER_ADMIN/i);
  });
});