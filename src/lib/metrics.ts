/**
 * Coletor de métricas de performance.
 *
 * Mantém contadores e timers em memória para:
 * - Total de requisições por endpoint (tempo, erro, histograma de latência)
 * - Queries do banco (contagem, duração média, máximas, lentas)
 * - Cache (hits/misses por namespace)
 * - Memória (heap, RSS)
 * - CPU (percentual da última janela) e event loop lag
 * - Exposição em JSON (`snapshot()`) e formato Prometheus (`prometheusText()`)
 */

interface EndpointMetric {
  count: number;
  totalTime: number;
  errors: number;
  lastTime: number;
  histogram: Record<string, number>;
}

interface CacheMetric {
  hits: number;
  misses: number;
}

const LATENCY_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000];

class MetricsCollector {
  private endpoints: Map<string, EndpointMetric> = new Map();
  private slowQueries: { query: string; time: number; timestamp: string }[] = [];
  private queryStats = { count: 0, totalTime: 0, maxTime: 0, slow: 0 };
  private cacheStats = new Map<string, CacheMetric>();
  private startTime = Date.now();
  private lastCpuSample = process.cpuUsage();
  private lastCpuAt = process.hrtime.bigint();
  private lastEventLoopLag = 0;
  private eventLoopSample: { sum: number; count: number; max: number } = { sum: 0, count: 0, max: 0 };

  constructor() {
    this.watchEventLoop();
  }

  /** Mede o event loop lag em intervalos de 10s (amostra média). */
  private watchEventLoop() {
    const timer = setInterval(() => {
      const start = process.hrtime.bigint();
      setImmediate(() => {
        const lag = Number(process.hrtime.bigint() - start) / 1e6;
        this.lastEventLoopLag = lag;
        this.eventLoopSample.sum += lag;
        this.eventLoopSample.count++;
        if (lag > this.eventLoopSample.max) this.eventLoopSample.max = lag;
      });
    }, 10_000);
    // Não impede a saída do processo (testes/scripts).
    if (typeof timer.unref === 'function') timer.unref();
  }

  /** Registra uma requisição concluída */
  recordRequest(method: string, path: string, durationMs: number, status: number) {
    const key = `${method} ${path}`;
    const current = this.endpoints.get(key) || {
      count: 0, totalTime: 0, errors: 0, lastTime: 0, histogram: {},
    };
    current.count++;
    current.totalTime += durationMs;
    current.lastTime = durationMs;
    if (status >= 500) current.errors++;
    for (const bucket of LATENCY_BUCKETS_MS) {
      if (durationMs <= bucket) {
        current.histogram[bucket] = (current.histogram[bucket] || 0) + 1;
        break;
      }
    }
    this.endpoints.set(key, current);
  }

  /** Registra uma query do banco (todas, com tempo). */
  recordQuery(durationMs: number) {
    this.queryStats.count++;
    this.queryStats.totalTime += durationMs;
    if (durationMs > this.queryStats.maxTime) this.queryStats.maxTime = durationMs;
  }

  /** Registra uma query lenta (para alerta e ranking). */
  recordSlowQuery(query: string, time: number) {
    this.queryStats.slow++;
    this.slowQueries.unshift({ query, time, timestamp: new Date().toISOString() });
    if (this.slowQueries.length > 100) this.slowQueries.pop();
  }

  /** Registra hit/miss de cache por namespace. */
  recordCache(prefix: string, hit: boolean) {
    const current = this.cacheStats.get(prefix) || { hits: 0, misses: 0 };
    if (hit) current.hits++;
    else current.misses++;
    this.cacheStats.set(prefix, current);
  }

  /** Percentual de CPU usado desde a última amostra. */
  cpuPercent(): number {
    const now = process.hrtime.bigint();
    const usage = process.cpuUsage(this.lastCpuSample);
    const elapsedMs = Number(now - this.lastCpuAt) / 1e6;
    this.lastCpuSample = process.cpuUsage();
    this.lastCpuAt = now;
    if (elapsedMs <= 0) return 0;
    return Math.min(100, Math.round(((usage.user + usage.system) / 1000 / elapsedMs) * 10000) / 100);
  }

