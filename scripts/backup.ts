#!/usr/bin/env tsx
/**
 * backup.ts — Backup automatizado do PostgreSQL + upload S3
 *
 * Uso:
 *   npx tsx scripts/backup.ts                    (backup completo + upload)
 *   npx tsx scripts/backup.ts --no-upload         (só dump local)
 *   npx tsx scripts/backup.ts --restore ARQUIVO   (restaurar backup)
 *
 * Variáveis de ambiente:
 *   DATABASE_URL           — string de conexão PostgreSQL
 *   S3_ENDPOINT            — endpoint S3 (ex: s3.us-east-1.amazonaws.com)
 *   S3_REGION              — região (ex: us-east-1)
 *   S3_ACCESS_KEY_ID       — access key
 *   S3_SECRET_ACCESS_KEY   — secret key
 *   S3_BUCKET              — bucket name
 *   S3_PREFIX              — prefixo opcional (ex: "saas/backups")
 *   BACKUP_DIR             — diretório local (default: ./uploads)
 *   BACKUP_RETENTION_DAYS  — dias para reter localmente (default: 7)
 *   SLACK_WEBHOOK_URL      — webhook para notificação (opcional)
 */

import { execSync, spawn } from 'child_process';
import { createHash, createHmac } from 'crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join, basename } from 'path';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import https from 'https';
import http from 'http';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// ============================================================
// CONFIG
// ============================================================

const DB_URL = process.env.DATABASE_URL || '';
const BACKUP_DIR = process.env.BACKUP_DIR || join(process.cwd(), 'uploads');
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10);

// S3 config
const S3 = {
  endpoint: process.env.S3_ENDPOINT || '',
  region: process.env.S3_REGION || 'us-east-1',
  accessKey: process.env.S3_ACCESS_KEY_ID || '',
  secretKey: process.env.S3_SECRET_ACCESS_KEY || '',
  bucket: process.env.S3_BUCKET || '',
  prefix: (process.env.S3_PREFIX || 'saas/backups').replace(/\/+$/, ''),
};

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL || '';

// ============================================================
// HELPERS
// ============================================================

function log(msg: string) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] ${msg}`);
}

function exec(cmd: string, opts: { timeout?: number } = {}): string {
  return execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, ...opts }).trim();
}

function notifySlack(text: string) {
  if (!SLACK_WEBHOOK) return;
  try {
    const payload = JSON.stringify({ text, username: 'Backup Bot', icon_emoji: ':floppy_disk:' });
    const url = new URL(SLACK_WEBHOOK);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url.href, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    req.write(payload);
    req.end();
  } catch {}
}

// ============================================================
// AWS SIGNATURE V4 (para upload S3 compatível)
// ============================================================

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmacSha256(`AWS4${key}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  return kSigning;
}

