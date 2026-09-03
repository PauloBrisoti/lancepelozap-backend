import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createSuperAdmin, createClientWithStore } from './factory';
import { prisma } from '../lib/prisma';

describe('Persistência da aba Módulos & Assinaturas (edição de cliente)', () => {
  let superToken: string;
  let plan: { id: string };
  let clientId: string;

  beforeAll(async () => {
    const admin = await createSuperAdmin();
    const resA = await request(app).post('/api/auth/login').send({ email: admin.email, password: '123456' });
    superToken = resA.headers['set-cookie'][0].split(';')[0].split('=')[1];

    plan = await prisma.plan.create({
      data: { nome: 'Pro', precoMensal: 99.9, maxControls: 1, maxStores: 1 }
    });

    // Cliente SEM assinatura (reproduz o cenário do bug: campos sumiam no save)
    const { client } = await createClientWithStore();
    clientId = client.id;
  });

  it('cliente sem assinatura: salvar Plano/Status/Vencimento cria a assinatura de verdade', async () => {
    const res = await request(app)
      .put(`/api/super-admin/clients/${clientId}`)
      .set('Cookie', [`authToken=${superToken}`])
      .send({ planoId: plan.id, statusPagamento: 'PAGO', dataVencimento: '2026-12-31', workspaceType: 'PJ' });
    expect(res.status).toBe(200);

    const sub = await prisma.subscription.findFirst({ where: { clientId } });
    expect(sub).toBeTruthy();
    expect(sub!.planId).toBe(plan.id);
    expect(sub!.statusPagamento).toBe('PAGO');
    expect(sub!.dataVencimento.toISOString().slice(0, 10)).toBe('2026-12-31');
    expect(Number(sub!.valorMensalidade)).toBe(99.9);
  });

  it('recarregar a tela (GET /clients) mostra os dados persistidos', async () => {
    const res = await request(app).get('/api/super-admin/clients').set('Cookie', [`authToken=${superToken}`]);
    expect(res.status).toBe(200);
    const c = res.body.find((x: any) => x.id === clientId);
    expect(c?.subscriptions?.length).toBe(1);
    expect(c.subscriptions[0].planId).toBe(plan.id);
    expect(c.subscriptions[0].statusPagamento).toBe('PAGO');
    expect(c.subscriptions[0].dataVencimento.slice(0, 10)).toBe('2026-12-31');
  });

  it('salvar de novo atualiza a MESMA assinatura (não duplica) e persiste status/data', async () => {
    const before = await prisma.subscription.findFirst({ where: { clientId } });

    const res = await request(app)
      .put(`/api/super-admin/clients/${clientId}`)
      .set('Cookie', [`authToken=${superToken}`])
      .send({ planoId: plan.id, statusPagamento: 'PENDENTE', dataVencimento: '2027-01-15' });
    expect(res.status).toBe(200);

    const subs = await prisma.subscription.findMany({ where: { clientId } });
    expect(subs.length).toBe(1);
    expect(subs[0].id).toBe(before!.id);
    expect(subs[0].statusPagamento).toBe('PENDENTE');
    expect(subs[0].dataVencimento.toISOString().slice(0, 10)).toBe('2027-01-15');
  });

  it('plano inválido retorna 404 e NÃO altera a assinatura existente', async () => {
    const res = await request(app)
      .put(`/api/super-admin/clients/${clientId}`)
      .set('Cookie', [`authToken=${superToken}`])
      .send({ planoId: 'nao-existe', statusPagamento: 'PAGO', dataVencimento: '2026-12-31' });
    expect(res.status).toBe(404);

    const sub = await prisma.subscription.findFirst({ where: { clientId } });
    expect(sub!.planId).toBe(plan.id);
    expect(sub!.statusPagamento).toBe('PENDENTE');
  });
});