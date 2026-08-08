import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

describe('Scanner de código de barras (backend)', () => {
  let client: any;
  let agent: any;
  let product: any;

  beforeAll(async () => {
    client = await createClientWithStore();
    agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send({
      email: client.user.email,
      password: '123456',
    });
    expect(loginRes.status).toBe(200);

    const cat = await prisma.category.create({
      data: { nome: 'Cat Scanner', storeId: client.store.id, corHexadecimal: '#fff' },
    });
    product = await prisma.product.create({
      data: {
        storeId: client.store.id,
        categoryId: cat.id,
        nome: 'Produto Scanner',
        precoCusto: 50,
        precoVendaSugerido: 120,
        qtdEstoqueAtual: 7,
        codigoVisual: 'SCAN1',
        codigoBarrasEan: '7891000111222',
        status: 'ATIVO',
      },
    });
  });

  afterAll(async () => {
    await prisma.inventoryCountItem.deleteMany({ where: { count: { storeId: client.store.id } } }).catch(() => {});
    await prisma.inventoryCount.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.product.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.category.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.storeUserAccess.deleteMany({ where: { storeId: client.store.id } });
    await prisma.store.delete({ where: { id: client.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: client.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: client.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: client.user.id } }).catch(() => {});
  });

  it('GET /products/by-ean/:ean encontra o produto da loja', async () => {
    const res = await agent.get('/api/products/by-ean/7891000111222');
    expect(res.status).toBe(200);
    expect(res.body.nome).toBe('Produto Scanner');

    const naoEncontrado = await agent.get('/api/products/by-ean/0000000000000');
    expect(naoEncontrado.status).toBe(404);
  });

  it('POST /inventory-counts/:id/items/by-ean cria item e incrementa ao reescanear', async () => {
    const countRes = await agent.post('/api/inventory-counts');
    expect(countRes.status).toBe(201);
    const countId = countRes.body.id;

    // create() já gera itens para todos os produtos ATIVOS com quantidadeContada = estoque
    const res1 = await agent.post(`/api/inventory-counts/${countId}/items/by-ean`).send({ ean: '7891000111222' });
    expect(res1.status).toBe(201);
    expect(Number(res1.body.quantidadeContada)).toBe(8);
    expect(Number(res1.body.quantidadeSistema)).toBe(7);
    expect(Number(res1.body.diferenca)).toBe(1);

    const res2 = await agent.post(`/api/inventory-counts/${countId}/items/by-ean`).send({ ean: '7891000111222' });
    expect(res2.status).toBe(201);
    expect(Number(res2.body.quantidadeContada)).toBe(9);

    const inexistente = await agent.post(`/api/inventory-counts/${countId}/items/by-ean`).send({ ean: '9999999999999' });
    expect(inexistente.status).toBe(404);

    const finalizar = await agent.post(`/api/inventory-counts/${countId}/finalize`);
    expect(finalizar.status).toBe(200);
    const bloq = await agent.post(`/api/inventory-counts/${countId}/items/by-ean`).send({ ean: '7891000111222' });
    expect(bloq.status).toBe(400);
  });
});
