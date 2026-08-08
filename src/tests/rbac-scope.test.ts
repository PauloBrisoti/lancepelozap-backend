import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createSuperAdmin, createClientWithStore } from './factory';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';

describe('Escopo por loja (papéis restritos a um cliente)', () => {
  let superToken: string;
  let scopedToken: string;
  let clientA: any;
  let clientB: any;

  const scopedGet = (path: string) =>
    request(app).get(path).set('Cookie', [`authToken=${scopedToken}`]);

  beforeAll(async () => {
    const admin = await createSuperAdmin();
    const resA = await request(app).post('/api/auth/login').send({ email: admin.email, password: '123456' });
    superToken = resA.headers['set-cookie'][0].split(';')[0].split('=')[1];

    clientA = await createClientWithStore();
    clientB = await createClientWithStore();

    // Papel scoped: só enxerga o cliente A (CLIENTES VIEW)
    const role = await prisma.internalRole.create({
      data: {
        name: 'Scoped Teste',
        clientId: clientA.client.id,
        permissions: { create: [{ module: 'CLIENTES', accessLevel: 'VIEW', actions: ['read'] }] }
      }
    });

    const hash = await bcrypt.hash('123456', 10);
    const scopedUser = await prisma.user.create({
      data: {
        nome: 'Scoped Test',
        email: `scoped_${Date.now()}@lpzteste.app`,
        senhaHash: hash,
        role: 'SUPER_ADMIN',
        internalRoleId: role.id
      }
    });

    const resS = await request(app).post('/api/auth/login').send({ email: scopedUser.email, password: '123456' });
    scopedToken = resS.headers['set-cookie'][0].split(';')[0].split('=')[1];
  });

  it('listagem retorna apenas o cliente do escopo', async () => {
    const res = await scopedGet('/api/super-admin/clients');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(clientA.client.id);
  });

  it('acessa o cliente do escopo, mas não os demais', async () => {
    const own = await scopedGet(`/api/super-admin/clients/${clientA.client.id}`);
    expect(own.status).toBe(200);
    expect(own.body.id).toBe(clientA.client.id);

    const other = await scopedGet(`/api/super-admin/clients/${clientB.client.id}`);
    expect(other.status).toBe(403);
  });

  it('dashboard é filtrado pelo escopo', async () => {
    const res = await scopedGet('/api/super-admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.totalClients).toBe(1);
  });

  it('update de rota de outro cliente é bloqueado', async () => {
    const res = await request(app)
      .put(`/api/super-admin/clients/${clientB.client.id}`)
      .set('Cookie', [`authToken=${scopedToken}`])
      .send({ nomeFantasia: 'X' });
    expect(res.status).toBe(403);
  });

  it('impersonate é bloqueado para loja fora do escopo', async () => {
    // Papel scoped com ACESSO_E_LIBERACOES para o mesmo cliente
    const role2 = await prisma.internalRole.create({
      data: {
        name: 'Scoped Impersonate',
        clientId: clientA.client.id,
        permissions: { create: [{ module: 'ACESSO_E_LIBERACOES', accessLevel: 'FULL' }] }
      }
    });
    const hash = await bcrypt.hash('123456', 10);
    const impUser = await prisma.user.create({
      data: {
        nome: 'Scoped Imp',
        email: `scopedimp_${Date.now()}@lpzteste.app`,
        senhaHash: hash,
        role: 'SUPER_ADMIN',
        internalRoleId: role2.id
      }
    });
    const resImp = await request(app).post('/api/auth/login').send({ email: impUser.email, password: '123456' });
    const impToken = resImp.headers['set-cookie'][0].split(';')[0].split('=')[1];

    const storeA = clientA.store.id;
    const storeB = clientB.store.id;

    const own = await request(app)
      .post(`/api/super-admin/impersonate/${storeA}`)
      .set('Cookie', [`authToken=${impToken}`]);
    expect(own.status).toBe(200);

    const other = await request(app)
      .post(`/api/super-admin/impersonate/${storeB}`)
      .set('Cookie', [`authToken=${impToken}`]);
    expect(other.status).toBe(403);
  });

  it('updateRole valida cliente do escopo e persiste', async () => {
    const role = await prisma.internalRole.findFirst({ where: { name: 'Scoped Teste' } });

    const invalid = await request(app)
      .put(`/api/super-admin/team/roles/${role!.id}`)
      .set('Cookie', [`authToken=${superToken}`])
      .send({ clientId: 'cliente_inexistente' });
    expect(invalid.status).toBe(400);

    const ok = await request(app)
      .put(`/api/super-admin/team/roles/${role!.id}`)
      .set('Cookie', [`authToken=${superToken}`])
      .send({ clientId: clientB.client.id });
    expect(ok.status).toBe(200);

    const refreshed = await prisma.internalRole.findUnique({ where: { id: role!.id } });
    expect(refreshed!.clientId).toBe(clientB.client.id);

    // listRoles expõe o cliente do escopo
    const list = await request(app)
      .get('/api/super-admin/team/roles')
      .set('Cookie', [`authToken=${superToken}`]);
    const listed = list.body.find((r: any) => r.id === role!.id);
    expect(listed.clientId).toBe(clientB.client.id);
    expect(listed.client?.nomeCompleto).toBeTruthy();
  });
});
