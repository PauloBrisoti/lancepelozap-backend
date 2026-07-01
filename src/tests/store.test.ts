import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore, createSuperAdmin } from './factory';

describe('StoreController (integração)', () => {
  let clientA: any;
  let admin: any;
  const agent = request.agent(app);

  beforeAll(async () => {
    clientA = await createClientWithStore();
    admin = await createSuperAdmin();

    await agent
      .post('/api/auth/login')
      .send({ email: clientA.user.email, password: '123456' });
  });

  afterAll(async () => {
    await prisma.storeUserAccess.deleteMany({ where: { storeId: clientA.store.id } });
    await prisma.store.delete({ where: { id: clientA.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: clientA.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: clientA.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: clientA.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: clientA.user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: admin.id } }).catch(() => {});
  });

  it('GET /api/stores/my — lista lojas do cliente autenticado', async () => {
    const res = await agent.get('/api/stores/my');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].stores?.[0]?.nomeFantasia).toBe('Loja Teste');
  });

  it('GET /api/stores/my — falha sem autenticação', async () => {
    const res = await request(app).get('/api/stores/my');
    expect(res.status).toBe(401);
  });

  it('POST /api/stores/my — cria loja com dados válidos', async () => {
    const res = await agent
      .post('/api/stores/my')
      .send({ nomeFantasia: 'Nova Loja', controlId: clientA.control.id });
    expect(res.status).toBe(201);
    expect(res.body.data.nomeFantasia).toBe('Nova Loja');
    expect(res.body.data._count?.storeUsers).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/stores/my — rejeita sem nomeFantasia', async () => {
    const res = await agent
      .post('/api/stores/my')
      .send({ controlId: clientA.control.id });
    expect(res.status).toBe(400);
  });

  it('POST /api/stores/my — rejeita controlId inválido', async () => {
    const res = await agent
      .post('/api/stores/my')
      .send({ nomeFantasia: 'Loja Invalida', controlId: '0000000000' });
    expect(res.status).toBe(404);
  });

  it('PUT /api/stores/my/:id — atualiza loja existente', async () => {
    const res = await agent
      .put(`/api/stores/my/${clientA.store.id}`)
      .send({ nomeFantasia: 'Loja Renomeada' });
    expect(res.status).toBe(200);
    expect(res.body.data.nomeFantasia).toBe('Loja Renomeada');
  });

  it('PUT /api/stores/my/:id — rejeita loja inexistente', async () => {
    const res = await agent
      .put('/api/stores/my/0000000000')
      .send({ nomeFantasia: 'X' });
    expect(res.status).toBe(404);
  });
});
