import { describe, it, expect } from 'vitest';
import { cache } from '../lib/cache';
import { metrics } from '../lib/metrics';

const prefix = `cache-test-${Math.random().toString(36).slice(2)}`;

describe('Cache — tracking de hit/miss', () => {
  it('miss no primeiro acesso, hit no segundo (getOrSet)', async () => {
    let calls = 0;
    const fn = async () => { calls++; return { valor: 42 }; };

    const a = await cache.getOrSet(prefix, 'k1', 60, fn);
    const b = await cache.getOrSet(prefix, 'k1', 60, fn);

    expect(a).toEqual({ valor: 42 });
    expect(b).toEqual({ valor: 42 });
    expect(calls).toBe(1);

    const snap = metrics.snapshot();
    const entry = snap.cache.find((c) => c.prefix === prefix);
    expect(entry).toBeDefined();
    expect(entry!.misses).toBeGreaterThanOrEqual(1);
    expect(entry!.hits).toBeGreaterThanOrEqual(1);
  });

  it('TTL expirado causa novo miss e recarga', async () => {
    let calls = 0;
    const fn = async () => { calls++; return 'novo'; };

    await cache.getOrSet(prefix, 'k2', 1, fn);
    await new Promise((r) => setTimeout(r, 1100));
    const v = await cache.getOrSet(prefix, 'k2', 1, fn);

    expect(v).toBe('novo');
    expect(calls).toBe(2);
  });

  it('del remove a chave (próximo acesso é miss)', async () => {
    await cache.set(prefix, 'k3', 'x', 60);
    expect(await cache.get(prefix, 'k3')).toBe('x');
    await cache.del(prefix, 'k3');
    expect(await cache.get(prefix, 'k3')).toBeNull();
  });

  it('get retorna null para chave inexistente sem lançar', async () => {
    expect(await cache.get(prefix, 'inexistente')).toBeNull();
  });
});
