import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

describe('PJ Dashboard Consolidado (GET /api/dashboard/pj/consolidated)', () => {
  let client: any;
  let agent: request.Agent;
  let secondStore: any;

  beforeAll(async () => {
    client = await createClientWithStore({ visaoConsolidada: true });
    agent = request.agent(app);

    // Create a second store under the same control
    secondStore = await prisma.store.create({
      data: {
        controlId: client.control.id,
        nomeFantasia: 'Segunda Loja',
        status: 'ATIVO',
        storeUsers: {
          create: { userId: client.user.id, role: 'MANAGER' }
        }
      }
    });

    // Create a sale in the first store
    await prisma.sale.create({
      data: {
        storeId: client.store.id,
        userId: client.user.id,
        formaPagamento: 'PIX',
        valorTotalBruto: 200,
        valorDesconto: 0,
        valorTaxasGateway: 5,
        valorTotalLiquido: 195,
        cmvTotal: 80,
        status: 'CONCLUIDA',
        dataVenda: new Date(),
      }
    });

    // Create a sale in the second store
    await prisma.sale.create({
      data: {
        storeId: secondStore.id,
        userId: client.user.id,
        formaPagamento: 'DINHEIRO',
        valorTotalBruto: 300,
        valorDesconto: 0,
        valorTaxasGateway: 0,
        valorTotalLiquido: 300,
        cmvTotal: 120,
        status: 'CONCLUIDA',
        dataVenda: new Date(),
      }
    });

    await agent
      .post('/api/auth/login')
      .send({ email: client.user.email, password: '123456' });
  });

  afterAll(async () => {
    await prisma.sale.deleteMany({ where: { storeId: { in: [client.store.id, secondStore.id] } } }).catch(() => {});
    await prisma.storeUserAccess.deleteMany({ where: { storeId: secondStore.id } });
    await prisma.store.delete({ where: { id: secondStore.id } }).catch(() => {});
    await prisma.storeUserAccess.deleteMany({ where: { storeId: client.store.id } });
    await prisma.store.delete({ where: { id: client.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: client.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: client.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: client.user.id } }).catch(() => {});
  });

  it('retorna dados consolidados de todas as lojas', async () => {
    const res = await agent.get('/api/dashboard/pj/consolidated');
    expect(res.status).toBe(200);
    expect(res.body.totalStores).toBeGreaterThanOrEqual(2);
    expect(res.body).toHaveProperty('consolidated');
    expect(res.body).toHaveProperty('stores');
    expect(Array.isArray(res.body.stores)).toBe(true);
  });

  it('consolidated contém totais agregados corretos', async () => {
    const res = await agent.get('/api/dashboard/pj/consolidated');
    const c = res.body.consolidated;
    expect(c.volumeVendas).toBeGreaterThanOrEqual(200);
    expect(c.receita).toBeGreaterThanOrEqual(0);
    expect(c.lucroBruto).toBeDefined();
    expect(c.estoqueImobilizado).toBeDefined();
    expect(c.aReceberFiado).toBeDefined();
  });

  it('stores contém métricas individuais por loja', async () => {
    const res = await agent.get('/api/dashboard/pj/consolidated');
    const stores = res.body.stores;
    expect(stores.length).toBeGreaterThanOrEqual(2);

    const first = stores.find((s: any) => s.storeId === client.store.id);
    expect(first).toBeDefined();
    expect(first.storeName).toBeTruthy();
    expect(first.volumeVendas).toBeDefined();
    expect(first.receita).toBeDefined();
  });

  it('duas lojas com dados diferentes têm métricas distintas', async () => {
    const res = await agent.get('/api/dashboard/pj/consolidated');
    const first = res.body.stores.find((s: any) => s.storeId === client.store.id);
    const second = res.body.stores.find((s: any) => s.storeId === secondStore.id);
    expect(first.volumeVendas).not.toBe(second.volumeVendas);
  });

  it('requer autenticação', async () => {
    const res = await request(app).get('/api/dashboard/pj/consolidated');
    expect(res.status).toBe(401);
  });
});
