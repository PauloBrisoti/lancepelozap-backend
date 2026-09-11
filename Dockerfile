# ============================================================
# Backend Dockerfile — Multi-stage, multi-platform (ARM64 + AMD64)
# ============================================================

# --- Stage 1: Install dependencies ---
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# --- Stage 2: Build TypeScript ---
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# --- Stage 3: Production image ---
FROM node:22-alpine AS production
WORKDIR /app

RUN addgroup -g 1001 -S appgroup && \
    adduser  -u 1001 -S appuser -G appgroup

# Dependencies from stage 1 (no devDependencies)
COPY --from=deps /app/node_modules ./node_modules

# Prisma client generated in build stage
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

# Compiled JS
COPY --from=build /app/dist ./dist

# Prisma schema + config (needed at runtime for migrations)
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./

# Package.json (for "start" script)
COPY package.json ./

# Uploads directory
RUN mkdir -p /app/uploads && chown -R appuser:appgroup /app/uploads

ENV NODE_ENV=production
ENV PORT=3001
ENV TZ=America/Sao_Paulo

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "dist/server.js"]
