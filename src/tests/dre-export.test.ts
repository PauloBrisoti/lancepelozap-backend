import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

describe('DRE Export (GET /api/finance/dre/export)', () => {
  let client: any;
  let agent: request.Agent;

  beforeAll(async () => {
    client = await createClientWithStore();
    agent = request.agent(app);

    await agent
      .post('/api/auth/login')
      .send({ email: client.user.email, password: '123456' });

    const wallet = await prisma.wallet.create({
      data: { storeId: client.store.id, saldoAtual: 0, tipo: 'OPERACIONAL', nome: 'Carteira Teste' }
    });

    await prisma.sale.create({
      data: {
        storeId: client.store.id,
        userId: client.user.id,
        formaPagamento: 'DINHEIRO',
        valorTotalBruto: 100,
        valorDesconto: 10,
        valorTaxasGateway: 0,
        valorTotalLiquido: 90,
        cmvTotal: 40,
        status: 'CONCLUIDA',
        dataVenda: new Date(),
      }
    });

    await prisma.financialTransaction.create({
      data: {
        storeId: client.store.id,
        walletId: wallet.id,
        tipo: 'SAIDA',
        valor: 25,
        categoria: 'ALUGUEL',
        descricao: 'Aluguel do mês',
        dataTransacao: new Date(),
      }
    });
  });

  afterAll(async () => {
    await prisma.financialTransaction.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.sale.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.storeUserAccess.deleteMany({ where: { storeId: client.store.id } });
    await prisma.store.delete({ where: { id: client.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: client.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: client.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: client.user.id } }).catch(() => {});
  });

  it('exporta CSV com dados do período', async () => {
    const res = await agent.get('/api/finance/dre/export?formato=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('.csv');
    expect(res.text).toContain('Receita Operacional Bruta');
    expect(res.text).toContain('100.00');
    expect(res.text).toContain('ALUGUEL');
    expect(res.text).toContain('25.00');
  });

  it('exporta CSV com BOM (UTF-8)', async () => {
    const res = await agent.get('/api/finance/dre/export?formato=csv');
    expect(res.text.charCodeAt(0)).toBe(0xFEFF);
  });

  it('exporta PDF com dados do período', async () => {
    const res = await agent.get('/api/finance/dre/export?formato=pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('.pdf');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(1000);
  });

  it('requer autenticação', async () => {
    const res = await request(app).get('/api/finance/dre/export?formato=csv');
    expect(res.status).toBe(401);
  });
});
