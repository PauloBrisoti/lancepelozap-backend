import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { logger, runWithContext } from "./lib/logger";
import { verifyJwt } from "./lib/jwt";
import { metrics } from "./lib/metrics";
import { requestIdMiddleware, getRequestId } from "./middleware/requestId";
import { csrfProtection } from "./middleware/csrf";
import { sanitizeInput } from "./middleware/sanitize";
import { requireAuth } from "./middleware/auth";
import { requireInternalTeam } from "./middleware/requireInternalTeam";
import { prisma } from "./lib/prisma";
import { authRouter } from "./routes/auth";
import { customerRouter } from "./routes/customer.routes";
import { customerPortalRoutes } from './routes/customer-portal.routes';
import { categoryRouter } from "./routes/category.routes";
import { brandRouter } from "./routes/brand.routes";
import { productRouter } from "./routes/product.routes";
import { saleRouter } from "./routes/sale.routes";
import financeRoutes from './routes/finance.routes';
import dashboardRoutes from './routes/dashboard.routes';
import subscriptionRoutes from './routes/subscription.routes';
import { settingsRoutes } from './routes/settings.routes';
import { publicRoutes } from './routes/public.routes';
import { superAdminRoutes } from './routes/super-admin.routes';
import { webhookRoutes } from './routes/webhook.routes';
import { catalogoRoutes } from './routes/catalogo.routes';
import { productEntryRouter } from './routes/product-entry.routes';
import { planilhaRoutes } from './routes/planilha.routes';
import { storeRoutes } from './routes/store.routes';
import { cashRegisterRoutes } from './routes/cash-register.routes';
import { paymentFeesRoutes } from './routes/payment-fees.routes';
import { commissionRoutes } from './routes/commission.routes';
import { commissionPaymentRoutes } from './routes/commission-payment.routes';
import { supplierRoutes } from './routes/supplier.routes';
import { inventoryRoutes } from './routes/inventory.routes';
import { biRoutes } from './routes/bi.routes';
import { stockTransferRoutes } from './routes/stock-transfer.routes';
import { inventoryCountRoutes } from './routes/inventory-count.routes';
import { quoteRouter } from './routes/quote.routes';
import { purchaseRouter } from './routes/purchase.routes';
import { returnsRouter } from './routes/returns.routes';
import { whatsappRoutes } from './routes/whatsapp.routes';
import { serviceOrderRoutes } from './routes/service-order.routes';
import { appointmentRoutes } from './routes/appointment.routes';
import { insightsRouter } from './routes/insights';
import petRoutes from "./routes/pet.routes";
import { notificationRoutes } from './routes/notification.routes';
import v2Routes from './routes/v2.routes';

const app = express();
app.set('trust proxy', 1);

// ----- Request ID (rastreabilidade) -----
app.use(requestIdMiddleware);

// ----- Request logging (tempo, método, status) -----
// Roda dentro de um contexto AsyncLocalStorage: todos os logs da requisição
// (inclusive os de controllers/auth) herdam requestId + userId/storeId/role
// (injetados pelo auth via setContext) — ver lib/logger.ts.
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  runWithContext({ requestId: getRequestId(req) }, () => {
    // Log ao finalizar a resposta
    res.on('finish', () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

      logger.log(level, `${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`, {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
      });

      metrics.recordRequest(req.method, req.path, duration, res.statusCode);
    });

    next();
  });
});

// ----- Proteção CSRF -----
app.use(csrfProtection);

// ----- Sanitização de Input (XSS prevention) -----
app.use(sanitizeInput);

// ----- Security Headers (Helmet) -----
app.use(helmet({
  strictTransportSecurity: {
    maxAge: 63072000,
    includeSubDomains: true,
    preload: true,
  },
  // Explícitos (além do CSP): navegadores antigos que ignoram frame-ancestors
  xFrameOptions: { action: 'sameorigin' },
  crossOriginEmbedderPolicy: false,
  // CSP é definida por request abaixo (depende de NODE_ENV na hora da chamada)
  contentSecurityPolicy: false,
}));

