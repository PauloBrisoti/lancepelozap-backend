import { describe, it, expect } from 'vitest';
import { metrics } from '../lib/metrics';

function resetInternalMetrics() {
  // Métricas são singleton; usamos prefixos únicos por teste para não interferir
  return `test-${Math.random().toString(36).slice(2)}`;
}

describe('Métricas — requisições', () => {
  it('acumula contagem, tempo médio e erro por endpoint', () => {
    const prefix = resetInternalMetrics();
    const path = `/${prefix}/x`;

    metrics.recordRequest('GET', path, 100, 200);
    metrics.recordRequest('GET', path, 300, 500);

    const snap = metrics.snapshot();
    const ep = snap.requests.endpoints.find((e) => e.endpoint === `GET ${path}`);
    expect(ep).toBeDefined();
    expect(ep!.count).toBe(2);
    expect(ep!.avgTime).toBe(200);
    expect(ep!.errors).toBe(1);
    expect(ep!.errorRate).toBe(50);
  });
});

describe('Métricas — queries do banco', () => {
  it('registra contagem, média e máximas de TODAS as queries', () => {
    const before = metrics.snapshot().database;
    metrics.recordQuery(10);
    metrics.recordQuery(30);
    const snap = metrics.snapshot().database;
    expect(snap.queries).toBe(before.queries + 2);
    expect(snap.maxMs).toBeGreaterThanOrEqual(30);

    // Uma query muito lenta puxa a média acumulada para cima (estado é cumulativo global)
    const beforeAvg = metrics.snapshot().database.avgMs;
    metrics.recordQuery(99999);
    const after = metrics.snapshot().database;
    expect(after.avgMs).toBeGreaterThan(beforeAvg);
    expect(after.maxMs).toBe(99999);
  });

  it('registra slow queries com amostra no ranking', () => {
    metrics.recordSlowQuery('SELECT 1', 1200);
    const snap = metrics.snapshot();
    expect(snap.database.slow).toBeGreaterThanOrEqual(1);
    expect(snap.slowQueries[0].query).toContain('SELECT');
  });
});

describe('Métricas — cache hit/miss', () => {
  it('contabiliza hits e misses com taxa de efetividade', () => {
    const prefix = resetInternalMetrics();
    metrics.recordCache(prefix, true);
    metrics.recordCache(prefix, true);
    metrics.recordCache(prefix, false);

    const snap = metrics.snapshot();
    const entry = snap.cache.find((c) => c.prefix === prefix);
    expect(entry).toBeDefined();
    expect(entry!.hits).toBe(2);
    expect(entry!.misses).toBe(1);
    expect(entry!.hitRate).toBe(66.67);
  });
});

describe('Métricas — CPU e event loop', () => {
  it('cpuPercent retorna número entre 0 e 100', () => {
    const pct = metrics.cpuPercent();
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it('snapshot inclui cpu, event loop e memória', () => {
    const snap = metrics.snapshot();
    expect(snap.cpu.loadAvg).toBeGreaterThanOrEqual(0);
    expect(snap.eventLoop.lagMs).toBeGreaterThanOrEqual(0);
    expect(snap.memory.heapUsed).toBeGreaterThan(0);
  });
});

describe('Métricas — Prometheus format', () => {
  it('emite texto com métricas fundamentais', () => {
    const text = metrics.prometheusText();
    expect(text).toContain('saas_uptime_seconds');
    expect(text).toContain('saas_requests_total');
    expect(text).toContain('saas_memory_heap_used_bytes');
    expect(text).toContain('saas_db_queries_total');
    expect(text).toContain('saas_cache_hits_total');
    expect(text).toContain('\n');
  });

  it('formato Prometheus não é JSON', () => {
    expect(() => JSON.parse(metrics.prometheusText())).toThrow();
  });
});
