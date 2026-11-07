import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore, createSuperAdmin } from './factory';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('Super Admin Dashboard — MRR e Churn', () => {
  let agent: request.Agent;
  let clientId: string;
  let planId: string;

  beforeAll(async () => {
    const admin = await createSuperAdmin();
    agent = request.agent(app);

    const login = await agent
      .post('/api/auth/login')
      .send({ email: admin.email, password: '123456' });
    expect(login.status).toBe(200);

    const created = await createClientWithStore();
    clientId = created.client.id;

    const plan = await prisma.plan.create({
      data: {
        nome: 'Plano Dashboard',
        precoMensal: 100,
        maxControls: 1,
        maxStores: 1,
        maxEmployees: 3,
      },
    });
    planId = plan.id;

    const createdAtAnterior = new Date(Date.now() - 40 * MS_PER_DAY);

    // MRR vigente: PAGO e vencimento futuro
    await prisma.subscription.create({
      data: {
        clientId,
        planId,
        valorMensalidade: 100,
        statusPagamento: 'PAGO',
        dataVencimento: new Date(Date.now() + 5 * MS_PER_DAY),
        createdAt: createdAtAnterior,
      },
    });

    // Histórico: PAGO, mas vencido -> não entra no MRR
    await prisma.subscription.create({
      data: {
        clientId,
        planId,
        valorMensalidade: 200,
        statusPagamento: 'PAGO',
        dataVencimento: new Date(Date.now() - 5 * MS_PER_DAY),
        createdAt: createdAtAnterior,
      },
    });

    // Cancelada neste mês (updatedAt = agora) -> entra no churn
    await prisma.subscription.create({
      data: {
        clientId,
        planId,
        valorMensalidade: 300,
        statusPagamento: 'CANCELADO',
        dataVencimento: new Date(Date.now() + 5 * MS_PER_DAY),
        createdAt: createdAtAnterior,
      },
    });

    // Ativa antiga (PENDENTE) -> compõe apenas a base do churn
    await prisma.subscription.create({
      data: {
        clientId,
        planId,
        valorMensalidade: 50,
        statusPagamento: 'PENDENTE',
        dataVencimento: new Date(Date.now() + 5 * MS_PER_DAY),
        createdAt: createdAtAnterior,
      },
    });
  });

  it('calcula MRR somente com assinaturas vigentes', async () => {
    const res = await agent.get('/api/super-admin/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.mrr).toBe(100);
    expect(res.body.totalRevenue).toBe(100);
    expect(res.body.topStores).toHaveLength(1);
    expect(res.body.topStores[0].faturamentoTotal).toBe(100);
  });

  it('calcula churn mensal sobre as ativas do início do mês', async () => {
    const res = await agent.get('/api/super-admin/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.churn.cancelledThisMonth).toBe(1);
    expect(res.body.churn.activeAtStartOfMonth).toBe(4);
    expect(res.body.churnRate).toBe(25);
  });
});
