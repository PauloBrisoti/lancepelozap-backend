import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import bcrypt from 'bcryptjs';
import app from '../app';
import { prisma } from '../lib/prisma';
import { detectFileKind, validateFileMagic } from '../lib/fileValidation';

const SENHA = 'SenhaForte123!';

function tempFile(name: string, content: Buffer | string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpz-upload-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('fileValidation — magic bytes (unit)', () => {
  it('detecta JPEG, PNG, GIF, PDF, XLSX e texto', () => {
    expect(detectFileKind(tempFile('a.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])))).toContain('jpeg');
    expect(detectFileKind(tempFile('a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))).toContain('png');
    expect(detectFileKind(tempFile('a.gif', Buffer.from('GIF89a', 'binary')))).toContain('gif');
    expect(detectFileKind(tempFile('a.pdf', Buffer.from('%PDF-1.7\n...')))).toContain('pdf');
    expect(detectFileKind(tempFile('a.xlsx', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(16)])))).toContain('xlsx');
    expect(detectFileKind(tempFile('a.csv', Buffer.from('nome;preco\n')))).toContain('text');
  });

  it('não detecta binário arbitrário', () => {
    expect(detectFileKind(tempFile('a.bin', Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0xff])))).toEqual([]);
  });

  it('rejeita texto com extensão de imagem', () => {
    const p = tempFile('foto.jpg', 'isto não é uma imagem');
    expect(validateFileMagic(p, 'foto.jpg', ['jpeg'])).not.toBeNull();
  });

  it('rejeita extensão fora da lista mesmo com conteúdo válido', () => {
    const p = tempFile('doc.pdf', '%PDF-1.4 fake');
    expect(validateFileMagic(p, 'doc.pdf', ['jpeg'])).not.toBeNull();
    expect(validateFileMagic(p, 'doc.pdf', ['pdf'])).toBeNull();
  });

  it('rejeita arquivo vazio', () => {
    const p = tempFile('vazio.csv', '');
    expect(validateFileMagic(p, 'vazio.csv', ['csv'])).not.toBeNull();
  });
});

let storeId: string;
let controlId: string;
let clientId: string;
let userId: string;
let token: string;

beforeAll(async () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const client = await prisma.client.create({
    data: { nomeCompleto: 'Client Up', email: `up_${suffix}@lpzteste.app` },
  });
  clientId = client.id;
  const control = await prisma.control.create({
    data: { clientId: client.id, nome: 'Controle Up', tipo: 'PJ' },
  });
  controlId = control.id;
  const store = await prisma.store.create({
    data: { controlId: control.id, nomeFantasia: 'Loja Up', status: 'ATIVO' },
  });
  storeId = store.id;

  const hash = await bcrypt.hash(SENHA, 10);
  const user = await prisma.user.create({
    data: { nome: 'User Up', email: `upuser_${suffix}@lpzteste.app`, senhaHash: hash, role: 'ADMIN' },
  });
  userId = user.id;
  await prisma.storeUserAccess.create({ data: { storeId, userId: user.id, role: 'ADMIN' } });

  const login = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '10.0.0.1')
    .send({ email: user.email, password: SENHA });
  token = login.headers['set-cookie']?.[0]?.split(';')[0] || '';
});

afterAll(async () => {
  await prisma.storeUserAccess.deleteMany({ where: { storeId } });
  await prisma.store.delete({ where: { id: storeId } });
  await prisma.control.delete({ where: { id: controlId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('Uploads — integração', () => {
  it('rejeita .xlsx com conteúdo de texto (magic bytes)', async () => {
    const res = await request(app)
      .post('/api/planilha/preview')
      .set('Cookie', token)
      .set('Origin', 'http://localhost:5173')
      .attach('file', tempFile('planilha.xlsx', 'isto não é um xlsx'), 'planilha.xlsx');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Tipo de arquivo não permitido');
  });

  it('rejeita .jpg com conteúdo arbitrário no upload de PIX', async () => {
    const res = await request(app)
      .post('/api/settings/upload-pix')
      .set('Cookie', token)
      .set('Origin', 'http://localhost:5173')
      .attach('file', tempFile('qr.jpg', Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe])), 'qr.jpg');
    expect(res.status).toBe(400);
  });

  it('rejeita arquivo acima do limite com 413', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41); // 10MB+1 (limite da planilha)
    const res = await request(app)
      .post('/api/planilha/preview')
      .set('Cookie', token)
      .set('Origin', 'http://localhost:5173')
      .attach('file', big, 'grande.csv');
    expect(res.status).toBe(413);
  });
});
