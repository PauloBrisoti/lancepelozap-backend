/**
 * Alertas configuráveis para anomalias.
 *
 * - Webhook genérico (Slack/Teams/healthchecks.io compatível) via `ALERT_WEBHOOK_URL`.
 * - Thresholds via env (erro 5xx, memória, CPU, event loop, queries lentas).
 * - Dedupe por chave com cooldown (`ALERT_COOLDOWN_MS`, default 5 min).
 * - Watchdog periódico (`startWatchdog`) que varre métricas e dispara alertas.
 * - Nunca lança exceção: falha de envio é apenas logada.
 *
 * Env:
 *   ALERT_WEBHOOK_URL        — URL do webhook (desativa alertas se vazio)
 *   ALERT_WEBHOOK_HEADERS    — JSON opcional de headers (ex.: {"Authorization":"Bearer x"})
 *   ALERT_COOLDOWN_MS        — cooldown entre alertas da mesma chave (default 300000)
 *   ALERT_WATCHDOG_MS        — intervalo do watchdog (default 60000)
 *   ALERT_5XX_RATE_PERCENT   — % de 5xx na janela para alertar (default 10)
 *   ALERT_MEMORY_PERCENT     — % de heap usado (default 85)
 *   ALERT_CPU_PERCENT        — % CPU na janela (default 85)
 *   ALERT_EVENTLOOP_MS       — event loop lag (default 200)
 *   ALERT_SLOW_QUERY_MS      — query acima deste tempo conta como lenta (default 500)
 *   ALERT_SLOW_QUERY_MIN     — mínimo de queries lentas para alertar (default 5)
 */

import { metrics } from './metrics';
import { logger } from './logger';

interface AlertConfig {
  webhookUrl: string;
  headers: Record<string, string>;
  cooldownMs: number;
  watchdogMs: number;
  errorRatePercent: number;
  memoryPercent: number;
  cpuPercent: number;
  eventLoopMs: number;
  slowQueryMs: number;
  slowQueryMin: number;
}

function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function loadConfig(): AlertConfig {
  let headers: Record<string, string> = {};
  try { headers = JSON.parse(process.env.ALERT_WEBHOOK_HEADERS || '{}'); } catch { /* inválido */ }
  return {
    webhookUrl: process.env.ALERT_WEBHOOK_URL || '',
    headers,
    cooldownMs: envNum('ALERT_COOLDOWN_MS', 300_000),
    watchdogMs: envNum('ALERT_WATCHDOG_MS', 60_000),
    errorRatePercent: envNum('ALERT_5XX_RATE_PERCENT', 10),
    memoryPercent: envNum('ALERT_MEMORY_PERCENT', 85),
    cpuPercent: envNum('ALERT_CPU_PERCENT', 85),
    eventLoopMs: envNum('ALERT_EVENTLOOP_MS', 200),
    slowQueryMs: envNum('ALERT_SLOW_QUERY_MS', 500),
    slowQueryMin: envNum('ALERT_SLOW_QUERY_MIN', 5),
  };
}

class Alerts {
  private config = loadConfig();
  private lastSent = new Map<string, number>();

  get enabled(): boolean {
    return this.config.webhookUrl.length > 0;
  }

  /** Dispara alerta com dedupe por chave (cooldown). Retorna false se suprimido. */
  async fire(key: string, title: string, details: Record<string, unknown>): Promise<boolean> {
    const now = Date.now();
    const last = this.lastSent.get(key) || 0;
    if (now - last < this.config.cooldownMs) return false;
    this.lastSent.set(key, now);

    const payload = {
      text: title,
      attachments: [{
        color: 'danger',
        title,
        fields: Object.entries(details).map(([k, v]) => ({ title: k, value: String(v), short: true })),
        ts: Math.floor(now / 1000),
      }],
    };

    logger.warn(`ALERTA: ${title}`, { alertKey: key, ...details });

    if (!this.config.webhookUrl) return true;
    try {
      await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.config.headers },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      logger.warn('Falha ao enviar alerta', { err, alertKey: key });
    }
    return true;
  }

  /** Watchdog periódico: varre métricas e alerta em anomalias. */
  startWatchdog(): void {
    const cfg = this.config;
    const timer = setInterval(async () => {
      const s = metrics.snapshot();

      const total5xx = s.requests.endpoints.reduce((a, e) => a + e.errors, 0);
      const errorRate = s.requests.total > 0 ? (total5xx / s.requests.total) * 100 : 0;
      if (errorRate >= cfg.errorRatePercent) {
        await this.fire('rate-5xx', `Taxa de erro 5xx alta (${Math.round(errorRate * 100) / 100}%)`, {
          total: s.requests.total,
          errors: total5xx,
          window: `${cfg.watchdogMs / 1000}s`,
        });
      }

      if (s.memory.heapUsedPercent >= cfg.memoryPercent) {
        await this.fire('memory', `Memória alta (${s.memory.heapUsedPercent}% heap)`, {
          heapUsed: s.memory.heapUsed,
          heapTotal: s.memory.heapTotal,
          rss: s.memory.rss,
        });
      }

      if (s.cpu.percentLastWindow >= cfg.cpuPercent) {
        await this.fire('cpu', `CPU alta (${s.cpu.percentLastWindow}%)`, { loadAvg: s.cpu.loadAvg });
      }

      if (s.eventLoop.lagMs >= cfg.eventLoopMs) {
        await this.fire('event-loop', `Event loop bloqueado (${s.eventLoop.lagMs}ms)`, {
          avgMs: s.eventLoop.avgMs,
          maxMs: s.eventLoop.maxMs,
        });
      }

      const slowRecent = s.slowQueries.filter((q) => q.time > cfg.slowQueryMs).length;
      if (slowRecent >= cfg.slowQueryMin) {
        await this.fire('slow-queries', `Queries lentas em excesso (${slowRecent} na janela)`, {
          maxMs: s.database.maxMs,
          totalSlow: s.database.slow,
          exemplo: s.slowQueries[0]?.query?.slice(0, 150) || '',
        });
      }
    }, cfg.watchdogMs);

    if (typeof timer.unref === 'function') timer.unref();
    logger.info('Watchdog de alertas iniciado', { enabled: this.enabled, watchdogMs: cfg.watchdogMs });
  }

  /** Para testes: reinicia estado (cooldowns + config). */
  resetForTest(): void {
    this.lastSent.clear();
    this.config = loadConfig();
  }
}

export const alerts = new Alerts();
