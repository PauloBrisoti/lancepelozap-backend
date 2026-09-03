import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createClientWithStore } from './factory';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';

// Cargo legado OWNER: contas antigas nasceram com store_user_access.role = 'OWNER'
// e o dono é a autoridade máxima da loja — não pode ser bloqueado de ações de
// GERENTE (financeiro, configs da loja, zerar faturamento).
describe('Cargo legado OWNER (dono de loja)', () => {
  let ownerToken: string;
  let storeId: string;

  beforeAll(async () => {
    const hash = await bcrypt.hash('123456', 10);
    const { user, store } = await createClientWithStore();

    // Reproduz o dado legado: role OWNER no store_user_access
    await prisma.storeUserAccess.update({
      where: { storeId_userId: { storeId: store.id, userId: user.id } },
      data: { role: 'OWNER' }
    });

    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: '123456' });
    ownerToken = login.headers['set-cookie'][0].split(';')[0].split('=')[1];
    storeId = store.id;
  });

  it('OWNER acessa o financeiro (gerenciar_financeiro) sem 403', async () => {
    const res = await request(app)
      .get('/api/finance/dashboard')
      .set('Cookie', [`authToken=${ownerToken}`])
      .set('x-workspace-id', storeId);
    expect(res.status).toBe(200);
  });

  it('OWNER atualiza as configurações da loja (updateTenantSettings) sem 403', async () => {
    const res = await request(app)
      .put('/api/settings/tenant')
      .set('Cookie', [`authToken=${ownerToken}`])
      .set('x-workspace-id', storeId)
      .send({ nomeFantasia: 'Loja Dono Teste' });
    expect(res.status).toBe(200);
    expect(res.body.nomeFantasia).toBe('Loja Dono Teste');
  });

  it('VENDEDOR continua bloqueado do financeiro (403) — hierarquia intacta', async () => {
    const hash = await bcrypt.hash('123456', 10);
    const { store } = await createClientWithStore();
    const seller = await prisma.user.create({
      data: { nome: 'Vendedor Restrito', email: `vend_${Date.now()}@lpzteste.app`, senhaHash: hash, role: 'USER' }
    });
    await prisma.storeUserAccess.create({
      data: { storeId: store.id, userId: seller.id, role: 'VENDEDOR' }
    });
    const login = await request(app).post('/api/auth/login').send({ email: seller.email, password: '123456' });
    const sellerToken = login.headers['set-cookie'][0].split(';')[0].split('=')[1];

    const res = await request(app)
      .get('/api/finance/dashboard')
      .set('Cookie', [`authToken=${sellerToken}`])
      .set('x-workspace-id', store.id);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/GERENTE/i);
  });

  it('usuário sem acesso à loja continua bloqueado (403)', async () => {
    const hash = await bcrypt.hash('123456', 10);
    const { store } = await createClientWithStore();
    const stranger = await prisma.user.create({
      data: { nome: 'Sem Acesso', email: `semacesso_${Date.now()}@lpzteste.app`, senhaHash: hash, role: 'USER' }
    });
    const login = await request(app).post('/api/auth/login').send({ email: stranger.email, password: '123456' });
    const strangerToken = login.headers['set-cookie'][0].split(';')[0].split('=')[1];

    const res = await request(app)
      .get('/api/finance/dashboard')
      .set('Cookie', [`authToken=${strangerToken}`])
      .set('x-workspace-id', store.id);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/não tem permissão nesta loja|Acesso negado a esta loja/i);
  });
});