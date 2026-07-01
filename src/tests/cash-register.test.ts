import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

describe('Cash Register (integração)', () => {
  let client: any;
  let agent: request.Agent;

  beforeAll(async () => {
    agent = request.agent(app);
    client = await createClientWithStore();

    const loginRes = await agent
      .post('/api/auth/login')
      .send({ email: client.user.email, password: '123456' });
    expect(loginRes.status).toBe(200);
  });

  afterAll(async () => {
    if (client) {
      await prisma.cashTransaction.deleteMany({ where: { cashRegister: { storeId: client.store.id } } });
      await prisma.cashRegister.deleteMany({ where: { storeId: client.store.id } });
    }
    await prisma.storeUserAccess.deleteMany({ where: { storeId: client?.store?.id } });
    await prisma.store.delete({ where: { id: client?.store?.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: client?.control?.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: client?.client?.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client?.client?.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: client?.user?.id } }).catch(() => {});
  });

  afterEach(async () => {
    if (client) {
      await prisma.cashTransaction.deleteMany({ where: { cashRegister: { storeId: client.store.id } } });
      await prisma.cashRegister.deleteMany({ where: { storeId: client.store.id } });
    }
  });

  it('POST /api/cash-register/open — abre caixa', async () => {
    const res = await agent.post('/api/cash-register/open').send({
      valorTrocoInicial: 50,
    });
    expect(res.status).toBe(201);
    expect(res.body.cashRegister.status).toBe('ABERTO');
    expect(Number(res.body.cashRegister.valorTrocoInicial)).toBe(50);
  });

  it('GET /api/cash-register/current — retorna caixa aberto', async () => {
    await agent.post('/api/cash-register/open').send({ valorTrocoInicial: 50 });
    const res = await agent.get('/api/cash-register/current');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ABERTO');
  });

  it('POST /api/cash-register/close — fecha caixa com diferença', async () => {
    await agent.post('/api/cash-register/open').send({ valorTrocoInicial: 100 });
    const res = await agent.post('/api/cash-register/close').send({
      valorTotalFechamento: 500,
    });
    expect(res.status).toBe(200);
    expect(res.body.cashRegister.status).toBe('FECHADO');
    // Expected: trocoInicial(100) + vendas(0) + suprimentos(0) - sangrias(0) = 100
    expect(Number(res.body.saldoEsperado)).toBe(100);
    expect(Number(res.body.diferenca)).toBe(400); // 500 - 100
    expect(Number(res.body.cashRegister.saldoEsperado)).toBe(100);
    expect(Number(res.body.cashRegister.diferenca)).toBe(400);
  });

  it('POST /api/cash-register/open — rejeita duplicado', async () => {
    await agent.post('/api/cash-register/open').send({ valorTrocoInicial: 50 });
    const res = await agent.post('/api/cash-register/open').send({ valorTrocoInicial: 100 });
    expect(res.status).toBe(400);
  });

  it('POST /api/cash-register/close — rejeita sem caixa aberto', async () => {
    const res = await agent.post('/api/cash-register/close').send({ valorTotalFechamento: 500 });
    expect(res.status).toBe(404);
  });

  it('POST /api/cash-register/transaction — registra sangria', async () => {
    await agent.post('/api/cash-register/open').send({ valorTrocoInicial: 50 });
    const res = await agent.post('/api/cash-register/transaction').send({
      tipo: 'SANGRIA',
      valor: 30,
      descricao: 'Compra de café',
    });
    expect(res.status).toBe(201);
    expect(res.body.transaction.tipo).toBe('SANGRIA');
    expect(Number(res.body.transaction.valor)).toBe(30);
  });

  it('POST /api/cash-register/transaction — registra suprimento', async () => {
    await agent.post('/api/cash-register/open').send({ valorTrocoInicial: 50 });
    const res = await agent.post('/api/cash-register/transaction').send({
      tipo: 'SUPRIMENTO',
      valor: 200,
      descricao: 'Recarga de troco',
    });
    expect(res.status).toBe(201);
    expect(res.body.transaction.tipo).toBe('SUPRIMENTO');
  });

  it('GET /api/cash-register/history — retorna histórico', async () => {
    await agent.post('/api/cash-register/open').send({ valorTrocoInicial: 50 });
    await agent.post('/api/cash-register/close').send({ valorTotalFechamento: 500 });
    const res = await agent.get('/api/cash-register/history');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.records)).toBe(true);
    expect(res.body.data.records.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/cash-register/:id/summary — retorna relatório detalhado', async () => {
    const open = await agent.post('/api/cash-register/open').send({ valorTrocoInicial: 100 });
    const registerId = open.body.cashRegister.id;

    // Create a sale linked to this cash register
    const cat = await prisma.category.create({
      data: { nome: 'Sum Cat', storeId: client.store.id, corHexadecimal: '#999' },
    });
    const product = await prisma.product.create({
      data: {
        storeId: client.store.id, categoryId: cat.id, nome: 'Sum Proj',
        precoCusto: 10, precoVendaSugerido: 50, qtdEstoqueAtual: 100, codigoVisual: 'SUM', status: 'ATIVO',
      },
    });
    const saleRes = await agent.post('/api/sales').send({
      cashRegisterId: registerId,
      itens: [{ productId: product.id, quantidade: 2, precoUnitarioVendido: 50 }],
      formaPagamento: 'DINHEIRO',
    });
    expect(saleRes.status).toBe(201);

    // Add a sangria
    await agent.post('/api/cash-register/transaction').send({
      tipo: 'SANGRIA', valor: 20, descricao: 'Teste',
    });

    // Close
    await agent.post('/api/cash-register/close').send({ valorTotalFechamento: 200 });

    // Get summary
    const res = await agent.get(`/api/cash-register/${registerId}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.cashRegister.id).toBe(registerId);
    expect(res.body.totais.totalVendas).toBe(100); // 2 * 50
    expect(res.body.totais.quantidadeVendas).toBe(1);
    expect(res.body.totais.trocoInicial).toBe(100);
    // Expected: 100 (troco) + 100 (vendas) - 20 (sangria) = 180
    expect(res.body.totais.saldoEsperado).toBe(180);
    expect(res.body.totais.valorDeclarado).toBe(200);
    expect(res.body.totais.diferenca).toBe(20);
    expect(res.body.totais.porFormaPagamento.DINHEIRO).toBe(100);

    await prisma.product.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.category.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
  });

  it('GET /api/cash-register/current — sem auth retorna 401', async () => {
    const res = await request(app).get('/api/cash-register/current');
    expect(res.status).toBe(401);
  });
});
