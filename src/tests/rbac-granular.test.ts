import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createSuperAdmin } from './factory';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';

describe('Permissões granulares, acesso temporário e lockdown', () => {
  let superToken: string;
  let admin: any;
  let granularToken: string;
  let granularUserId: string;
  let createdClientId: string;

  const granularGet = (path: string) =>
    request(app).get(path).set('Cookie', [`authToken=${granularToken}`]);

  beforeAll(async () => {
    admin = await createSuperAdmin();
    const resA = await request(app).post('/api/auth/login').send({ email: admin.email, password: '123456' });
    superToken = resA.headers['set-cookie'][0].split(';')[0].split('=')[1];

    // Papel granular: CLIENTES apenas com create + read
    const role = await prisma.internalRole.create({
      data: {
        name: 'Granular Teste',
        permissions: {
          create: [{ module: 'CLIENTES', accessLevel: 'NONE', actions: ['create', 'read'] }]
        }
      }
    });

    const hash = await bcrypt.hash('123456', 10);
    const granularUser = await prisma.user.create({
      data: {
        nome: 'Granular Test',
        email: `granular_${Date.now()}@lpzteste.app`,
        senhaHash: hash,
        role: 'SUPER_ADMIN',
        internalRoleId: role.id
      }
    });

    const resG = await request(app).post('/api/auth/login').send({ email: granularUser.email, password: '123456' });
    granularToken = resG.headers['set-cookie'][0].split(';')[0].split('=')[1];
    granularUserId = granularUser.id;
  });

  it('papel granular lê clientes (action read)', async () => {
    const res = await granularGet('/api/super-admin/clients');
    expect(res.status).toBe(200);
  });

  it('papel granular cria cliente (action create)', async () => {
    const res = await request(app)
      .post('/api/super-admin/clients')
      .set('Cookie', [`authToken=${granularToken}`])
      .send({
        nomeFantasia: 'Loja Granular Test',
        emailResponsavel: `granular_loja_${Date.now()}@lpzteste.app`,
        senhaResponsavel: '123456'
      });
    expect(res.status).toBe(201);
    createdClientId = res.body.id || res.body.client?.id;
  });

  it('papel granular NÃO atualiza nem exclui (actions ausentes)', async () => {
    const putRes = await request(app)
      .put(`/api/super-admin/clients/${createdClientId}`)
      .set('Cookie', [`authToken=${granularToken}`])
      .send({ nomeFantasia: 'Tentativa' });
    expect(putRes.status).toBe(403);

    const delRes = await request(app)
      .delete(`/api/super-admin/clients/${createdClientId}`)
      .set('Cookie', [`authToken=${granularToken}`]);
    expect(delRes.status).toBe(403);
  });

  it('papel VIEW continua bloqueado para escrita', async () => {
    const viewRole = await prisma.internalRole.create({
      data: {
        name: `View_${Date.now()}`,
        permissions: { create: [{ module: 'CLIENTES', accessLevel: 'VIEW', actions: ['read'] }] }
      }
    });
    const hash = await bcrypt.hash('123456', 10);
    const viewUser = await prisma.user.create({
      data: {
        nome: 'View Test',
        email: `view_${Date.now()}@lpzteste.app`,
        senhaHash: hash,
        role: 'SUPER_ADMIN',
        internalRoleId: viewRole.id
      }
    });
    const resV = await request(app).post('/api/auth/login').send({ email: viewUser.email, password: '123456' });
    const viewToken = resV.headers['set-cookie'][0].split(';')[0].split('=')[1];

    const getRes = await request(app).get('/api/super-admin/clients').set('Cookie', [`authToken=${viewToken}`]);
    expect(getRes.status).toBe(200);

    const postRes = await request(app)
      .post('/api/super-admin/clients')
      .set('Cookie', [`authToken=${viewToken}`])
      .send({ nomeFantasia: 'X', emailResponsavel: `x_${Date.now()}@lpzteste.app`, senhaResponsavel: '123456' });
    expect(postRes.status).toBe(403);
  });

  it('acesso expirado bloqueia tudo', async () => {
    await prisma.user.update({
      where: { id: granularUserId },
      data: { expiresAt: new Date(Date.now() - 1000 * 60 * 60) }
    });
    const res = await granularGet('/api/super-admin/clients');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/expirado/i);
  });

  it('restaurando expiração o acesso volta', async () => {
    await prisma.user.update({
      where: { id: granularUserId },
      data: { expiresAt: null }
    });
    const res = await granularGet('/api/super-admin/clients');
    expect(res.status).toBe(200);
  });

  it('lockdown bloqueia papéis não-raiz e exige senha para ativar/desativar', async () => {
    // Sem senha de confirmação
    const noPass = await request(app)
      .put('/api/super-admin/settings/lockdown')
      .set('Cookie', [`authToken=${superToken}`])
      .send({ enabled: true });
    expect(noPass.status).toBe(400);

    // Ativa com confirmação
    const on = await request(app)
      .put('/api/super-admin/settings/lockdown')
      .set('Cookie', [`authToken=${superToken}`])
      .send({ enabled: true, confirmPassword: '123456' });
    expect(on.status).toBe(200);

    // Papel não-raiz bloqueado
    const blocked = await granularGet('/api/super-admin/clients');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/emergência/i);

    // Super admin raiz continua acessando
    const root = await request(app).get('/api/super-admin/clients').set('Cookie', [`authToken=${superToken}`]);
    expect(root.status).toBe(200);

    // Desativa com confirmação
    const off = await request(app)
      .put('/api/super-admin/settings/lockdown')
      .set('Cookie', [`authToken=${superToken}`])
      .send({ enabled: false, confirmPassword: '123456' });
    expect(off.status).toBe(200);

    // Papel volta a acessar
    const back = await granularGet('/api/super-admin/clients');
    expect(back.status).toBe(200);
  });
});
