import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

describe('Orçamentos (integração)', () => {
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

    // Create a product for quote items
    const cat = await prisma.category.create({
      data: { nome: 'Teste Orçamento', storeId: client.store.id, corHexadecimal: '#000' },
    });
    product = await prisma.product.create({
      data: {
        storeId: client.store.id,
        categoryId: cat.id,
        nome: 'Produto Orçamento',
        precoCusto: 10,
        precoVendaSugerido: 29.90,
        qtdEstoqueAtual: 100,
        codigoVisual: 'QTEST',
        status: 'ATIVO',
      },
    });
  });

  afterAll(async () => {
    await prisma.quoteItem.deleteMany({ where: { quote: { storeId: client.store.id } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.product.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.category.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.storeUserAccess.deleteMany({ where: { storeId: client.store.id } });
    await prisma.store.delete({ where: { id: client.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: client.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: client.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: client.user.id } }).catch(() => {});
  });

  it('POST /api/quotes — cria orçamento', async () => {
    const res = await agent.post('/api/quotes').send({
      items: [{ productId: product.id, quantidade: 2, precoUnitario: 29.90 }],
      valorDesconto: 5,
      observacoes: 'Orçamento de teste',
    });
    expect(res.status).toBe(201);
    expect(res.body.quoteNumber).toBeGreaterThan(0);
    expect(Number(res.body.valorTotalBruto)).toBe(59.80);
    expect(Number(res.body.valorTotalLiquido)).toBe(54.80);
    expect(res.body.status).toBe('RASCUNHO');
    expect(res.body.items).toHaveLength(1);
  });

  it('GET /api/quotes — lista orçamentos', async () => {
    const res = await agent.get('/api/quotes');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/quotes/:id — retorna orçamento por ID', async () => {
    const list = await agent.get('/api/quotes');
    const quoteId = list.body.data[0].id;

    const res = await agent.get(`/api/quotes/${quoteId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(quoteId);
    expect(res.body.items).toHaveLength(1);
  });

  it('PUT /api/quotes/:id — atualiza orçamento', async () => {
    const list = await agent.get('/api/quotes');
    const quoteId = list.body.data[0].id;

    const res = await agent.put(`/api/quotes/${quoteId}`).send({
      items: [{ productId: product.id, quantidade: 3, precoUnitario: 25 }],
      valorDesconto: 10,
    });
    expect(res.status).toBe(200);
    expect(Number(res.body.valorTotalBruto)).toBe(75);
    expect(Number(res.body.valorTotalLiquido)).toBe(65);
    expect(res.body.items).toHaveLength(1);
  });

  it('PATCH /api/quotes/:id/status — altera status', async () => {
    const list = await agent.get('/api/quotes');
    const quoteId = list.body.data[0].id;

    const res = await agent.patch(`/api/quotes/${quoteId}/status`).send({ status: 'ENVIADO' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ENVIADO');
  });

  it('PATCH /api/quotes/:id/status — rejeita status inválido', async () => {
    const list = await agent.get('/api/quotes');
    const quoteId = list.body.data[0].id;

    const res = await agent.patch(`/api/quotes/${quoteId}/status`).send({ status: 'INVALIDO' });
    expect(res.status).toBe(400);
  });

  it('POST /api/quotes/:id/convert — converte orçamento em venda', async () => {
    const list = await agent.get('/api/quotes?status=ENVIADO');
    const quote = list.body.data[0];

    const res = await agent.post(`/api/quotes/${quote.id}/convert`).send({ formaPagamento: 'PIX' });
    expect(res.status).toBe(201);
    expect(res.body.sale).toBeDefined();
    expect(res.body.sale.status).toBe('FINALIZADA');
    expect(Number(res.body.sale.valorTotalLiquido)).toBe(Number(quote.valorTotalLiquido));
  });

  it('POST /api/quotes — rejeita sem itens', async () => {
    const res = await agent.post('/api/quotes').send({ items: [] });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/quotes/:id — exclui orçamento não convertido', async () => {
    // Create a new draft quote
    const created = await agent.post('/api/quotes').send({
      items: [{ productId: product.id, quantidade: 1, precoUnitario: 10 }],
    });
    const quoteId = created.body.id;

    const res = await agent.delete(`/api/quotes/${quoteId}`);
    expect(res.status).toBe(204);
  });

  it('GET /api/quotes/current — sem auth retorna 401', async () => {
    const res = await request(app).get('/api/quotes');
    expect(res.status).toBe(401);
  });
});