async function uploadToS3(filePath: string, fileName: string): Promise<boolean> {
  if (!S3.endpoint || !S3.accessKey || !S3.bucket) {
    log('⚠️  S3 não configurado. Pulando upload.');
    return false;
  }

  const fileContent = await readFile(filePath);
  const contentSha256 = sha256(fileContent.toString('binary'));
  const key = `${S3.prefix}/${fileName}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);
  const service = 's3';
  const host = S3.endpoint;

  // Canonical Request
  const canonicalUri = `/${S3.bucket}/${key}`;
  const canonicalQuerystring = '';
  const canonicalHeaders = `host:${host}\n;x-amz-content-sha256:${contentSha256};x-amz-date:${amzDate}`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuerystring,
    `host:${host}`,
    `x-amz-content-sha256:${contentSha256}`,
    `x-amz-date:${amzDate}`,
    '',
    signedHeaders,
    contentSha256,
  ].join('\n');

  const credentialScope = `${dateStamp}/${S3.region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');

  const signingKey = getSignatureKey(S3.secretKey, dateStamp, S3.region, service);
  const signature = hmacSha256(signingKey, stringToSign).toString('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${S3.accessKey}/${credentialScope},SignedHeaders=${signedHeaders},Signature=${signature}`;

  return new Promise((resolve) => {
    const url = `https://${host}/${S3.bucket}/${key}`;
    const options = {
      method: 'PUT',
      host,
      path: `/${S3.bucket}/${key}`,
      headers: {
        'Content-Length': fileContent.length,
        'x-amz-content-sha256': contentSha256,
        'x-amz-date': amzDate,
        'Authorization': authorization,
        'Host': host,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          log(`✅ Upload S3 concluído: ${key}`);
          resolve(true);
        } else {
          log(`❌ Upload S3 falhou (${res.statusCode}): ${body}`);
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      log(`❌ Erro upload S3: ${err.message}`);
      resolve(false);
    });

    req.write(fileContent);
    req.end();
  });
}

// ============================================================
// BACKUP
// ============================================================

async function doBackup() {
  const timestamp = new Date().toISOString().replace(/[:-]/g, '').substring(0, 15);
  const fileName = `saas_${timestamp}.sql.gz`;
  const filePath = join(BACKUP_DIR, fileName);

  if (!DB_URL) throw new Error('DATABASE_URL não configurada');
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  log('🔍 Verificando conexão com o banco...');
  exec(`psql "${DB_URL}" -c "SELECT 1"`, { timeout: 10000 });
  log('✅ Conexão OK');

  log('💾 Iniciando dump do PostgreSQL...');
  const dumpCmd = `pg_dump "${DB_URL}" --no-owner --no-acl`;
  const dumpOutput = exec(dumpCmd, { timeout: 120000 });
  log(`✅ Dump concluído (${(dumpOutput.length / 1024).toFixed(1)} KB)`);

  log('🗜️  Comprimindo com gzip...');
  const compressed = await gzipAsync(Buffer.from(dumpOutput));
  await writeFile(filePath, compressed);
  const fileSize = (compressed.length / 1024).toFixed(1);
  log(`✅ Arquivo salvo: ${fileName} (${fileSize} KB)`);

  // Upload para S3
  log('☁️  Enviando para storage externo...');
  const uploaded = await uploadToS3(filePath, fileName);

  // Limpeza local
  log(`🧹 Limpando backups locais com mais de ${RETENTION_DAYS} dias...`);
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  const files = readdirSync(BACKUP_DIR).filter(f => f.startsWith('saas_') && (f.endsWith('.sql.gz') || f.endsWith('.sql')));
  let cleaned = 0;
  for (const f of files) {
    const fp = join(BACKUP_DIR, f);
    const st = statSync(fp);
    if (st.mtimeMs < cutoff) {
      unlinkSync(fp);
      cleaned++;
    }
  }
  if (cleaned > 0) log(`🧹 ${cleaned} backup(s) antigo(s) removido(s)`);

  // Symlink do último backup
  const linkPath = join(BACKUP_DIR, 'saas_latest.sql.gz');
  if (existsSync(linkPath)) unlinkSync(linkPath);
  try { execSync(`ln -sf "${filePath}" "${linkPath}"`); } catch {}

  const summary = `📦 Backup concluído: ${fileName} (${fileSize} KB)${uploaded ? ' → S3 OK' : ' → S3: não configurado'}`;
  log(summary);
  notifySlack(`✅ ${summary}`);
  return { file: fileName, size: fileSize, uploaded };
}

// ============================================================
// RESTORE
// ============================================================

async function doRestore(restoreFile: string) {
  if (!existsSync(restoreFile)) throw new Error(`Arquivo não encontrado: ${restoreFile}`);
  if (!DB_URL) throw new Error('DATABASE_URL não configurada');

  log('⚠️  ATENÇÃO: Isso vai SUBSTITUIR o banco atual!');
  log(`📂 Arquivo: ${restoreFile}`);

  let data: Buffer;
  if (restoreFile.endsWith('.gz')) {
    const compressed = await readFile(restoreFile);
    data = await gunzipAsync(compressed);
    log('✅ Arquivo descomprimido');
  } else {
    data = await readFile(restoreFile);
  }

  log('🔄 Restaurando banco...');
  const tempFile = join(BACKUP_DIR, '.restore_temp.sql');
  await writeFile(tempFile, data);

  try {
    exec(`psql "${DB_URL}" < "${tempFile}"`, { timeout: 300000 });
    log('✅ Restauração concluída!');
    notifySlack(`♻️ Restauração concluída: ${basename(restoreFile)}`);
  } finally {
    try { unlinkSync(tempFile); } catch {}
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--restore') {
    const file = args[1];
    if (!file) { console.error('Uso: backup.ts --restore ARQUIVO'); process.exit(1); }
    await doRestore(file);
  } else {
    await doBackup();
  }
}

main().catch((err) => {
  console.error(`❌ FALHA: ${err.message}`);
  notifySlack(`❌ Backup FALHOU: ${err.message}`);
  process.exit(1);
});
