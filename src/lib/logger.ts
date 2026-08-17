/**
 * Logger profissional (Pino) com:
 *  - Saída JSON estruturada (produção) e legível (desenvolvimento)
 *  - Níveis: debug, info, warn, error, fatal
 *  - Contexto automático por requisição via AsyncLocalStorage
 *    (requestId, userId, storeId, role são injetados em TODO log)
 *  - Sanitização rigorosa: senhas, tokens e dados pessoais (CPF, e-mail,
 *    telefone, cartão) são mascarados ANTES de qualquer gravação
 *  - Redact do Pino como camada de segurança profunda (qualquer aninhamento)
 *
 * Uso:
 *   import { logger, runWithContext, setContext } from '../lib/logger';
 *   logger.info('Usuário criado', { userId: '123' });
 *   logger.error('Falha ao criar venda', err, { saleId: '456' });
 *   logger.fatal('Processo inválido', err); // nível fatal
 *
 *   // Em middlewares:
 *   runWithContext({ requestId }, () => next());
 *   // Depois da autenticação:
 *   setContext({ userId: payload.id, storeId: payload.storeId, role: payload.role });
 */

import pino, { type Logger as PinoLogger, type DestinationStream, type Level } from 'pino';
import { AsyncLocalStorage } from 'async_hooks';

// ============================================================
// Contexto por requisição (AsyncLocalStorage)
// ============================================================

export interface RequestContext {
  requestId?: string;
  userId?: string;
  storeId?: string;
  role?: string;
  [key: string]: unknown;
}

const als = new AsyncLocalStorage<RequestContext>();

/** Executa `fn` dentro de um contexto de requisição (middleware). */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/** Atualiza o contexto da requisição corrente (ex.: após autenticar). */
export function setContext(partial: Partial<RequestContext>): void {
  const current = als.getStore();
  if (current) Object.assign(current, partial);
  else als.enterWith({ ...partial });
}

function getContext(): RequestContext {
  return als.getStore() || {};
}

// ============================================================
// Sanitização (data masking)
// ============================================================

// Chaves que NUNCA podem ser gravadas (valor integral substituído)
const REDACT_TOTAL = /password|passwd|senha|authorization|cookie|api[_-]?key|secret|session|token|credential|signature|cvv|cvc/i;

// Chaves de dados pessoais: apenas prefixo/sufixo visíveis
const REDACT_PARTIAL = /^(cpf|cnpj|rg|email|phone|celular|telefone|whatsapp|cart[ãa]o|card|cc_?number|pix|nascimento|birthdate|data[_-]?nascimento|nome[_-]?completo|endere[çc]o)/i;

function partialMask(value: unknown): string {
  const s = String(value);
  if (s.length <= 4) return '[REDACTED]';
  return `${s.slice(0, 3)}***${s.slice(-2)}`;
}

/** Mascara recursivamente objetos/arrays por nome de chave. */
export function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => sanitize(v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (REDACT_TOTAL.test(key)) out[key] = '[REDACTED]';
      else if (REDACT_PARTIAL.test(key) && (typeof val === 'string' || typeof val === 'number')) out[key] = partialMask(val);
      else out[key] = sanitize(val);
    }
    return out;
  }
  return value;
}

// Redige segredos embutidos em strings (ex.: URLs com ?token=..., headers)
const SECRET_IN_STRING = /((?:password|passwd|senha|token|secret|api[_-]?key|authorization|cookie)\s*[=:]\s*)([^&\s"'<>]+)/gi;

export function maskSecretsInString(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SECRET_IN_STRING, '$1[REDACTED]');
  if (Array.isArray(value)) return value.map(maskSecretsInString);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskSecretsInString(v);
    return out;
  }
  return value;
}

// ============================================================
// Logger
// ============================================================

export interface LoggerOptions {
  level?: Level;
  /** Stream/destino customizado (testes). Default: stdout */
  destination?: DestinationStream;
  pretty?: boolean;
}

