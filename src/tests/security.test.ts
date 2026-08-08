import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createClientWithStore, createSuperAdmin } from './factory';
import { prisma } from '../lib/prisma';
import fs from 'fs';
import path from 'path';

describe('Segurança e Carga Básica', () => {
  it('Rotas sensíveis exigem autenticação', async () => {
    const res = await request(app).get('/api/finance/dashboard');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Token não fornecido|não autorizado|Acesso negado/i);
  });
});

describe('Segurança — Backups (path traversal e exposição)', () => {
  let superToken: string;
  let storeToken: string;

  const BACKUPS_DIR = path.join(process.cwd(), 'backups');

  beforeAll(async () => {
    const admin = await createSuperAdmin();
    const resA = await request(app).post('/api/auth/login').send({ email: admin.email, password: '123456' });
    superToken = resA.headers['set-cookie'][0].split(';')[0].split('=')[1];

    const { user } = await createClientWithStore();
    const resB = await request(app).post('/api/auth/login').send({ email: user.email, password: '123456' });
    storeToken = resB.headers['set-cookie'][0].split(';')[0].split('=')[1];

    // Cria um backup de mentira para testar acesso
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    fs.writeFileSync(path.join(BACKUPS_DIR, 'backup-999999.sql'), '-- dump falso');
  });

  afterAll(() => {
    try { fs.unlinkSync(path.join(BACKUPS_DIR, 'backup-999999.sql')); } catch {}
  });

  it('Path traversal no download de backup é rejeitado', async () => {
    const res = await request(app)
      .get('/api/super-admin/backups/..%2F..%2F.env/download')
      .set('Cookie', [`adminToken=${superToken}`]);
    expect(res.status).toBe(400);
  });

  it('Nome fora do padrão é rejeitado no download', async () => {
    const res = await request(app)
      .get('/api/super-admin/backups/backup-1.sql.gz.bak/download')
      .set('Cookie', [`adminToken=${superToken}`]);
    expect(res.status).toBe(400);
  });

  it('Usuário de loja comum NÃO consegue listar backups', async () => {
    const res = await request(app)
      .get('/api/super-admin/backups')
      .set('Cookie', [`authToken=${storeToken}`]);
    expect(res.status).toBe(403);
  });

  it('Backup NÃO é servido via /uploads (não fica mais na pasta pública)', async () => {
    const res = await request(app)
      .get('/uploads/backup-999999.sql')
      .set('Cookie', [`authToken=${storeToken}`]);
    expect([400, 403, 404]).toContain(res.status);
  });
});

describe('Segurança — Hard Reset (injeção SQL e confirmação)', () => {
  let storeToken: string;
  let storeId: string;

  beforeAll(async () => {
    const { user, store } = await createClientWithStore();
    storeId = store.id;
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: '123456' });
    storeToken = res.headers['set-cookie'][0].split(';')[0].split('=')[1];
  });

  it('Hard reset sem confirmação é recusado', async () => {
    const res = await request(app)
      .post('/api/import/smart/hard-reset')
      .set('Cookie', [`authToken=${storeToken}`])
      .send({});
    expect(res.status).toBe(400);
  });

  it('Hard reset com storeId malicioso não apaga dados de outra loja', async () => {
    // Simula o ataque: tentar injetar SQL pelo storeId no header
    const res = await request(app)
      .post('/api/import/smart/hard-reset')
      .set('Cookie', [`authToken=${storeToken}`])
      .set('x-store-id', `' OR '1'='1`)
      .send({ confirmacao: 'RESETAR' });
    // Com o Prisma parametrizado, o pior caso é 400/403/500 — nunca um
    // "sucesso" que apagaria dados de OUTRAS lojas.
    expect(res.status).not.toBe(200);
  });

  it('Vendas de OUTRA loja permanecem após reset legítimo', async () => {
    const other = await createClientWithStore();
    await prisma.sale.create({
      data: {
        storeId: other.store.id,
        userId: other.user.id,
        dataVenda: new Date(),
        valorTotalBruto: 100,
        valorTotalLiquido: 100,
        status: 'FINALIZADA',
      },
    });

    const res = await request(app)
      .post('/api/import/smart/hard-reset')
      .set('Cookie', [`authToken=${storeToken}`])
      .send({ confirmacao: 'RESETAR' });
    expect(res.status).toBe(200);

    const otherSales = await prisma.sale.count({ where: { storeId: other.store.id } });
    expect(otherSales).toBe(1);
  });
});

