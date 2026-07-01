import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
import { logger } from "./logger";
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

// Logging de queries com tempo
prisma.$on('query' as any, (e: any) => {
  const { query, duration } = e;
  logger.query(query, duration);
  if (duration > 500) {
    metrics.recordSlowQuery(query, duration);
  }
});