// CSP dinâmica: em PRODUÇÃO os scripts inline/eval são bloqueados (o build do
// Vite gera assets externos; o Turnstile carrega de challenges.cloudflare.com).
// Em dev mantemos unsafe-inline/eval — necessários ao HMR do Vite.
function buildCSP(isProd: boolean): string {
  const scriptSrc = isProd
    ? "'self' https://challenges.cloudflare.com"
    : "'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' https: https://challenges.cloudflare.com",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src-attr 'none'",
    "upgrade-insecure-requests",
  ].join(';');
}

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', buildCSP(process.env.NODE_ENV === 'production'));
  next();
});

// Headers de segurança complementares (garantidos independentes do Helmet)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ----- CORS -----
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://localhost',
  'https://app.lancepelozap.com.br',
  'https://www.app.lancepelozap.com.br',
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || (isProduction && origin?.endsWith('.lancepelozap.com.br'))) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// ----- Proteção CSRF -----
// (após o cookieParser: csrfProtection lê req.cookies para detectar sessão)
app.use(csrfProtection);

// ----- Rate Limiting Global (distribuído via Redis; fallback in-memory) -----
import { rateLimitDistributed, limitFor } from './lib/rateLimit';
const globalLimiter = rateLimitDistributed({
  keyPrefix: 'global',
  keys: { ip: true },
  limits: [
    { windowMs: 60 * 1000, max: limitFor(200) },
    { windowMs: 60 * 60 * 1000, max: limitFor(600) },
  ],
  message: 'Muitas requisições. Tente novamente em instantes.',
});
app.use(globalLimiter);

// ----- Modo Manutenção (check global, cacheado 5s) -----
import { cache } from "./lib/cache";
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/super-admin') || req.path === '/health') return next();
  try {
    const setting = await cache.getOrSet<{ valor: unknown } | null>('settings', 'MAINTENANCE_MODE', 5, () =>
      prisma.systemSetting.findUnique({ where: { chave: 'MAINTENANCE_MODE' } }),
    );
    const modeValor = setting?.valor as { enabled?: boolean; message?: string } | null;
    if (modeValor?.enabled) {
      return res.status(503).json({ error: modeValor.message || 'Sistema em manutenção. Voltaremos em breve!' });
    }
  } catch (e) {
    logger.warn('Falha ao verificar modo manutenção', { err: e });
  }
  next();
});

import { supportRoutes } from './routes/support.routes';
import { importRoutes } from './routes/import.routes';
import { personalFinanceRoutes } from './routes/personalFinance.routes';
import { jobsRoutes } from './routes/jobs.routes';

// Limiters distribuídos por rota (IP + usuário quando autenticado, minuto + hora).
// Webhook do Mercado Pago fica com limiter local (IP fixo do MP, sem contexto de usuário).
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: 'Muitas requisições de webhook.' }, standardHeaders: true, legacyHeaders: false });
import rateLimit from 'express-rate-limit';

const superAdminLimiter = rateLimitDistributed({
  keyPrefix: 'admin',
  keys: { ip: true, user: true },
  limits: [
    { windowMs: 60 * 1000, max: limitFor(30) },
    { windowMs: 60 * 60 * 1000, max: limitFor(200) },
  ],
  message: 'Muitas requisições administrativas.',
});
const heavyQueryLimiter = rateLimitDistributed({
  keyPrefix: 'heavy-query',
  keys: { ip: true, user: true },
  limits: [
    { windowMs: 60 * 1000, max: limitFor(30) },
    { windowMs: 60 * 60 * 1000, max: limitFor(120) },
  ],
  message: 'Muitas consultas pesadas.',
});
const importLimiter = rateLimitDistributed({
  keyPrefix: 'import',
  keys: { ip: true, user: true },
  limits: [
    { windowMs: 60 * 1000, max: limitFor(10) },
    { windowMs: 60 * 60 * 1000, max: limitFor(40) },
  ],
  message: 'Muitas requisições de importação.',
});
const uploadLimiter = rateLimitDistributed({
  keyPrefix: 'upload',
  keys: { ip: true, user: true },
  limits: [
    { windowMs: 60 * 1000, max: limitFor(10) },
    { windowMs: 60 * 60 * 1000, max: limitFor(40) },
  ],
  message: 'Muitos uploads. Tente novamente.',
});
import path from 'path';

declare const __dirname: string;

