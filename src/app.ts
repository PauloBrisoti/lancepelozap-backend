import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { randomUUID } from "crypto";
import { logger } from "./lib/logger";
import { metrics } from "./lib/metrics";
import { requestIdMiddleware, getRequestId } from "./middleware/requestId";
import { csrfProtection } from "./middleware/csrf";
import { sanitizeInput } from "./middleware/sanitize";
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
import { notificationRoutes } from './routes/notification.routes';

const app = express();

// ----- Request ID (rastreabilidade) -----
app.use(requestIdMiddleware);

// ----- Request logging (tempo, método, status) -----
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = getRequestId(req);
  const log = logger.child({ requestId });

  // Log ao finalizar a resposta
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    log[level](`${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`, {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
    });

    metrics.recordRequest(req.method, req.path, duration, res.statusCode);
  });

  next();
});

// ----- Proteção CSRF -----
app.use(csrfProtection);

// ----- Sanitização de Input (XSS prevention) -----
app.use(sanitizeInput);

// ----- Security Headers (Helmet) -----
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      fontSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  strictTransportSecurity: {
    maxAge: 63072000,
    includeSubDomains: true,
    preload: true,
  },
}));

// ----- CORS -----
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = [
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

// ----- Modo Manutenção (check global) -----
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/super-admin') || req.path === '/health') return next();
  try {
    const { prisma } = await import('./lib/prisma');
    const setting = await prisma.systemSetting.findUnique({ where: { chave: 'MAINTENANCE_MODE' } });
    const modeValor = setting?.valor as { enabled?: boolean; message?: string } | null;
    if (modeValor?.enabled) {
      return res.status(503).json({ error: modeValor.message || 'Sistema em manutenção. Voltaremos em breve!' });
    }
  } catch {}
  next();
});

import { supportRoutes } from './routes/support.routes';
import { importRoutes } from './routes/import.routes';
import path from 'path';
import { fileURLToPath } from 'url';

// @ts-ignore
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Servir arquivos estáticos (uploads de imagens) — protegido por autenticação
// Apenas usuários autenticados podem acessar arquivos enviados
app.use('/uploads', (req, res, next) => {
  // Rotas públicas de upload (comprovantes, imagens de produtos) são servidas via controller
  // O acesso direto via /uploads/ exige token válido
  const token = req.cookies?.authToken;
  if (!token) {
    return res.status(401).json({ error: 'Acesso negado.' });
  }
  try {
    const jwt = require('jsonwebtoken');
    jwt.verify(token, process.env.JWT_SECRET || 'fallback');
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido.' });
  }
}, express.static(path.join(__dirname, '../uploads')));

// Healthcheck detalhado
app.get('/health', async (_req, res) => {
  let dbOk = false;
  let dbLatency = 0;
  let dbSize = 0;
  try {
    const dbStart = Date.now();
    const { prisma } = await import('./lib/prisma');
    await prisma.$queryRaw`SELECT 1`;
    dbLatency = Date.now() - dbStart;
    dbOk = true;
    const sizeResult = await prisma.$queryRaw<{ size: string }[]>`SELECT pg_database_size(current_database())::text as size`;
    dbSize = parseInt(sizeResult[0]?.size || '0');
  } catch {}

  const perfMetrics = metrics.snapshot();
  const mem = process.memoryUsage();

  res.json({
    status: dbOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: perfMetrics.uptimeHuman,
    node: process.version,
    env: process.env.NODE_ENV || 'development',
    database: {
      connected: dbOk,
      latency: `${dbLatency}ms`,
      size: dbSize,
    },
    memory: {
      heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
    },
    requests: {
      total: perfMetrics.requests.total,
      lastMinute: 0,
    },
  });
});

app.use('/api/auth', authRouter);
app.use('/api/customers', customerRouter);
app.use('/api/customer-portal', customerPortalRoutes);
  app.use('/api/categories', categoryRouter);
  app.use('/api/brands', brandRouter);
  app.use('/api/products', productRouter);
app.use('/api/sales', saleRouter);
app.use('/api/finance', financeRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/catalogo', catalogoRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/import', importRoutes);
app.use('/api/product-entries', productEntryRouter);
app.use('/api/planilha', planilhaRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/cash-register', cashRegisterRoutes);
app.use('/api/payment-fees', paymentFeesRoutes);
app.use('/api/commissions', commissionRoutes);
app.use('/api/commission-payments', commissionPaymentRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/bi', biRoutes);
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

// Notificações do sistema
app.use('/api/notifications', notificationRoutes);

// Admin alias — /api/admin/* same as /api/super-admin/*
app.use('/api/admin', superAdminRoutes);

// Métricas detalhadas (prometheus-style)
app.get('/api/metrics', (_req, res) => {
  res.json(metrics.snapshot());
});

// Rota de fallback para healthcheck
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ----- 404 Handler -----
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Rota não encontrada', path: req.path });
});

// ----- Handler de erro estruturado -----
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const requestId = getRequestId(req);
  const log = logger.child({ requestId });
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Erro interno do servidor";

  log.error(`[${status}] ${message}`, err, {
    path: req.path,
    method: req.method,
    status,
  });

  // Em produção, não vazar stack trace ou detalhes internos
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(status).json({
    error: isProduction && status >= 500 ? 'Erro interno do servidor' : message,
    requestId,
    ...(isProduction ? {} : { stack: err.stack }),
  });
});

export default app;