  /** Retorna snapshot das métricas */
  snapshot() {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const mem = process.memoryUsage();
    const heapLimit = require('v8').getHeapStatistics().heap_size_limit;
    const totalReqs = Array.from(this.endpoints.values()).reduce((s, e) => s + e.count, 0);

    return {
      uptime,
      uptimeHuman: `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      cpu: { percentLastWindow: this.cpuPercent(), loadAvg: Math.round(require('os').loadavg()[0] * 100) / 100 },
      eventLoop: { lagMs: Math.round(this.lastEventLoopLag * 100) / 100, avgMs: this.eventLoopSample.count ? Math.round((this.eventLoopSample.sum / this.eventLoopSample.count) * 100) / 100 : 0, maxMs: this.eventLoopSample.max },
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        heapLimit,
        rss: mem.rss,
        // Percentual contra o LIMITE do heap (não o heapTotal atual — o V8
        // cresce o heapTotal preguiçosamente e heapUsed/heapTotal fica ~92%
        // em apps pequenos, disparando alerta falso de memória).
        heapUsedPercent: Math.round((mem.heapUsed / heapLimit) * 100),
      },
      requests: {
        total: totalReqs,
        endpoints: Array.from(this.endpoints.entries()).map(([key, m]) => ({
          endpoint: key,
          count: m.count,
          avgTime: Math.round(m.totalTime / m.count),
          lastTime: m.lastTime,
          errors: m.errors,
          errorRate: m.count > 0 ? Math.round((m.errors / m.count) * 10000) / 100 : 0,
          histogram: m.histogram,
        })),
      },
      database: {
        queries: this.queryStats.count,
        avgMs: this.queryStats.count ? Math.round((this.queryStats.totalTime / this.queryStats.count) * 100) / 100 : 0,
        maxMs: this.queryStats.maxTime,
        slow: this.queryStats.slow,
      },
      cache: Array.from(this.cacheStats.entries()).map(([prefix, m]) => ({
        prefix,
        hits: m.hits,
        misses: m.misses,
        hitRate: m.hits + m.misses > 0 ? Math.round((m.hits / (m.hits + m.misses)) * 10000) / 100 : 0,
      })),
      slowQueries: this.slowQueries.slice(0, 10),
    };
  }

  /** Exposição Prometheus (text format, versão 0.0.4). */
  prometheusText(): string {
    const s = this.snapshot();
    const lines: string[] = [];
    const push = (name: string, value: number, labels = '') => lines.push(`${name}${labels ? `{${labels}}` : ''} ${value}`);

    push('saas_uptime_seconds', s.uptime);
    push('saas_cpu_percent', s.cpu.percentLastWindow);
    push('saas_cpu_loadavg1', s.cpu.loadAvg);
    push('saas_eventloop_lag_ms', s.eventLoop.lagMs);
    push('saas_eventloop_lag_max_ms', s.eventLoop.maxMs);
    push('saas_memory_heap_used_bytes', s.memory.heapUsed);
    push('saas_memory_heap_total_bytes', s.memory.heapTotal);
    push('saas_memory_rss_bytes', s.memory.rss);
    push('saas_requests_total', s.requests.total);
    push('saas_requests_5xx_total', s.requests.endpoints.reduce((a, e) => a + e.errors, 0));
    push('saas_db_queries_total', s.database.queries);
    push('saas_db_query_avg_ms', s.database.avgMs);
    push('saas_db_query_max_ms', s.database.maxMs);
    push('saas_db_slow_queries_total', s.database.slow);

    for (const e of s.requests.endpoints) {
      const labels = `endpoint="${e.endpoint.replace(/"/g, '\\"')}"`;
      push('saas_request_count', e.count, labels);
      push('saas_request_avg_ms', e.avgTime, labels);
      push('saas_request_error_count', e.errors, labels);
    }
    for (const c of s.cache) {
      push('saas_cache_hits_total', c.hits, `cache="${c.prefix}"`);
      push('saas_cache_misses_total', c.misses, `cache="${c.prefix}"`);
    }
    return lines.join('\n') + '\n';
  }
}

export const metrics = new MetricsCollector();