// Servir arquivos estáticos (uploads de imagens) — protegido por autenticação
// Apenas usuários autenticados podem acessar arquivos enviados
// SEGURANÇA: arquivos novos seguem o padrão "<storeId>--<nome>"; o middleware
// confere que o usuário é dono da loja antes de servir. Arquivos antigos (sem
// prefixo) continuam acessíveis para não quebrar referências já salvas no banco.
const UPLOADS_DIR = path.join(__dirname, '../uploads');

app.use('/uploads', (req, res, next) => {
  const token = req.cookies?.authToken || req.cookies?.adminToken;
  if (!token) {
    return res.status(401).json({ error: 'Acesso negado.' });
  }
  let payload: jwt.JwtPayload | string;
  try {
    payload = verifyJwt(token);
  } catch {
    return res.status(401).json({ error: 'Token inválido.' });
  }

  // 1) Anti path traversal: o nome pedido precisa ser idêntico ao basename
  // (dentro de app.use('/uploads'), o req.path já vem sem o prefixo /uploads/)
  const requested = decodeURIComponent(req.path.split('?')[0]).replace(/^\/+/, '');
  if (requested !== path.basename(requested)) {
    return res.status(400).json({ error: 'Arquivo inválido.' });
  }
  if (!/^[A-Za-z0-9_.-]{1,160}$/.test(requested)) {
    return res.status(400).json({ error: 'Arquivo inválido.' });
  }

  // 1b) Nunca servir backups/arquivos de banco de dados pela web
  if (/\.(sql|sql\.gz|dump|bak)(\.gz)?$/i.test(requested)) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  // 2) Checagem de dono para arquivos novos (prefixed com storeId)
  const storeId = (payload as { storeId?: string }).storeId;
  const prefix = requested.split('--')[0];
  if (requested.includes('--')) {
    // Token sem storeId (equipe interna, usuários sem loja) não consegue
    // provar dono — bloqueia qualquer arquivo prefixado de outro tenant
    if (!storeId || prefix !== storeId) {
      return res.status(403).json({ error: 'Acesso negado a este arquivo.' });
    }
    return next();
  }

  // Arquivo legado (sem prefixo): permitido para manter compatibilidade
  next();
}, express.static(UPLOADS_DIR, {
  setHeaders: (res, filePath) => {
    // 3) Mitigação de XSS por upload: nunca renderizar conteúdo ativo
    // servido de /uploads como HTML/JS na mesma origem
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (/\.(html?|svg|xml|js|mjs|json|txt|md)$/i.test(filePath)) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment');
    }
  },
}));

// Healthcheck detalhado
// - /health       → liveness+summary (compatível com Docker/nginx e deploy.sh)
// - /health/ready → readiness completo (DB, Redis, disco, CPU, memória) — 503 se não pronto
function appVersion(): string {
  try { return require('../package.json').version; } catch { /* dev via tsx */ }
  try { return require('../../package.json').version; } catch { return 'dev'; }
}

async function checkDb() {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    logger.error('Healthcheck: falha ao consultar o banco', { err: e, action: 'healthcheck' });
    return { ok: false, latencyMs: Date.now() - start };
  }
}

async function checkDisk() {
  try {
    const { statfsSync } = require('fs');
    const stat = statfsSync('/');
    const available = stat.bsize * stat.bavail;
    const total = stat.bsize * stat.blocks;
    return { ok: available > total * 0.05, availableBytes: available, totalBytes: total };
  } catch {
    return { ok: true, availableBytes: null, totalBytes: null };
  }
}

app.get('/health', async (_req, res) => {
  const db = await checkDb();
  const perfMetrics = metrics.snapshot();

  res.json({
    status: db.ok ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    service: 'saas-backend',
    version: appVersion(),
    commit: process.env.BUILD_COMMIT || null,
    uptime: perfMetrics.uptimeHuman,
    database: {
      connected: db.ok,
      latency: `${db.latencyMs}ms`,
    },
    cache: { backend: cache.activeBackend },
    memory: { heapUsedPercent: perfMetrics.memory.heapUsedPercent },
    cpu: { percentLastWindow: perfMetrics.cpu.percentLastWindow },
  });
});

