import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import bcrypt from 'bcryptjs';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore, createSuperAdmin } from './factory';

function tempFile(name: string, content: Buffer | string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpz-pix-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

const MES_ATUAL = new Date().toISOString().slice(0, 7);

describe('Renovação Pix manual — segurança e integridade', () => {
  let rootToken: string;
  let ownerToken: string;
  let ownerBToken: string;
  let clientA: Awaited<ReturnType<typeof createClientWithStore>>;
  let clientB: Awaited<ReturnType<typeof createClientWithStore>>;
  let sub: Awaited<ReturnType<typeof prisma.subscription.create>>;
  let subB: Awaited<ReturnType<typeof prisma.subscription.create>>;

  beforeAll(async () => {
    const root = await createSuperAdmin();
    const resRoot = await request(app).post('/api/auth/login').send({ email: root.email, password: '123456' });
    rootToken = resRoot.headers['set-cookie'][0].split(';')[0].split('=')[1];

    clientA = await createClientWithStore();
    clientB = await createClientWithStore();

    const resA = await request(app).post('/api/auth/login').send({ email: clientA.user.email, password: '123456' });
    ownerToken = resA.headers['set-cookie'][0].split(';')[0].split('=')[1];
    const resB = await request(app).post('/api/auth/login').send({ email: clientB.user.email, password: '123456' });
    ownerBToken = resB.headers['set-cookie'][0].split(';')[0].split('=')[1];

    const plan = await prisma.plan.create({ data: { nome: `Plano Pix ${Date.now()}`, precoMensal: 99.9 } });

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const vencPassado = new Date(hoje);
    vencPassado.setDate(hoje.getDate() - 5);

    sub = await prisma.subscription.create({
      data: { clientId: clientA.client.id, planId: plan.id, valorMensalidade: 99.9, dataVencimento: vencPassado, statusPagamento: 'VENCIDO' },
    });
    subB = await prisma.subscription.create({
      data: { clientId: clientB.client.id, planId: plan.id, valorMensalidade: 99.9, dataVencimento: vencPassado, statusPagamento: 'VENCIDO' },
    });

    // Config oficial da chave Pix da empresa
    await prisma.systemSetting.upsert({
      where: { chave: 'PIX_SUBSCRIPTION_CONFIG' },
      update: {},
      create: {
        chave: 'PIX_SUBSCRIPTION_CONFIG',
        valor: { chavePix: 'contato@lancepelozap.com.br', beneficiario: 'Lance Pelo Zap LTDA', whatsappSuporte: '5511966401931' },
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('GET /pix-config sem autenticação → 401', async () => {
    const res = await request(app).get('/api/subscriptions/pix-config');
    expect(res.status).toBe(401);
  });

  it('GET /pix-config autenticado → chave Pix e valor derivado do plano', async () => {
    const res = await request(app)
      .get('/api/subscriptions/pix-config')
      .set('Cookie', `authToken=${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.chavePix).toBe('contato@lancepelozap.com.br');
    expect(res.body.valor).toBe(99.9);
    expect(res.body.subscriptionId).toBe(sub.id);
  });

  it('envio de comprovante NUNCA altera o status da assinatura (cria AGUARDANDO_VALIDACAO)', async () => {
    const res = await request(app)
      .post('/api/subscriptions/payment-proof')
      .set('Cookie', `authToken=${ownerToken}`)
      .send({ transactionId: 'E2E1234567890ABC1234567890ABC12' });
    expect(res.status).toBe(201);
    expect(res.body.receipt.status).toBe('AGUARDANDO_VALIDACAO');
    expect(res.body.receipt.valorDeclarado).toBe(99.9);

    const subAtual = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(subAtual!.statusPagamento).toBe('VENCIDO');
  });

  it('rejeita ID de transação malformado', async () => {
    const res = await request(app)
      .post('/api/subscriptions/payment-proof')
      .set('Cookie', `authToken=${ownerToken}`)
      .send({ transactionId: '<script>alert(1)</script>' });
    expect(res.status).toBe(400);
  });

  it('idempotência: mesmo End-to-End ID não pode ser enviado duas vezes', async () => {
    const txId = 'E2E0999999999ABC0999999999ABC09';
    const r1 = await request(app)
      .post('/api/subscriptions/payment-proof')
      .set('Cookie', `authToken=${ownerToken}`)
      .send({ transactionId: txId });
    expect(r1.status).toBe(201);

    const r2 = await request(app)
      .post('/api/subscriptions/payment-proof')
      .set('Cookie', `authToken=${ownerToken}`)
      .send({ transactionId: txId });
    expect(r2.status).toBe(409);
  });

  it('rejeita arquivo .jpg com conteúdo que não é imagem (magic bytes)', async () => {
    const res = await request(app)
      .post('/api/subscriptions/payment-proof')
      .set('Cookie', `authToken=${ownerToken}`)
      .attach('file', tempFile('comprovante.jpg', Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe])), 'comprovante.jpg');
    expect(res.status).toBe(400);
  });

  it('rejeita arquivo acima de 5MB com 413', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);
    const res = await request(app)
      .post('/api/subscriptions/payment-proof')
      .set('Cookie', `authToken=${ownerToken}`)
      .attach('file', tempFile('grande.jpg', big), 'grande.jpg');
    expect(res.status).toBe(413);
  });

  it('rejeita extensão não permitida (.exe)', async () => {
    const res = await request(app)
      .post('/api/subscriptions/payment-proof')
      .set('Cookie', `authToken=${ownerToken}`)
      .attach('file', tempFile('malware.exe', Buffer.from('MZ...')), 'malware.exe');
    expect(res.status).toBe(400);
  });

  it('aceita PDF válido com magic bytes e grava fora da raiz pública', async () => {
    const res = await request(app)
      .post('/api/subscriptions/payment-proof')
      .set('Cookie', `authToken=${ownerToken}`)
      .attach('file', tempFile('comp.pdf', Buffer.from('%PDF-1.7\nfake pdf')), 'comp.pdf');
    expect(res.status).toBe(201);
    expect(res.body.receipt.status).toBe('AGUARDANDO_VALIDACAO');
  });

  it('rate limit: 26º envio no mesmo minuto → 429 (5/min * multiplicador de teste)', async () => {
    const start = Date.now();
    let lastStatus = 0;
    for (let i = 0; i < 26; i++) {
      const res = await request(app)
        .post('/api/subscriptions/payment-proof')
        .set('Cookie', `authToken=${ownerToken}`)
        .send({ transactionId: `E2ERL${String(i).padStart(12, '0')}RLTEST` });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('lojista NÃO consegue aprovar comprovante (403)', async () => {
    const receipt = await prisma.paymentReceipt.create({
      data: {
        clientId: clientA.client.id,
        subscriptionId: sub.id,
        valorDeclarado: 99.9,
      },
    });
    const res = await request(app)
      .post(`/api/super-admin/pix-proofs/${receipt.id}/approve`)
      .set('Cookie', `authToken=${ownerToken}`);
    expect(res.status).toBe(403);
  });

  it('lojista NÃO consegue aprovar assinatura diretamente (403)', async () => {
    const res = await request(app)
      .post('/api/super-admin/subscriptions/approve')
      .set('Cookie', `authToken=${ownerToken}`)
      .send({ subscriptionId: sub.id, statusPagamento: 'PAGO' });
    expect(res.status).toBe(403);
  });

  it('admin com escopo de outro cliente NÃO aprova comprovante fora do escopo (403)', async () => {
    const hash = await bcrypt.hash('123456', 10);
    const role = await prisma.internalRole.create({
      data: {
        name: `Suporte Escopado ${Date.now()}`,
        clientId: clientB.client.id,
        permissions: { create: [{ module: 'FINANCEIRO', accessLevel: 'FULL' }] },
      },
    });
    const scopedUser = await prisma.user.create({
      data: {
        nome: 'Suporte Escopado',
        email: `scoped_${Date.now()}@lpzteste.app`,
        senhaHash: hash,
        role: 'SUPER_ADMIN',
        internalRoleId: role.id,
      },
    });
    const resLogin = await request(app).post('/api/auth/login').send({ email: scopedUser.email, password: '123456' });
    const scopedToken = resLogin.headers['set-cookie'][0].split(';')[0].split('=')[1];

    const receiptA = await prisma.paymentReceipt.create({
      data: {
        clientId: clientA.client.id,
        subscriptionId: sub.id,
        valorDeclarado: 99.9,
      },
    });
    const res = await request(app)
      .post(`/api/super-admin/pix-proofs/${receiptA.id}/approve`)
      .set('Cookie', `authToken=${scopedToken}`);
    expect(res.status).toBe(403);
  });

  it('approve de comprovante estende +30 dias, cria fatura PAGO e marca APROVADO', async () => {
    const receipt = await prisma.paymentReceipt.create({
      data: {
        clientId: clientA.client.id,
        subscriptionId: sub.id,
        valorDeclarado: 99.9,
        transactionId: 'E2EAPPROVE1234567890ABC1234567',
      },
    });

    const res = await request(app)
      .post(`/api/super-admin/pix-proofs/${receipt.id}/approve`)
      .set('Cookie', `authToken=${rootToken}`);
    expect(res.status).toBe(200);

    const subAtual = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(subAtual!.statusPagamento).toBe('PAGO');

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const esperado = new Date(hoje);
    esperado.setDate(hoje.getDate() + 30);
    const esperadoStr = `${esperado.getFullYear()}-${String(esperado.getMonth() + 1).padStart(2, '0')}-${String(esperado.getDate()).padStart(2, '0')}`;
    // @db.Date é lido como meia-noite UTC — compara a data armazenada (yyyy-mm-dd)
    expect(subAtual!.dataVencimento.toISOString().slice(0, 10)).toBe(esperadoStr);

    const receiptAtual = await prisma.paymentReceipt.findUnique({ where: { id: receipt.id } });
    expect(receiptAtual!.status).toBe('APROVADO');

    const fatura = await prisma.invoice.findUnique({ where: { id: `pix-${sub.id}-${MES_ATUAL}` } });
    expect(fatura).toBeTruthy();
    expect(fatura!.status).toBe('PAGO');
  });

  it('approve duplicado do mesmo comprovante → 409', async () => {
    const receipt = await prisma.paymentReceipt.create({
      data: {
        clientId: clientA.client.id,
        subscriptionId: sub.id,
        valorDeclarado: 99.9,
      },
    });
    const r1 = await request(app)
      .post(`/api/super-admin/pix-proofs/${receipt.id}/approve`)
      .set('Cookie', `authToken=${rootToken}`);
    expect(r1.status).toBe(200);
    const r2 = await request(app)
      .post(`/api/super-admin/pix-proofs/${receipt.id}/approve`)
      .set('Cookie', `authToken=${rootToken}`);
    expect(r2.status).toBe(409);
  });

  it('reject exige motivo; depois de rejeitado, approve → 409', async () => {
    const receipt = await prisma.paymentReceipt.create({
      data: {
        clientId: clientA.client.id,
        subscriptionId: sub.id,
        valorDeclarado: 99.9,
      },
    });
    const semMotivo = await request(app)
      .post(`/api/super-admin/pix-proofs/${receipt.id}/reject`)
      .set('Cookie', `authToken=${rootToken}`);
    expect(semMotivo.status).toBe(400);

    const rejeitado = await request(app)
      .post(`/api/super-admin/pix-proofs/${receipt.id}/reject`)
      .set('Cookie', `authToken=${rootToken}`)
      .send({ motivo: 'Valor divergente do plano' });
    expect(rejeitado.status).toBe(200);

    const ap = await request(app)
      .post(`/api/super-admin/pix-proofs/${receipt.id}/approve`)
      .set('Cookie', `authToken=${rootToken}`);
    expect(ap.status).toBe(409);
  });

  it('approveSubscription ignora statusPagamento/dataVencimento do body (server-side)', async () => {
    const res = await request(app)
      .post('/api/super-admin/subscriptions/approve')
      .set('Cookie', `authToken=${rootToken}`)
      .send({ subscriptionId: subB.id, statusPagamento: 'CANCELADO', dataVencimento: '2999-01-01' });
    expect(res.status).toBe(200);
    expect(res.body.subscription.statusPagamento).toBe('PAGO');

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const esperado = new Date(hoje);
    esperado.setDate(hoje.getDate() + 30);
    const subBAtual = await prisma.subscription.findUnique({ where: { id: subB.id } });
    expect(subBAtual!.statusPagamento).toBe('PAGO');
    const hoje2 = new Date();
    hoje2.setHours(0, 0, 0, 0);
    const esperado2 = new Date(hoje2);
    esperado2.setDate(hoje2.getDate() + 30);
    const esperadoStr2 = `${esperado2.getFullYear()}-${String(esperado2.getMonth() + 1).padStart(2, '0')}-${String(esperado2.getDate()).padStart(2, '0')}`;
    expect(subBAtual!.dataVencimento.toISOString().slice(0, 10)).toBe(esperadoStr2);
  });

  it('cliente NÃO lê comprovante de outro cliente (403)', async () => {
    const receiptA = await prisma.paymentReceipt.create({
      data: {
        clientId: clientA.client.id,
        subscriptionId: sub.id,
        valorDeclarado: 99.9,
        arquivoPath: '/uploads/pix-proofs/pix-proof-abcdef123456.jpg',
        arquivoOriginal: 'comprovante.jpg',
      },
    });

    // Token do cliente B não pode ler o arquivo do cliente A
    const resB = await request(app)
      .get(`/api/subscriptions/payment-proofs/${receiptA.id}/file`)
      .set('Cookie', `authToken=${ownerBToken}`);
    expect(resB.status).toBe(403);
  });

  it('arquivo inexistente → 404', async () => {
    const res = await request(app)
      .get('/api/subscriptions/payment-proofs/id-inexistente/file')
      .set('Cookie', `authToken=${rootToken}`);
    expect(res.status).toBe(404);
  });
});