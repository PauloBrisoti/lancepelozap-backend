import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

describe('Sales CRUD (integração)', () => {
  let client: any;
  let agent: request.Agent;
  let productId: string;
  let categoryId: string;
  let customerId: string;

  beforeAll(async () => {
    agent = request.agent(app);
    client = await createClientWithStore();

    const loginRes = await agent
      .post('/api/auth/login')
      .send({ email: client.user.email, password: '123456' });
    expect(loginRes.status).toBe(200);

    const cat = await prisma.category.create({
      data: { nome: 'Cat Vendas', storeId: client.store.id },
    });
    categoryId = cat.id;

    const prod = await prisma.product.create({
      data: {
        nome: 'Produto Venda',
        storeId: client.store.id,
        categoryId: cat.id,
        precoCusto: 10,
        precoVendaSugerido: 50,
        qtdEstoqueAtual: 100,
      },
    });
    productId = prod.id;

    const cust = await prisma.customer.create({
      data: {
        nomeCompleto: 'Cliente Venda',
        storeId: client.store.id,
        telefoneWhatsapp: '11966666666',
      },
    });
    customerId = cust.id;
  });

  afterAll(async () => {
    await prisma.saleItem.deleteMany({ where: { sale: { storeId: client.store.id } } }).catch(() => {});
    await prisma.accountReceivable.deleteMany({ where: { sale: { storeId: client.store.id } } }).catch(() => {});
    await prisma.sale.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.cashTransaction.deleteMany({ where: { cashRegister: { storeId: client.store.id } } }).catch(() => {});
    await prisma.cashRegister.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.product.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.category.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.storeUserAccess.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.store.delete({ where: { id: client.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: client.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: client.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: client.user.id } }).catch(() => {});
  });

  it('GET /api/sales — lista vendas vazia', async () => {
    const res = await agent.get('/api/sales');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/sales — cria venda com dinheiro', async () => {
    await agent.post('/api/cash-register/open').send({ valorTrocoInicial: 50 });
    const res = await agent.post('/api/sales').send({
      itens: [{ productId, quantidade: 2, precoUnitarioVendido: 50 }],
      formaPagamento: 'DINHEIRO',
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(Number(res.body.valorTotalBruto)).toBe(100);
  });

  it('POST /api/sales — cria venda com crediário', async () => {
    await agent.post('/api/cash-register/open').send({ valorTrocoInicial: 50 });
    const res = await agent.post('/api/sales').send({
      customerId,
      itens: [{ productId, quantidade: 1, precoUnitarioVendido: 30 }],
      formaPagamento: 'CREDIARIO',
      numeroParcelas: 3,
    });
    expect(res.status).toBe(201);
    expect(res.body.formaPagamento).toBe('CREDIARIO');
  });

  it('POST /api/sales — rejeita crediário sem cliente', async () => {
    await agent.post('/api/cash-register/open').send({ valorTrocoInicial: 50 });
    const res = await agent.post('/api/sales').send({
      itens: [{ productId, quantidade: 1, precoUnitarioVendido: 30 }],
      formaPagamento: 'CREDIARIO',
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/sales — rejeita sem itens', async () => {
    const res = await agent.post('/api/sales').send({
      formaPagamento: 'DINHEIRO',
    });
    expect(res.status).toBe(400);
  });

  it('PUT /api/sales/:id/cancel — cancela venda', async () => {
    await agent.post('/api/cash-register/open').send({ valorTrocoInicial: 50 });
    const created = await agent.post('/api/sales').send({
      itens: [{ productId, quantidade: 1, precoUnitarioVendido: 50 }],
      formaPagamento: 'PIX',
    });
    const id = created.body.id;

    const res = await agent.put(`/api/sales/${id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.sale.status).toBe('CANCELADA');
  });

  it('PUT /api/sales/:id/cancel — rejeita venda inexistente', async () => {
    const res = await agent.put('/api/sales/0000000000/cancel');
    expect(res.status).toBe(404);
  });

  it('POST /api/sales — baixa estoque', async () => {
    await agent.post('/api/cash-register/open').send({ valorTrocoInicial: 50 });
    const produto = await prisma.product.findUnique({ where: { id: productId } });
    const qtdAntes = Number(produto!.qtdEstoqueAtual);

    await agent.post('/api/sales').send({
      itens: [{ productId, quantidade: 3, precoUnitarioVendido: 50 }],
      formaPagamento: 'DINHEIRO',
    });

    const produtoDepois = await prisma.product.findUnique({ where: { id: productId } });
    expect(Number(produtoDepois!.qtdEstoqueAtual)).toBe(qtdAntes - 3);
  });

  it('GET /api/sales — sem auth retorna 401', async () => {
    const res = await request(app).get('/api/sales');
    expect(res.status).toBe(401);
  });
});
