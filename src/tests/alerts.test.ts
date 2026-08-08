import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { alerts } from '../lib/alerts';

describe('Alertas — dedupe e envio', () => {
  beforeEach(() => {
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/test';
    process.env.ALERT_COOLDOWN_MS = '50';
    alerts.resetForTest();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('envia payload JSON para o webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const sent = await alerts.fire('teste-chave', 'Erro crítico', { fluxo: 'login', count: 3 });
    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.example.com/test');
    const body = JSON.parse((opts as any).body);
    expect(body.text).toBe('Erro crítico');
    expect(body.attachments[0].title).toBe('Erro crítico');
  });

  it('dedupe: mesma chave dentro do cooldown não reenvia', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await alerts.fire('chave-x', 'Alerta A', {});
    const suppressed = await alerts.fire('chave-x', 'Alerta B', {});

    expect(suppressed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('após o cooldown, a mesma chave reenvia', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await alerts.fire('chave-y', 'Alerta A', {});
    await new Promise((r) => setTimeout(r, 60));
    await alerts.fire('chave-y', 'Alerta B', {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falha de rede no webhook não lança exceção', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const sent = await alerts.fire('chave-z', 'Alerta', {});
    expect(sent).toBe(true);
  });

  it('desabilitado sem ALERT_WEBHOOK_URL (apenas loga)', async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    alerts.resetForTest();
    expect(alerts.enabled).toBe(false);

    const sent = await alerts.fire('chave-w', 'Alerta local', {});
    expect(sent).toBe(true);
  });
});
