import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createSuperAdmin, createClientWithStore } from './factory';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';

describe('Painel admin — escopo por tenant e privilégios de raiz', () => {
  let rootToken: string;
  let clientA: Awaited<ReturnType<typeof createClientWithStore>>;
  let clientB: Awaited<ReturnType<typeof createClientWithStore>>;
  let scopedToken: string;
  let viewerToken: string;
  let fullConfigToken: string;

  beforeAll(async () => {
    const root = await createSuperAdmin();
    const resRoot = await request(app).post('/api/auth/login').send({ email: root.email, password: '123456' });
    rootToken = resRoot.headers['set-cookie'][0].split(';')[0].split('=')[1];

    clientA = await createClientWithStore();
    clientB = await createClientWithStore();

    const hash = await bcrypt.hash('123456', 10);

    const criarPapelInterno = async (suffix: string, permissions: { module: string; accessLevel: string }[], clientId?: string) => {
      const role = await prisma.internalRole.create({
        data: {
          name: `${suffix} ${Date.now()}`,
          clientId,
          permissions: { create: permissions },
        },
      });
      const user = await prisma.user.create({
        data: {
          nome: suffix,
          email: `${suffix.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now()}@lpzteste.app`,
          senhaHash: hash,
          role: 'SUPER_ADMIN',
          internalRoleId: role.id,
        },
      });
      const res = await request(app).post('/api/auth/login').send({ email: user.email, password: '123456' });
      return res.headers['set-cookie'][0].split(';')[0].split('=')[1];
    };

    scopedToken = await criarPapelInterno('Suporte Escopado', [
      { module: 'CLIENTES', accessLevel: 'FULL' },
      { module: 'FINANCEIRO', accessLevel: 'FULL' },
    ], clientA.client.id);
    viewerToken = await criarPapelInterno('Visualizador', [{ module: 'CONFIGURACOES', accessLevel: 'VIEW' }]);
    fullConfigToken = await criarPapelInterno('Full Config', [{ module: 'CONFIGURACOES', accessLevel: 'FULL' }]);

    await prisma.store.update({
      where: { id: clientA.store.id },
      data: { whatsappApiKey: 'abcdefghijklmnopqrstuvwxyz' },
    });

    const plan = await prisma.plan.create({
      data: { nome: `Plano ${Date.now()}`, precoMensal: 99.9 },
    });
    await prisma.subscription.create({
      data: {
        clientId: clientB.client.id,
        planId: plan.id,
        valorMensalidade: 99.9,
        dataVencimento: new Date(),
        statusPagamento: 'PAGO',
      },
    });
  });

  it('bloqueia promoção de papel por papel interno não-raiz (mesmo dentro do escopo)', async () => {
    const res = await request(app)
      .put(`/api/super-admin/users/${clientA.user.id}`)
      .set('Cookie', [`authToken=${scopedToken}`])
      .send({ role: 'SUPER_ADMIN' });
    expect(res.status).toBe(403);
  });

  it('bloqueia edição de usuário fora do escopo do tenant', async () => {
    const res = await request(app)
      .put(`/api/super-admin/users/${clientB.user.id}`)
      .set('Cookie', [`authToken=${scopedToken}`])
      .send({ nome: 'Hack' });
    expect(res.status).toBe(403);
  });

  it('permite editar usuário DENTRO do escopo (nome)', async () => {
    const res = await request(app)
      .put(`/api/super-admin/users/${clientA.user.id}`)
      .set('Cookie', [`authToken=${scopedToken}`])
      .send({ nome: 'Editado Pelo Suporte' });
    expect(res.status).toBe(200);
  });

  it('bloqueia reset de senha de usuário fora do escopo', async () => {
    const res = await request(app)
      .put(`/api/super-admin/users/${clientB.user.id}/reset-password`)
      .set('Cookie', [`authToken=${scopedToken}`]);
    expect(res.status).toBe(403);
  });

  it('bloqueia exclusão de usuário fora do escopo', async () => {
    const res = await request(app)
      .delete(`/api/super-admin/users/${clientB.user.id}`)
      .set('Cookie', [`authToken=${scopedToken}`]);
    expect(res.status).toBe(403);
  });

  it('bloqueia purge de cliente fora do escopo', async () => {
    const res = await request(app)
      .post(`/api/super-admin/clients/${clientB.client.id}/purge`)
      .set('Cookie', [`authToken=${scopedToken}`]);
    expect(res.status).toBe(403);
  });

  it('bloqueia restore de cliente fora do escopo', async () => {
    const res = await request(app)
      .post(`/api/super-admin/clients/${clientB.client.id}/restore`)
      .set('Cookie', [`authToken=${scopedToken}`]);
    expect(res.status).toBe(403);
  });

  it('bloqueia cancelamento de assinatura fora do escopo', async () => {
    const subB = await prisma.subscription.findFirst({ where: { clientId: clientB.client.id } });
    const res = await request(app)
      .put(`/api/super-admin/subscriptions/${subB!.id}/cancel`)
      .set('Cookie', [`authToken=${scopedToken}`]);
    expect(res.status).toBe(403);
  });

  it('bloqueia reset-database para papel interno (exige SUPER_ADMIN estrito)', async () => {
    const res = await request(app)
      .post('/api/super-admin/reset-database')
      .set('Cookie', [`authToken=${scopedToken}`])
      .send({ confirmPassword: '123456' });
    expect(res.status).toBe(403);
  });

  it('bloqueia download de backup sem permissão FULL de CONFIGURACOES', async () => {
    const res = await request(app)
      .get('/api/super-admin/backups/arquivo.sql.gz/download')
      .set('Cookie', [`authToken=${scopedToken}`]);
    expect(res.status).toBe(403);
  });

  it('root continua podendo resetar senha (regressão)', async () => {
    const res = await request(app)
      .put(`/api/super-admin/users/${clientB.user.id}/reset-password`)
      .set('Cookie', [`authToken=${rootToken}`]);
    expect(res.status).toBe(200);
  });

  it('root não pode resetar senha de outro SUPER_ADMIN', async () => {
    const admin = await createSuperAdmin();
    const res = await request(app)
      .put(`/api/super-admin/users/${admin.id}/reset-password`)
      .set('Cookie', [`authToken=${rootToken}`]);
    expect(res.status).toBe(400);
  });

  it('createClient não vaza senhaHash nem segredos na resposta', async () => {
    const email = `novo_${Date.now()}@lpzteste.app`;
    const res = await request(app)
      .post('/api/super-admin/clients')
      .set('Cookie', [`authToken=${rootToken}`])
      .send({
        nomeFantasia: 'Cliente Novo Seguro',
        cnpjCpf: '12345678901',
        telefoneWhatsapp: '11999998888',
        emailContato: email,
        emailResponsavel: email,
        senhaResponsavel: 'SenhaForte!1',
        nichoPrincipal: 'Pet',
        chavePix: 'pix@teste.app',
      });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain('senhaHash');
    expect(JSON.stringify(res.body)).not.toContain('whatsappApiKey');
    expect(res.body.user).toHaveProperty('email');
  });

  it('listagem de clientes mascara whatsappApiKey', async () => {
    const res = await request(app)
      .get('/api/super-admin/clients')
      .set('Cookie', [`authToken=${rootToken}`]);
    expect(res.status).toBe(200);
    const found = res.body.find((c: any) => c.id === clientA.client.id);
    const store = found?.controls?.[0]?.stores?.[0];
    expect(store).toBeTruthy();
    expect(store.whatsappApiKey).toBe('abcd****');
  });

  it('listApiKeys exige FULL (VIEW não basta)', async () => {
    const res = await request(app)
      .get('/api/super-admin/api-keys')
      .set('Cookie', [`authToken=${viewerToken}`]);
    expect(res.status).toBe(403);
  });

  it('getSystemSettings mascara chaves sensíveis (API_KEYS)', async () => {
    await prisma.systemSetting.upsert({
      where: { chave: 'API_KEYS' },
      update: {},
      create: { chave: 'API_KEYS', valor: { secret: 'super-secreta' } },
    });
    const res = await request(app)
      .get('/api/super-admin/settings')
      .set('Cookie', [`authToken=${viewerToken}`]);
    expect(res.status).toBe(200);
    const apiKeys = res.body.find((s: any) => s.chave === 'API_KEYS');
    expect(apiKeys).toBeTruthy();
    expect(apiKeys.valor).toBe('***');
  });

  it('updateSystemSettings bloqueia sobrescrever PAINEL_LOCKDOWN', async () => {
    const res = await request(app)
      .put('/api/super-admin/settings')
      .set('Cookie', [`authToken=${fullConfigToken}`])
      .send({ settings: [{ chave: 'PAINEL_LOCKDOWN', valor: false }] });
    expect(res.status).toBe(403);
  });

  it('rejectRegistration valida existência (404 em vez de 500)', async () => {
    const res = await request(app)
      .post('/api/super-admin/pending-registrations/id-inexistente/reject')
      .set('Cookie', [`authToken=${rootToken}`]);
    expect(res.status).toBe(404);
  });

  it('changeSubscriptionPlan exige planId e deriva o valor do plano', async () => {
    const plan = await prisma.plan.create({ data: { nome: `P ${Date.now()}`, precoMensal: 199.9 } });
    const sub = await prisma.subscription.create({
      data: {
        clientId: clientA.client.id,
        planId: plan.id,
        valorMensalidade: 99,
        dataVencimento: new Date(),
        statusPagamento: 'PAGO',
      },
    });

    const resNoPlan = await request(app)
      .put(`/api/super-admin/subscriptions/${sub.id}/plan`)
      .set('Cookie', [`authToken=${scopedToken}`])
      .send({ valorMensalidade: 0.01 });
    expect(resNoPlan.status).toBe(400);

    const plan2 = await prisma.plan.create({ data: { nome: `P2 ${Date.now()}`, precoMensal: 299.9 } });
    const res = await request(app)
      .put(`/api/super-admin/subscriptions/${sub.id}/plan`)
      .set('Cookie', [`authToken=${scopedToken}`])
      .send({ planId: plan2.id, valorMensalidade: 0.01 });
    expect(res.status).toBe(200);
    expect(Number(res.body.valorMensalidade)).toBe(299.9);
  });

  it('marcar notificação como lida exige permissão de CONFIGURACOES', async () => {
    const res = await request(app)
      .put('/api/super-admin/notifications/qualquer/read')
      .set('Cookie', [`authToken=${scopedToken}`]);
    expect(res.status).toBe(403);
  });

  it('impersonação: aninhamento bloqueado, sessão validada por request e revert logado', async () => {
    const admin2 = await createSuperAdmin();
    const resLogin = await request(app).post('/api/auth/login').send({ email: admin2.email, password: '123456' });
    const admin2Token = resLogin.headers['set-cookie'][0].split(';')[0].split('=')[1];

    const resImp = await request(app)
      .post(`/api/super-admin/impersonate/${clientA.store.id}`)
      .set('Cookie', [`authToken=${admin2Token}`]);
    expect(resImp.status).toBe(200);
    const setCookies = resImp.headers['set-cookie'];
    const cookies = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
    const impToken = cookies
      .find((c: string) => c.startsWith('authToken='))
      ?.split(';')[0].split('=')[1];
    expect(impToken).toBeTruthy();

    const startLog = await prisma.impersonationLog.findFirst({
      where: { impersonatorId: admin2.id, tipo: 'START' },
    });
    expect(startLog).toBeTruthy();

    const resNested = await request(app)
      .post(`/api/super-admin/impersonate/${clientB.store.id}`)
      .set('Cookie', [`authToken=${impToken}`]);
    expect(resNested.status).toBe(403);

    const resRevertNo = await request(app)
      .post('/api/super-admin/revert-impersonate')
      .set('Cookie', [`authToken=${admin2Token}`]);
    expect(resRevertNo.status).toBe(403);

    const resRevert = await request(app)
      .post('/api/super-admin/revert-impersonate')
      .set('Cookie', [`authToken=${impToken}`]);
    expect(resRevert.status).toBe(200);

    const revertLog = await prisma.impersonationLog.findFirst({
      where: { impersonatorId: admin2.id, tipo: 'REVERT' },
    });
    expect(revertLog).toBeTruthy();

    await prisma.user.update({ where: { id: admin2.id }, data: { ativo: false } });
    const resDisabled = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`authToken=${impToken}`]);
    expect(resDisabled.status).toBe(403);
  });
});
