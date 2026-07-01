import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

const request = supertest.agent(app);

describe('Comissões (CommissionPayment) API', () => {
  let client: any;
  let productId: string;
  let saleItemIds: string[] = [];

  beforeAll(async () => {
    client = await createClientWithStore();
    const loginRes = await request.post('/api/auth/login').send({
      email: client.user.email,
      password: '123456',
    });
    expect(loginRes.status).toBe(200);

    // Create category
    const cat = await prisma.category.create({
      data: { nome: 'Comissao Cat', storeId: client.store.id, corHexadecimal: '#c0c' },
    });

    // Create product
    const p = await prisma.product.create({
      data: {
        storeId: client.store.id,
        categoryId: cat.id,
        nome: 'Produto Comissao',
        precoCusto: 10,
        precoVendaSugerido: 100,
        qtdEstoqueAtual: 50,
        codigoVisual: 'COM',
        status: 'ATIVO',
      },
    });
    productId = p.id;

    // Create a commission rule for this seller (10% on all products)
    await prisma.commissionRule.create({
      data: {
        storeId: client.store.id,
        userId: client.user.id,
        percentual: 10,
        ativo: true,
      },
    });

    // Create a sale
    const saleRes = await request.post('/api/sales').send({
      itens: [
        { productId, quantidade: 3, precoUnitarioVendido: 100 },
      ],
      formaPagamento: 'DINHEIRO',
    });
    expect(saleRes.status).toBe(201);

    // Fetch sale items to get IDs + verify commission was calculated
    const items = await prisma.saleItem.findMany({
      where: { saleId: saleRes.body.id },
    });
    saleItemIds = items.map(i => i.id);

    // Verify commission was calculated (10% of 300 = 30)
    expect(Number(items[0].comissaoVendedorValor)).toBe(30);
  });

  afterAll(async () => {
    await prisma.commissionPayment.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.saleItem.deleteMany({ where: { sale: { storeId: client.store.id } } }).catch(() => {});
    await prisma.sale.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.commissionRule.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.product.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.category.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.storeUserAccess.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.store.delete({ where: { id: client.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: client.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: client.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: client.user.id } }).catch(() => {});
  });

  it('GET /api/commission-payments/summary - retorna pendências', async () => {
    const res = await request.get('/api/commission-payments/summary');
    expect(res.status).toBe(200);
    expect(res.body.totalPendente).toBe(30);
    expect(res.body.porVendedor).toHaveLength(1);
    expect(res.body.porVendedor[0].totalPendente).toBe(30);
  });

  it('GET /api/commission-payments - lista vazia', async () => {
    const res = await request.get('/api/commission-payments');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('POST /api/commission-payments - paga comissões', async () => {
    const res = await request.post('/api/commission-payments').send({
      sellerId: client.user.id,
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.totalValor)).toBe(30);
    expect(res.body.status).toBe('PAGO');
    expect(res.body.userId).toBe(client.user.id);
  });

  it('GET /api/commission-payments/summary - zera após pagamento', async () => {
    const res = await request.get('/api/commission-payments/summary');
    expect(res.status).toBe(200);
    expect(res.body.totalPendente).toBe(0);
    expect(res.body.porVendedor).toHaveLength(0);
    expect(res.body.totalPagoEsteMes).toBe(30);
  });

  it('GET /api/commission-payments - lista pagamento criado', async () => {
    const res = await request.get('/api/commission-payments');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(Number(res.body.data[0].totalValor)).toBe(30);
  });

  it('POST /api/commission-payments - erro se sem pendências', async () => {
    const res = await request.post('/api/commission-payments').send({
      sellerId: client.user.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/nenhuma comissão|pendente/i);
  });

  it('POST /api/commission-payments - rejeita sem sellerId', async () => {
    const res = await request.post('/api/commission-payments').send({});
    expect(res.status).toBe(400);
  });

  it('GET /api/commission-payments/summary - sem auth retorna 401', async () => {
    const res = await supertest(app).get('/api/commission-payments/summary');
    expect(res.status).toBe(401);
  });
});
