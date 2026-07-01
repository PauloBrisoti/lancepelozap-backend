import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

describe('Compras / Purchase Orders (integração)', () => {
  let client: any;
  let agent: any;
  let product: any;
  let supplierId: string;

  beforeAll(async () => {
    client = await createClientWithStore();
    agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send({
      email: client.user.email,
      password: '123456',
    });
    expect(loginRes.status).toBe(200);

    const cat = await prisma.category.create({
      data: { nome: 'Teste Compra', storeId: client.store.id, corHexadecimal: '#000' },
    });
    product = await prisma.product.create({
      data: {
        storeId: client.store.id,
        categoryId: cat.id,
        nome: 'Produto Compra',
        precoCusto: 15,
        precoVendaSugerido: 39.90,
        qtdEstoqueAtual: 10,
        codigoVisual: 'COMPTEST',
        status: 'ATIVO',
      },
    });

    const supplier = await prisma.supplier.create({
      data: { storeId: client.store.id, nome: 'Fornecedor Teste', tipoPessoa: 'PJ', cnpjCpf: '11222333000181' },
    });
    supplierId = supplier.id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.purchaseOrderItem.deleteMany({ where: { order: { storeId: client.store.id } } }).catch(() => {});
    await prisma.purchaseOrder.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.supplier.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.product.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.category.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.storeUserAccess.deleteMany({ where: { storeId: client.store.id } });
    await prisma.store.delete({ where: { id: client.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: client.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: client.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: client.user.id } }).catch(() => {});
  });

  it('POST /api/purchases — cria pedido', async () => {
    const res = await agent.post('/api/purchases').send({
      supplierId,
      items: [{ productId: product.id, quantidade: 10, precoUnitario: 12.50 }],
      observacoes: 'Pedido de teste',
    });
    expect(res.status).toBe(201);
    expect(res.body.orderNumber).toBeGreaterThan(0);
    expect(Number(res.body.valorTotalBruto)).toBe(125);
    expect(res.body.status).toBe('RASCUNHO');
    expect(res.body.supplier?.id).toBe(supplierId);
    expect(res.body.supplier?.nome).toBe('Fornecedor Teste');
    expect(res.body.items).toHaveLength(1);
  });

  it('GET /api/purchases — lista pedidos', async () => {
    const res = await agent.get('/api/purchases');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/purchases/:id — retorna por ID', async () => {
    const list = await agent.get('/api/purchases');
    const id = list.body.data[0].id;

    const res = await agent.get(`/api/purchases/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  it('PUT /api/purchases/:id — atualiza pedido', async () => {
    const list = await agent.get('/api/purchases');
    const id = list.body.data[0].id;

    const res = await agent.put(`/api/purchases/${id}`).send({
      supplierId,
      items: [{ productId: product.id, quantidade: 20, precoUnitario: 11 }],
      valorDesconto: 10,
    });
    expect(res.status).toBe(200);
    expect(Number(res.body.valorTotalBruto)).toBe(220);
    expect(Number(res.body.valorTotalLiquido)).toBe(210);
    expect(res.body.supplier?.id).toBe(supplierId);
  });

  it('PATCH /api/purchases/:id/status — altera status', async () => {
    const list = await agent.get('/api/purchases');
    const id = list.body.data[0].id;

    const res = await agent.patch(`/api/purchases/${id}/status`).send({ status: 'PENDENTE' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDENTE');
  });

  it('POST /api/purchases — rejeita sem itens', async () => {
    const res = await agent.post('/api/purchases').send({ items: [] });
    expect(res.status).toBe(400);
  });

  it('POST /api/purchases/:id/receive — recebe itens e atualiza estoque', async () => {
    const before = await prisma.product.findUnique({ where: { id: product.id } });
    const stockBefore = Number(before!.qtdEstoqueAtual);

    const list = await agent.get('/api/purchases?status=PENDENTE');
    const order = list.body.data[0];
    const itemId = order.items[0].id;

    const res = await agent.post(`/api/purchases/${order.id}/receive`).send({
      itens: [{ itemId, quantidadeRecebida: 5 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PARCIAL');

    const after = await prisma.product.findUnique({ where: { id: product.id } });
    expect(Number(after!.qtdEstoqueAtual)).toBe(stockBefore + 5);

    const custoEsperado = ((stockBefore * 15) + (5 * 11)) / (stockBefore + 5);
    expect(Number(after!.precoCusto)).toBeCloseTo(custoEsperado, 1);
  });

  it('POST /api/purchases/:id/receive — recebe restante e finaliza', async () => {
    const list = await agent.get('/api/purchases?status=PARCIAL');
    const order = list.body.data[0];
    const itemId = order.items[0].id;
    const pendente = Number(order.items[0].quantidade) - Number(order.items[0].quantidadeRecebida);

    const res = await agent.post(`/api/purchases/${order.id}/receive`).send({
      itens: [{ itemId, quantidadeRecebida: pendente }],
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('RECEBIDO');
  });

  it('DELETE /api/purchases/:id — rejeita exclusão de pedido recebido', async () => {
    const list = await agent.get('/api/purchases?status=RECEBIDO');
    const id = list.body.data[0].id;

    const res = await agent.delete(`/api/purchases/${id}`);
    expect(res.status).toBe(400);
  });

  it('GET /api/purchases — sem auth retorna 401', async () => {
    const res = await request(app).get('/api/purchases');
    expect(res.status).toBe(401);
  });
});
