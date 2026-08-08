import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

describe('Products CRUD (integração)', () => {
  let client: any;
  let agent: request.Agent;
  let categoryId: string;

  beforeAll(async () => {
    agent = request.agent(app);
    client = await createClientWithStore();

    await agent
      .post('/api/auth/login')
      .send({ email: client.user.email, password: '123456' });

    const cat = await prisma.category.create({
      data: { nome: 'Teste Cat', storeId: client.store.id },
    });
    categoryId = cat.id;
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { storeId: client.store.id } });
    await prisma.category.deleteMany({ where: { storeId: client.store.id } });
    await prisma.storeUserAccess.deleteMany({ where: { storeId: client.store.id } });
    await prisma.store.delete({ where: { id: client.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: client.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: client.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: client.user.id } }).catch(() => {});
  });

  it('GET /api/products — lista vazia', async () => {
    const res = await agent.get('/api/products');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/products — cria produto', async () => {
    const res = await agent.post('/api/products').send({
      nome: 'Produto Teste',
      categoryId,
      precoCusto: 10,
      precoVendaSugerido: 25,
      qtdEstoqueAtual: 100,
      estoqueMinimo: 5,
    });
    expect(res.status).toBe(201);
    expect(res.body.nome).toBe('Produto Teste');
  });

  it('POST /api/products — rejeita sem nome', async () => {
    const res = await agent.post('/api/products').send({
      categoryId,
      precoCusto: 10,
      precoVendaSugerido: 25,
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/products — rejeita sem categoryId', async () => {
    const res = await agent.post('/api/products').send({
      nome: 'Produto Sem Cat',
      precoCusto: 10,
      precoVendaSugerido: 25,
    });
    expect(res.status).toBe(400);
  });

  it('PUT /api/products/:id — atualiza produto', async () => {
    const created = await agent.post('/api/products').send({
      nome: 'Produto Original',
      categoryId,
      precoCusto: 10,
      precoVendaSugerido: 25,
    });
    const id = created.body.id;

    const res = await agent.put(`/api/products/${id}`).send({
      nome: 'Produto Atualizado',
      categoryId,
      precoCusto: 15,
      precoVendaSugerido: 30,
    });
    expect(res.status).toBe(200);
    expect(res.body.nome).toBe('Produto Atualizado');
  });

  it('DELETE /api/products/:id — soft delete', async () => {
    const created = await agent.post('/api/products').send({
      nome: 'Produto Deletar',
      categoryId,
      precoCusto: 10,
      precoVendaSugerido: 25,
    });
    const id = created.body.id;

    const res = await agent.delete(`/api/products/${id}`);
    expect(res.status).toBe(204);

    const product = await prisma.product.findUnique({ where: { id } });
    expect(product).toBeNull(); // exclusão é física
  });

  it('GET /api/products — sem auth retorna 401', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(401);
  });
});
