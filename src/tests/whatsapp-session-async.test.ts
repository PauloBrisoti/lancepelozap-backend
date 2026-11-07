import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createSuperAdmin } from './factory';
import { prisma } from '../lib/prisma';

/**
 * A criação de sessão WhatsApp não pode bloquear esperando o connect do
 * WuzAPI (que aguarda o QR por ~10s e estoura 500). A sessão nasce
 * QR_PENDING e o connect roda em background; o QR chega por polling.
 */
describe('Sessão WhatsApp — criação assíncrona (sem bloquear no QR)', () => {
  let rootToken: string;

  beforeAll(async () => {
    const root = await createSuperAdmin();
    const res = await request(app).post('/api/auth/login').send({ email: root.email, password: '123456' });
    rootToken = res.headers['set-cookie'][0].split(';')[0].split('=')[1];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /super-admin/whatsapp-sessions responde 201 pendente mesmo com connect infinito', async () => {
    const fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes('/admin/users')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      }
      if (u.includes('/session/connect')) {
        // Nunca resolve: se o controller aguardasse, o teste estouraria o timeout
        return new Promise(() => {});
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app)
      .post('/api/super-admin/whatsapp-sessions')
      .set('Cookie', [`authToken=${rootToken}`])
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('QR_PENDING');
    expect(res.body.id).toBeTruthy();
    expect(res.body.qrCode).toBe('');
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/admin/users'))).toBe(true);
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/session/connect'))).toBe(true);

    await prisma.whatsAppInstance.delete({ where: { id: res.body.id } });
  });

  it('GET /:id/qr responde rápido com QR vazio e dispara reconnect em background', async () => {
    const instance = await prisma.whatsAppInstance.create({
      data: {
        storeId: null,
        instanceName: `qr_async_${Date.now()}`,
        token: 'saas_test_async',
        status: 'QR_PENDING',
        phone: '',
      },
    });

    const fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes('/session/qr')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { base64: '' } }) });
      }
      if (u.includes('/session/connect')) {
        return new Promise(() => {});
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app)
      .get(`/api/super-admin/whatsapp-sessions/${instance.id}/qr`)
      .set('Cookie', [`authToken=${rootToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.qrCode).toBe('');
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/session/connect'))).toBe(true);

    await prisma.whatsAppInstance.delete({ where: { id: instance.id } });
  });
});
