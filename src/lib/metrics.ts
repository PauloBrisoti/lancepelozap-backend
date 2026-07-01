/**
 * Coletor de métricas de performance.
 *
 * Mantém contadores e timers em memória para:
 * - Total de requisições por endpoint
 * - Tempo médio de resposta
 * - Taxa de erro
 * - Queries lentas
 * - Uso de memória
 */

interface EndpointMetric {
  count: number;
  totalTime: number;
  errors: number;
  lastTime: number;
}

class MetricsCollector {
  private endpoints: Map<string, EndpointMetric> = new Map();
  private slowQueries: { query: string; time: number; timestamp: string }[] = [];
  private startTime = Date.now();

  /** Registra uma requisição concluída */
  recordRequest(method: string, path: string, durationMs: number, status: number) {
    const key = `${method} ${path}`;
    const current = this.endpoints.get(key) || { count: 0, totalTime: 0, errors: 0, lastTime: 0 };
    current.count++;
    current.totalTime += durationMs;
    current.lastTime = durationMs;
    if (status >= 500) current.errors++;
    this.endpoints.set(key, current);
  }

  /** Registra uma query lenta */
  recordSlowQuery(query: string, time: number) {
    this.slowQueries.unshift({ query, time, timestamp: new Date().toISOString() });
    if (this.slowQueries.length > 100) this.slowQueries.pop();
  }

  /** Retorna snapshot das métricas */
  snapshot() {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const mem = process.memoryUsage();
    const totalReqs = Array.from(this.endpoints.values()).reduce((s, e) => s + e.count, 0);

    return {
      uptime,
      uptimeHuman: `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        heapUsedPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
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
        })),
      },
      slowQueries: this.slowQueries.slice(0, 10),
    };
  }
}

export const metrics = new MetricsCollector();