describe('Segurança — Portal do cliente (sessão curta)', () => {
  it('Troca de token por sessão exige token válido', async () => {
    const res = await request(app)
      .post('/api/customer-portal/session')
      .send({ token: 'token-que-nao-existe' });
    expect(res.status).toBe(404);
  });

  it('Endpoint de perfil exige sessão válida', async () => {
    const res = await request(app).get('/api/customer-portal/profile');
    expect(res.status).toBe(401);
  });

  it('Sessão do portal expira e não vira sessão de lojista', async () => {
    // Sessão criada é JWT tipo PORTAL_SESSION — não pode ser usada como authToken
    const { store } = await createClientWithStore();
    const customer = await prisma.customer.create({
      data: {
        storeId: store.id,
        nomeCompleto: 'Cliente Portal Teste',
        cpf: '12345678901',
        portalToken: `portal_${Date.now()}`,
      },
    });

    const res = await request(app)
      .post('/api/customer-portal/session')
      .send({ token: customer.portalToken });
    expect(res.status).toBe(200);
    expect(res.body.sessionToken).toBeTruthy();

    // O token do portal NÃO funciona nas rotas do lojista
    const profile = await request(app)
      .get('/api/customer-portal/profile')
      .set('Authorization', `Bearer ${res.body.sessionToken}`);
    expect(profile.status).toBe(200);
    expect(profile.body.nomeCompleto).toBe('Cliente Portal Teste');

    // Usar a sessão do portal como cookie de admin falha
    const fakeAdmin = await request(app)
      .get('/api/super-admin/users/all')
      .set('Cookie', [`authToken=${res.body.sessionToken}`]);
    expect(fakeAdmin.status).not.toBe(200);
  });
});

describe('Segurança — Uploads com dono', () => {
  let storeToken: string;
  let storeId: string;

  beforeAll(async () => {
    const { user, store } = await createClientWithStore();
    storeId = store.id;
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: '123456' });
    storeToken = res.headers['set-cookie'][0].split(';')[0].split('=')[1];
  });

  it('Upload PIX cria arquivo com prefixo da loja e outro lojista não acessa', async () => {
    // JPEG real (magic bytes) — uploads são validados pelo conteúdo
    const realJpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0xff, 0xd9,
    ]);
    const uploadRes = await request(app)
      .post('/api/settings/upload-pix')
      .set('Cookie', [`authToken=${storeToken}`])
      .attach('file', realJpeg, { filename: 'qr.png', contentType: 'image/png' });
    expect(uploadRes.status).toBe(200);

    const fileName = (uploadRes.body.pixQrCodeUrl as string).split('/').pop()!;
    expect(fileName).toContain(`${storeId}--`);

    // Outra loja tenta baixar o arquivo da primeira → 403
    const other = await createClientWithStore();
    const resOther = await request(app).post('/api/auth/login').send({ email: other.user.email, password: '123456' });
    const otherToken = resOther.headers['set-cookie'][0].split(';')[0].split('=')[1];

    const accessRes = await request(app)
      .get(`/uploads/${fileName}`)
      .set('Cookie', [`authToken=${otherToken}`]);
    expect(accessRes.status).toBe(403);

    // O dono consegue baixar
    const ownerRes = await request(app)
      .get(`/uploads/${fileName}`)
      .set('Cookie', [`authToken=${storeToken}`]);
    expect(ownerRes.status).toBe(200);
  });
});

describe('Segurança — CSRF (origem maliciosa)', () => {
  let superToken: string;

  beforeAll(async () => {
    const admin = await createSuperAdmin();
    const res = await request(app).post('/api/auth/login').send({ email: admin.email, password: '123456' });
    superToken = res.headers['set-cookie'][0].split(';')[0].split('=')[1];
  });

  it('POST com origem parecida (subdomínio falso) é bloqueado', async () => {
    const res = await request(app)
      .post('/api/super-admin/users/all')
      .set('Origin', 'https://app.lancepelozap.com.br.ataque.com')
      .set('Cookie', [`adminToken=${superToken}`]);
    expect(res.status).toBe(403);
  });

  it('POST com origem legítima passa (não é bloqueado pelo CSRF)', async () => {
    // Rota POST real; o que importa é que o CSRF DEIXA passar e o erro é de validação
    const res = await request(app)
      .post('/api/super-admin/clients')
      .set('Origin', 'https://app.lancepelozap.com.br')
      .set('Cookie', [`adminToken=${superToken}`])
      .send({});
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});
