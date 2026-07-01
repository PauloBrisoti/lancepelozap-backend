import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

const request = supertest.agent(app);

describe('Devoluções (Returns) API', () => {
  let client: any;
  let productId: string;
  let productId2: string;
  let saleId: string;
  let saleItemId: string;
  let saleItemId2: string;

  beforeAll(async () => {
    client = await createClientWithStore();
    const loginRes = await request.post('/api/auth/login').send({
      email: client.user.email,
      password: '123456',
    });
    expect(loginRes.status).toBe(200);

    // Create category
    const cat = await prisma.category.create({
      data: { nome: 'Dev Cat', storeId: client.store.id, corHexadecimal: '#abc' },
    });

    // Create 2 products
    const p1 = await prisma.product.create({
      data: {
        storeId: client.store.id,
        categoryId: cat.id,
        nome: 'Produto Devolver A',
        precoCusto: 10,
        precoVendaSugerido: 30,
        qtdEstoqueAtual: 50,
        codigoVisual: 'DEVA',
        status: 'ATIVO',
      },
    });
    productId = p1.id;

    const p2 = await prisma.product.create({
      data: {
        storeId: client.store.id,
        categoryId: cat.id,
        nome: 'Produto Devolver B',
        precoCusto: 20,
        precoVendaSugerido: 60,
        qtdEstoqueAtual: 30,
        codigoVisual: 'DEVB',
        status: 'ATIVO',
      },
    });
    productId2 = p2.id;

    // Create a sale via API
    const saleRes = await request.post('/api/sales').send({
      itens: [
        { productId, quantidade: 5, precoUnitarioVendido: 30 },
        { productId: productId2, quantidade: 3, precoUnitarioVendido: 60 },
      ],
      formaPagamento: 'DINHEIRO',
    });
    expect(saleRes.status).toBe(201);
    saleId = saleRes.body.id;

    // Fetch sale items from DB
    const saleItems = await prisma.saleItem.findMany({ where: { saleId } });
    saleItemId = saleItems[0].id;
    saleItemId2 = saleItems[1].id;
  });

  afterAll(async () => {
    await prisma.productReturnItem.deleteMany({ where: { productReturn: { storeId: client.store.id } } }).catch(() => {});
    await prisma.productReturn.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.saleItem.deleteMany({ where: { sale: { storeId: client.store.id } } }).catch(() => {});
    await prisma.sale.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.product.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.category.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.storeUserAccess.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.store.delete({ where: { id: client.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: client.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: client.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: client.user.id } }).catch(() => {});
  });

  it('GET /api/returns - lista vazia inicialmente', async () => {
    const res = await request.get('/api/returns');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('POST /api/returns - cria devolução de 2 itens', async () => {
    const res = await request.post('/api/returns').send({
      saleId,
      items: [
        { saleItemId, quantidade: 2 },
        { saleItemId: saleItemId2, quantidade: 1 },
      ],
      motivo: 'Cliente desistiu',
    });
    expect(res.status).toBe(201);
    expect(res.body.saleId).toBe(saleId);
    expect(res.body.status).toBe('PENDENTE');
    expect(res.body.items).toHaveLength(2);
    expect(res.body.motivo).toBe('Cliente desistiu');
  });

  it('GET /api/returns - retorna devolução criada', async () => {
    const res = await request.get('/api/returns');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].items).toBeDefined();
  });

  it('GET /api/returns/:id - retorna devolução por id', async () => {
    const list = await request.get('/api/returns');
    const ret = list.body.data[0];

    const res = await request.get(`/api/returns/${ret.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ret.id);
  });

  it('POST /api/returns/:id/approve - aprova devolução', async () => {
    const list = await request.get('/api/returns');
    const ret = list.body.data[0];

    const res = await request.post(`/api/returns/${ret.id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APROVADO');
  });

  it('POST /api/returns/:id/complete - conclui e restoca', async () => {
    const list = await request.get('/api/returns');
    const ret = list.body.data[0];

    const res = await request.post(`/api/returns/${ret.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CONCLUIDO');

    const p1 = await prisma.product.findUnique({ where: { id: productId } });
    expect(Number(p1!.qtdEstoqueAtual)).toBe(47);

    const p2 = await prisma.product.findUnique({ where: { id: productId2 } });
    expect(Number(p2!.qtdEstoqueAtual)).toBe(28);
  });

  it('POST /api/returns/:id/complete - erro se já concluída', async () => {
    const list = await request.get('/api/returns');
    const ret = list.body.data[0];

    const res = await request.post(`/api/returns/${ret.id}/complete`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/precisa estar APROVADA|concluída|status inválido|apenas/i);
  });

  describe('segunda devolução', () => {
    let returnId: string;

    it('cria devolução para testar rejeição', async () => {
      const res = await request.post('/api/returns').send({
        saleId,
        items: [{ saleItemId, quantidade: 1 }],
      });
      expect(res.status).toBe(201);
      returnId = res.body.id;
      expect(res.body.status).toBe('PENDENTE');
    });

    it('POST /api/returns/:id/reject - rejeita devolução', async () => {
      const res = await request.post(`/api/returns/${returnId}/reject`).send({
        motivoRejeicao: 'Produto danificado',
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REJEITADO');
      expect(res.body.motivo).toMatch(/Rejeitado: Produto danificado/);
    });

    it('POST /api/returns/:id/reject - erro se já rejeitada', async () => {
      const res = await request.post(`/api/returns/${returnId}/reject`);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/status|rejeitar|rejeitada/i);
    });

    it('POST /api/returns/:id/approve - erro se já rejeitada', async () => {
      const res = await request.post(`/api/returns/${returnId}/approve`);
      expect(res.status).toBe(400);
    });
  });
});
