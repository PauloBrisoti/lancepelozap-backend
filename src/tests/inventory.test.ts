import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

describe('Stock Alerts (GET /api/inventory/alerts)', () => {
  let client: any;
  let agent: request.Agent;
  let productLow: any;
  let productOk: any;

  beforeAll(async () => {
    client = await createClientWithStore();
    agent = request.agent(app);

    await agent
      .post('/api/auth/login')
      .send({ email: client.user.email, password: '123456' });

    const cat = await prisma.category.create({
      data: { storeId: client.store.id, nome: 'Test Cat', corHexadecimal: '#ccc' }
    });

    productLow = await prisma.product.create({
      data: {
        storeId: client.store.id,
        categoryId: cat.id,
        nome: 'Produto Estoque Baixo',
        precoCusto: 5,
        precoVendaSugerido: 10,
        qtdEstoqueAtual: 2,
        estoqueMinimo: 5,
      }
    });

    productOk = await prisma.product.create({
      data: {
        storeId: client.store.id,
        categoryId: cat.id,
        nome: 'Produto Estoque OK',
        precoCusto: 5,
        precoVendaSugerido: 10,
        qtdEstoqueAtual: 20,
        estoqueMinimo: 5,
      }
    });
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.category.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.storeUserAccess.deleteMany({ where: { storeId: client.store.id } });
    await prisma.store.delete({ where: { id: client.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: client.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: client.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: client.user.id } }).catch(() => {});
  });

  it('retorna produtos com estoque abaixo do mínimo', async () => {
    const res = await agent.get('/api/inventory/alerts');
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    expect(res.body.products.some((p: any) => p.id === productLow.id)).toBe(true);
  });

  it('não inclui produtos com estoque acima do mínimo', async () => {
    const res = await agent.get('/api/inventory/alerts');
    const okInAlerts = res.body.products.some((p: any) => p.id === productOk.id);
    expect(okInAlerts).toBe(false);
  });

  it('retorna count e products no formato correto', async () => {
    const res = await agent.get('/api/inventory/alerts');
    expect(res.body).toHaveProperty('count');
    expect(res.body).toHaveProperty('products');
    expect(Array.isArray(res.body.products)).toBe(true);
    if (res.body.products.length > 0) {
      const p = res.body.products[0];
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('nome');
      expect(p).toHaveProperty('qtdEstoqueAtual');
      expect(p).toHaveProperty('estoqueMinimo');
      expect(p).toHaveProperty('categoria');
    }
  });

  it('requer autenticação', async () => {
    const res = await request(app).get('/api/inventory/alerts');
    expect(res.status).toBe(401);
  });
});
