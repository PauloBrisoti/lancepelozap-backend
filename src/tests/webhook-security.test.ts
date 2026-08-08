import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createHmac } from 'crypto';

const WEBHOOK_SECRET = 'test-webhook-secret';
const ACCESS_TOKEN = 'test-access-token';

function sign(preapprovalId: string, ts: number): string {
  const manifest = `${preapprovalId}.${ts}`;
  return `ts=${ts},v1=${createHmac('sha256', WEBHOOK_SECRET).update(manifest).digest('hex')}`;
}

let clientId: string;
let planId: string;

async function createSubscription(preapprovalId: string) {
  return prisma.subscription.create({
    data: {
      clientId,
      planId,
      valorMensalidade: 49.9,
      dataVencimento: new Date('2026-08-01'),
      statusPagamento: 'PENDENTE',
      mpPreapprovalId: preapprovalId,
    },
  });
}

function postWebhook(preapprovalId: string, signature: string, extra: any = {}) {
  return request(app)
    .post('/api/webhooks/mercadopago')
    .set('x-signature', signature)
    .send({ type: 'subscription_preapproval', data: { id: preapprovalId }, ...extra });
}

beforeAll(async () => {
  process.env.MP_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.MP_ACCESS_TOKEN = ACCESS_TOKEN;

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const plan = await prisma.plan.create({
    data: {
      nome: `Plan Webhook ${suffix}`,
      precoMensal: 49.9,
      maxControls: 1,
      maxStores: 1,
      maxEmployees: 3,
    },
  });
  planId = plan.id;

  const client = await prisma.client.create({
    data: {
      nomeCompleto: `Client Webhook ${suffix}`,
      email: `wh_${suffix}@lpzteste.app`,
      cnpjCpf: `00${suffix.slice(0, 9)}`,
    },
  });
  clientId = client.id;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      const id = u.split('/').pop() || '';
      const status = id.includes('pending') ? 'pending' : 'authorized';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id,
          status,
          next_payment_date: '2026-09-01T00:00:00.000Z',
        }),
      } as Response;
    })
  );
});

afterAll(async () => {
  await prisma.webhookEvent.deleteMany({ where: { preapprovalId: { contains: 'preapproval' } } });
  await prisma.subscription.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.plan.delete({ where: { id: planId } });
  vi.unstubAllGlobals();
  await prisma.$disconnect();
});

describe('Webhook MP — autenticação (assinatura HMAC)', () => {
  it('rejeita requisição sem header x-signature', async () => {
    const res = await request(app)
      .post('/api/webhooks/mercadopago')
      .send({ type: 'subscription_preapproval', data: { id: 'x' } });
    expect(res.status).toBe(401);
  });

  it('rejeita assinatura inválida', async () => {
    const res = await postWebhook('preapproval_1', 'ts=9999999999,v1=abc123');
    expect(res.status).toBe(401);
  });

  it('rejeita assinatura com timestamp fora da janela (replay)', async () => {
    const oldTs = Math.floor(Date.now() / 1000) - 600; // 10 min atrás
    const sig = sign('preapproval_1', oldTs);
    const res = await postWebhook('preapproval_1', sig);
    expect(res.status).toBe(401);
  });
});

describe('Webhook MP — processamento e idempotência', () => {
  it('confirma na API oficial e renova apenas com status autorizado', async () => {
    const sub = await createSubscription('preapproval_paid');
    const sig = sign('preapproval_paid', Math.floor(Date.now() / 1000));

    const res = await postWebhook('preapproval_paid', sig);
    expect(res.status).toBe(200);

    const updated = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(updated?.statusPagamento).toBe('PAGO');
    expect(updated?.mpStatus).toBe('authorized');
    expect(updated?.dataVencimento.toISOString()).toContain('2026-09-01');

    const events = await prisma.webhookEvent.count({
      where: { preapprovalId: 'preapproval_paid' },
    });
    expect(events).toBe(1);
  });

  it('NÃO renova quando o provedor retorna status pendente', async () => {
    const sub = await createSubscription('preapproval_pending');
    const sig = sign('preapproval_pending', Math.floor(Date.now() / 1000));

    const res = await postWebhook('preapproval_pending', sig);
    expect(res.status).toBe(200);

    const updated = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(updated?.statusPagamento).toBe('PENDENTE');
    expect(updated?.mpStatus).toBe('pending');
    expect(updated?.dataVencimento.toISOString()).toContain('2026-08-01');
  });

  it('replay do mesmo evento (data.id) não processa duas vezes', async () => {
    const sub = await createSubscription('preapproval_replay');
    const ts = Math.floor(Date.now() / 1000);
    const sig = sign('preapproval_replay', ts);

    const first = await postWebhook('preapproval_replay', sig);
    expect(first.status).toBe(200);

    // 2ª entrega: o evento já está registrado → 200, sem duplicar registro
    const second = await postWebhook('preapproval_replay', sig);
    expect(second.status).toBe(200);

    const events = await prisma.webhookEvent.count({
      where: { preapprovalId: 'preapproval_replay' },
    });
    expect(events).toBe(1);

    // Vencimento renovado uma única vez
    const updated = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(updated?.dataVencimento.toISOString()).toContain('2026-09-01');
  });
});
