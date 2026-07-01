/**
 * Logger estruturado em JSON.
 *
 * Uso:
 *   logger.info('Usuário criado', { userId: '123', email: 'a@b.com' });
 *   logger.error('Falha ao criar venda', { saleId: '456' }, error);
 *   const log = logger.child({ requestId: 'abc-123' });
 *   log.warn('Estoque baixo', { productId: '789' });
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  requestId?: string;
  storeId?: string;
  userId?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  duration?: number; // ms
  query?: string;
  memory?: NodeJS.MemoryUsage;
}

const isDev = process.env.NODE_ENV !== 'production';

function formatMemory(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

class Logger {
  private baseContext: LogContext = {};

  constructor(baseContext?: LogContext) {
    if (baseContext) this.baseContext = baseContext;
  }

  child(context: LogContext): Logger {
    return new Logger({ ...this.baseContext, ...context });
  }

  private write(level: LogLevel, message: string, context?: LogContext, error?: unknown) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.baseContext, ...context },
    };

    if (error instanceof Error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: isDev ? error.stack : undefined,
        code: (error as any).code,
      };
    }

    // Adiciona memória em produção para debug
    if (!isDev) {
      entry.memory = process.memoryUsage();
    }

    // Desenvolvimento: saída colorida legível
    if (isDev) {
      const prefix = entry.context?.requestId
        ? `[${entry.context.requestId.substring(0, 8)}]`
        : '';
      const color = level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : '\x1b[36m';
      const mem = entry.memory ? ` ${formatMemory(entry.memory.heapUsed)}` : '';
      console.log(`${color}[${level.toUpperCase()}]${prefix} ${message}${mem}\x1b[0m`, context || '');
      if (entry.error?.stack) console.error(entry.error.stack);
      return;
    }

    // Produção: JSON puro
    console.log(JSON.stringify(entry));
  }

  debug(message: string, context?: LogContext) {
    if (!isDev) return; // debug apenas em dev
    this.write('debug', message, context);
  }

  info(message: string, context?: LogContext) {
    this.write('info', message, context);
  }

  warn(message: string, context?: LogContext) {
    this.write('warn', message, context);
  }

  error(message: string, error?: unknown, context?: LogContext) {
    this.write('error', message, context, error);
  }

  /** Log de query com duração */
  query(query: string, durationMs: number, context?: LogContext) {
    if (isDev) {
      const slow = durationMs > 100 ? ' 🐌' : '';
      console.log(`\x1b[90m[SQL] ${durationMs.toFixed(0)}ms${slow} ${query.substring(0, 120)}\x1b[0m`);
    }
    if (durationMs > 500) {
      this.warn('Query lenta detectada', { ...context, query: query.substring(0, 200), duration: durationMs });
    }
  }
}

export const logger = new Logger();