export class AppLogger {
  readonly raw: PinoLogger;

  constructor(options: LoggerOptions = {}) {
    const isDev = process.env.NODE_ENV !== 'production';
    const level: Level = (options.level || process.env.LOG_LEVEL || (isDev ? 'debug' : 'info')) as Level;

    this.raw = pino(
      {
        level,
        timestamp: pino.stdTimeFunctions.isoTime,
        base: { service: 'saas-backend', env: process.env.NODE_ENV || 'development' },
        // Camada de segurança profunda: qualquer campo aninhado com esses nomes
        // é censurado pelo Pino, mesmo fora da nossa sanitização.
        redact: {
          paths: [
            'password', '*.password', '*password*',
            'senha', '*.senha', '*senha*',
            'token', '*.token', '*token*',
            'authorization', '*.authorization', '*authorization*',
            'cookie', '*.cookie', '*cookie*',
            'apiKey', '*.apiKey', '*apiKey*', 'api_key', '*api_key*',
            'secret', '*.secret', '*secret*',
            'credential', '*.credential', '*credential*',
            'cvv', '*.cvv', '*cvv*', 'cardNumber', '*.cardNumber', '*cardNumber*',
            'sessionId', '*.sessionId', '*sessionId*',
          ],
          censor: '[REDACTED]',
        },
        // Contexto automático da requisição (injetado em TODO log)
        mixin: () => sanitize(getContext()) as Record<string, unknown>,
        serializers: {
          err: (err: unknown) => {
            const e = err as Error & { code?: string };
            const base = pino.stdSerializers.err(e);
            return {
              ...base,
              message: maskSecretsInString(base.message ?? '') as string,
              stack: maskSecretsInString(base.stack ?? '') as string,
            };
          },
        },
        formatters: {
          level: (label) => ({ level: label }),
        },
      },
      options.destination,
    );
  }

  child(context: RequestContext): AppLogger {
    const rawChild = this.raw.child(sanitize(context) as Record<string, unknown>);
    const child = new AppLogger();
    Object.defineProperty(child, 'raw', { value: rawChild, enumerable: false });
    return child;
  }

  private write(level: Level, message: string, errorOrContext?: unknown, maybeContext?: RequestContext) {
    const isErrorCall = errorOrContext instanceof Error;
    const context = isErrorCall ? (maybeContext ?? {}) : ((errorOrContext ?? {}) as RequestContext);

    // Guarda contra context não-objeto (ex.: chamadas legadas com args soltos)
    const safeContext: RequestContext =
      context && typeof context === 'object' && !Array.isArray(context) ? context : {};

    const payload = {
      ...sanitize(maskSecretsInString(safeContext)) as Record<string, unknown>,
      ...(isErrorCall ? { err: errorOrContext } : {}),
    };

    (this.raw as unknown as Record<string, (obj: unknown, msg?: string) => void>)[level](payload, message);
  }

  debug(message: string, context?: RequestContext) { this.write('debug', message, context); }
  info(message: string, context?: RequestContext) { this.write('info', message, context); }
  warn(message: string, context?: RequestContext) { this.write('warn', message, context); }
  error(message: string, error?: unknown, context?: RequestContext) { this.write('error', message, error, context); }
  fatal(message: string, error?: unknown, context?: RequestContext) { this.write('fatal', message, error, context); }

  /** Log com nível dinâmico (ex.: pelo status HTTP). */
  log(level: Level, message: string, context?: RequestContext) { this.write(level, message, context); }

  /** Log de query lenta (apenas quando excede o limite). */
  query(query: string, durationMs: number, context?: RequestContext) {
    if (durationMs > 500) {
      this.warn('Query lenta detectada', {
        ...context,
        query: query.substring(0, 200),
        duration: durationMs,
      });
    }
  }
}

export const logger = new AppLogger();
