import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';

describe('Observabilidade HTTP — healthcheck', () => {
  beforeAll(async () => {
    // Garante banco disponível para o teste de readiness
    await prisma.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('/health retorna status healthy, versão e campos essenciais', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.service).toBe('saas-backend');
    expect(res.body.version).toBeTruthy();
    expect(res.body.database.connected).toBe(true);
    expect(res.body.database.latency).toMatch(/ms$/);
    expect(res.body.memory.heapUsedPercent).toBeGreaterThan(0);
    expect(res.body.cache.backend).toMatch(/^(redis|memory)$/);
  });

  it('/health/ready retorna 200 com detalhes de DB, cache, disco e CPU', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.database.connected).toBe(true);
    expect(res.body.disk.ok).toBe(true);
    expect(res.body.cache).toBeDefined();
    expect(res.body.memory.rss).toBeGreaterThan(0);
  });
});

describe('Observabilidade HTTP — requestId', () => {
  it('toda resposta tem header X-Request-Id único', async () => {
    const res = await request(app).get('/health');
    const id1 = res.headers['x-request-id'];
    expect(id1).toBeTruthy();

    const res2 = await request(app).get('/health');
    expect(res2.headers['x-request-id']).toBeTruthy();
    expect(res2.headers['x-request-id']).not.toBe(id1);
  });

  it('reutiliza X-Request-Id inbound válido (rastreabilidade fim-a-fim)', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'cliente-trace-123');
    expect(res.headers['x-request-id']).toBe('cliente-trace-123');
  });

  it('ignora X-Request-Id inbound inválido e gera novo', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'invalido!@#');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('erro 404 inclui requestId na resposta', async () => {
    const res = await request(app).get('/rota-inexistente-xyz');
    expect(res.status).toBe(404);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});

describe('Observabilidade HTTP — métricas', () => {
  it('/api/metrics exige autenticação de equipe interna', async () => {
    const res = await request(app).get('/api/metrics');
    expect(res.status).toBe(401);
  });

  it('/api/metrics/prometheus exige autenticação', async () => {
    const res = await request(app).get('/api/metrics/prometheus');
    expect(res.status).toBe(401);
  });
});