app.get('/health/ready', async (_req, res) => {
  const db = await checkDb();
  const redisOk = await cache.ping();
  const disk = await checkDisk();
  const perfMetrics = metrics.snapshot();
  const ready = db.ok && disk.ok;

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    service: 'saas-backend',
    version: appVersion(),
    commit: process.env.BUILD_COMMIT || null,
    uptime: perfMetrics.uptimeHuman,
    database: { connected: db.ok, latency: `${db.latencyMs}ms` },
    cache: { connected: redisOk, backend: cache.activeBackend },
    disk: { ok: disk.ok, availableBytes: disk.availableBytes, totalBytes: disk.totalBytes },
    memory: perfMetrics.memory,
    cpu: { percentLastWindow: perfMetrics.cpu.percentLastWindow, loadAvg: perfMetrics.cpu.loadAvg },
    eventLoop: perfMetrics.eventLoop,
  });
});

app.use('/api/auth', authRouter);
app.use('/api/public', publicRoutes);
app.use('/api/customers', customerRouter);
app.use('/api/customer-portal', customerPortalRoutes);
  app.use('/api/categories', categoryRouter);
  app.use('/api/brands', brandRouter);
  app.use('/api/products', productRouter);
app.use('/api/sales', saleRouter);
app.use('/api/finance', financeRoutes);
app.use('/api/dashboard', heavyQueryLimiter, dashboardRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/super-admin', superAdminLimiter, superAdminRoutes);
app.use('/api/webhooks', webhookLimiter, webhookRoutes);
app.use('/api/catalogo', catalogoRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/import', importLimiter, importRoutes);
app.use('/api/product-entries', productEntryRouter);
app.use('/api/planilha', uploadLimiter, planilhaRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/cash-register', cashRegisterRoutes);
app.use('/api/payment-fees', paymentFeesRoutes);
app.use('/api/commissions', commissionRoutes);
app.use('/api/commission-payments', commissionPaymentRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/bi', heavyQueryLimiter, biRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/stock-transfers', stockTransferRoutes);
app.use('/api/inventory-counts', inventoryCountRoutes);
app.use('/api/quotes', quoteRouter);
app.use('/api/purchases', purchaseRouter);
app.use('/api/returns', returnsRouter);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/service-orders', serviceOrderRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/insights', insightsRouter);

// Finanças Pessoais (PF)
app.use('/api/personal', personalFinanceRoutes);

// Notificações do sistema
app.use('/api/pet', petRoutes);
app.use('/api/notifications', notificationRoutes);

// Admin alias — /api/admin/* same as /api/super-admin/*
// SEGURANÇA: mesmo rate limit do /api/super-admin (antes ficava sem limite)
app.use('/api/admin', superAdminLimiter, superAdminRoutes);

// Métricas detalhadas (prometheus-style)
// SEGURANÇA: apenas equipe interna (lojistas não veem slow queries do servidor)
app.get('/api/metrics', requireAuth, requireInternalTeam, (_req, res) => {
  res.json(metrics.snapshot());
});

// Métricas em formato Prometheus (scrape pelo Prometheus/Grafana)
app.get('/api/metrics/prometheus', requireAuth, requireInternalTeam, (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(metrics.prometheusText());
});

// Rota de fallback para healthcheck
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// V2 Routes
app.use('/api/v2', v2Routes);

// Jobs/cron HTTP-trigger — protegidos por CRON_SECRET (Bearer, timing-safe;
// query string bloqueada). Para provedores externos de cron (cron-job.org etc.)
app.use('/api/jobs', jobsRoutes);

// ----- 404 Handler -----
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Rota não encontrada', path: req.path, requestId: getRequestId(req) });
});

// ----- Handler de erro estruturado -----
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message || "Erro interno do servidor";

  // Uploads: arquivo acima do limite configurado no multer → 413
  if (err?.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    message = 'Arquivo muito grande para este tipo de upload.';
  } else if (err?.name === 'MulterError') {
    status = 400;
    message = 'Falha no upload do arquivo.';
  }

  // requestId/userId/storeId entram automaticamente via contexto (mixin)
  logger.error(`[${status}] ${message}`, err, {
    path: req.path,
    method: req.method,
    status,
  });

  // Em produção, não vazar stack trace ou detalhes internos
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(status).json({
    error: isProduction && status >= 500 ? 'Erro interno do servidor' : message,
    requestId: getRequestId(req),
    ...(err.captchaRequired ? { captchaRequired: true } : {}),
    ...(err.emailVerificationRequired ? { emailVerificationRequired: true } : {}),
    ...(isProduction ? {} : { stack: err.stack }),
  });
});

export default app;
