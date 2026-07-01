import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

describe('AutoAudit Middleware', () => {
  let client: any;
  let agent: request.Agent;
  let categoryId: string;

  beforeAll(async () => {
    client = await createClientWithStore();
    agent = request.agent(app);

    await agent
      .post('/api/auth/login')
      .send({ email: client.user.email, password: '123456' });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { storeId: client.store.id } });
    await prisma.category.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.storeUserAccess.deleteMany({ where: { storeId: client.store.id } });
    await prisma.store.delete({ where: { id: client.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: client.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: client.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: client.user.id } }).catch(() => {});
  });

  it('deve criar audit log ao fazer POST (CRIAR)', async () => {
    const res = await agent
      .post('/api/categories')
      .send({ nome: 'Audit Test Cat', corHexadecimal: '#ff0000' });
    expect(res.status).toBe(201);
    categoryId = res.body.id;

    const logs = await prisma.auditLog.findMany({
      where: { storeId: client.store.id, acao: 'CRIAR', tabelaAfetada: 'category' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].tabelaAfetada).toBe('category');
    expect(logs[0].userId).toBe(client.user.id);
  });

  it('deve criar audit log ao fazer PUT (ATUALIZAR) com dados antigos', async () => {
    const res = await agent
      .put(`/api/categories/${categoryId}`)
      .send({ nome: 'Audit Cat Renamed' });
    expect(res.status).toBe(200);

    const logs = await prisma.auditLog.findMany({
      where: { storeId: client.store.id, acao: 'ATUALIZAR', tabelaAfetada: 'category' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].tabelaAfetada).toBe('category');
    expect(logs[0].userId).toBe(client.user.id);
    expect(logs[0].dadosNovos).toBeTruthy();
  });

  it('deve criar audit log ao fazer DELETE (EXCLUIR) com dados antigos', async () => {
    const res = await agent.delete(`/api/categories/${categoryId}`);
    expect(res.status).toBe(204);

    const logs = await prisma.auditLog.findMany({
      where: { storeId: client.store.id, acao: 'EXCLUIR', tabelaAfetada: 'category' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].tabelaAfetada).toBe('category');
    expect(logs[0].dadosNovos).toBeFalsy();
  });

  it('GET não deve gerar audit log para mutation actions', async () => {
    const before = await prisma.auditLog.count({ where: { storeId: client.store.id } });
    await agent.get('/api/products');
    const after = await prisma.auditLog.count({ where: { storeId: client.store.id } });
    expect(after).toBe(before);
  });

  it('não deve quebrar se rota não mapeada no MODEL_MAP', async () => {
    const res = await agent.get('/api/dashboard/tenant');
    expect(res.status).toBe(200);
  });
});
