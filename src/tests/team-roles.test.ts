import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createSuperAdmin } from './factory';
import { prisma } from '../lib/prisma';

describe('CRUD de papéis internos (team/roles)', () => {
  let superToken: string;

  beforeAll(async () => {
    const admin = await createSuperAdmin();
    const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: '123456' });
    superToken = res.headers['set-cookie'][0].split(';')[0].split('=')[1];
  });

  it('lista papéis com contagem de usuários', async () => {
    const res = await request(app).get('/api/super-admin/team/roles').set('Cookie', [`authToken=${superToken}`]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('_count');
    expect(res.body[0]._count).toHaveProperty('users');
  });

  it('cria papel com nome normalizado', async () => {
    const res = await request(app)
      .post('/api/super-admin/team/roles')
      .set('Cookie', [`authToken=${superToken}`])
      .send({ name: 'operacional', description: 'Papel de operações' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('OPERACIONAL');
    expect(res.body.isSystem).toBe(false);
  });

  it('rejeita nome duplicado', async () => {
    const res = await request(app)
      .post('/api/super-admin/team/roles')
      .set('Cookie', [`authToken=${superToken}`])
      .send({ name: 'operacional' });
    expect(res.status).toBe(409);
  });

  it('atualiza metadados do papel e registra auditoria', async () => {
    const role = await prisma.internalRole.findFirst({ where: { name: 'OPERACIONAL' } });
    const res = await request(app)
      .put(`/api/super-admin/team/roles/${role!.id}`)
      .set('Cookie', [`authToken=${superToken}`])
      .send({ name: 'OPERACIONAL', description: 'Descrição nova' });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Descrição nova');

    const log = await prisma.auditLog.findFirst({ where: { acao: 'ROLE_UPDATED' } });
    expect(log).toBeTruthy();
    expect(log!.dadosNovos).toHaveProperty('description', 'Descrição nova');
  });

  it('protege papel de sistema (não exclui nem renomeia)', async () => {
    const system = await prisma.internalRole.findFirst({ where: { isSystem: true } });
    const res1 = await request(app)
      .put(`/api/super-admin/team/roles/${system!.id}`)
      .set('Cookie', [`authToken=${superToken}`])
      .send({ name: 'X' });
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .delete(`/api/super-admin/team/roles/${system!.id}`)
      .set('Cookie', [`authToken=${superToken}`]);
    expect(res2.status).toBe(400);
  });

  it('não exclui papel em uso por usuário', async () => {
    const role = await prisma.internalRole.findFirst({ where: { name: 'OPERACIONAL' } });
    await prisma.user.updateMany({ where: { role: 'SUPER_ADMIN' }, data: { internalRoleId: role!.id } });
    const res = await request(app)
      .delete(`/api/super-admin/team/roles/${role!.id}`)
      .set('Cookie', [`authToken=${superToken}`]);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/em uso/i);
    await prisma.user.updateMany({ where: { internalRoleId: role!.id }, data: { internalRoleId: null } });
  });

  it('exclui papel sem usuários', async () => {
    const role = await prisma.internalRole.findFirst({ where: { name: 'OPERACIONAL' } });
    const res = await request(app)
      .delete(`/api/super-admin/team/roles/${role!.id}`)
      .set('Cookie', [`authToken=${superToken}`]);
    expect(res.status).toBe(200);
    const gone = await prisma.internalRole.findUnique({ where: { id: role!.id } });
    expect(gone).toBeNull();
  });
});
