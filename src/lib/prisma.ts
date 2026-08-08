import { PrismaClient } from "@prisma/client";
import { logger, maskSecretsInString } from "./logger";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
import { metrics } from "./metrics";

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL não configurada.");
}

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({
  adapter,
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'stdout', level: 'warn' },
    { emit: 'stdout', level: 'error' },
  ],
});

// Logging de TODAS as queries com tempo (rastreabilidade + detecção de regressão):
//  - nível debug: toda query, com duração e parâmetros truncados (contexto em requisição via ALS)
//  - nível warn: queries lentas (>500ms), com stack do chamador para localizar o ponto quente
//  - métricas: contagem, média, máximas, lentas
const QUERY_SLOW_MS = Number(process.env.QUERY_SLOW_MS || 500);
prisma.$on('query' as any, (e: any) => {
  const { query, params, duration } = e;
  // Parâmetros podem conter dados pessoais (CPF, e-mail...) — sanitiza e trunca
  const safeParams = typeof params === 'string' ? String(maskSecretsInString(params)).slice(0, 200) : undefined;

  metrics.recordQuery(duration);

  if (duration > QUERY_SLOW_MS) {
    logger.warn('Query lenta', {
      query: query.slice(0, 500),
      params: safeParams,
      duration,
      thresholdMs: QUERY_SLOW_MS,
      caller: new Error('slow-query').stack?.split('\n').slice(2, 5).join(' | '),
    });
    metrics.recordSlowQuery(query, duration);
  } else {
    logger.debug('Query executada', { query: query.slice(0, 300), params: safeParams, duration });
  }
});
