import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

const SENHA = 'SenhaForte123!';

let storeId: string;
let controlId: string;
let clientId: string;
let userId: string;
let targetUserId: string;
let professionalId: string;
let serviceTypeId: string;
let token: string;

beforeAll(async () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  const client = await prisma.client.create({
    data: { nomeCompleto: 'Client Val', email: `val_${suffix}@lpzteste.app` },
  });
  clientId = client.id;
  const control = await prisma.control.create({
    data: { clientId: client.id, nome: 'Controle Val', tipo: 'PJ' },
  });
  controlId = control.id;
  const store = await prisma.store.create({
    data: { controlId: control.id, nomeFantasia: 'Loja Val', status: 'ATIVO' },
  });
  storeId = store.id;

  const hash = await bcrypt.hash(SENHA, 10);
  const user = await prisma.user.create({
    data: { nome: 'Admin Loja Val', email: `admval_${suffix}@lpzteste.app`, senhaHash: hash, role: 'ADMIN' },
  });
  userId = user.id;
  await prisma.storeUserAccess.create({
    data: { storeId, userId: user.id, role: 'ADMIN' },
  });

  const target = await prisma.user.create({
    data: { nome: 'Func Alvo', email: `alvo_${suffix}@lpzteste.app`, senhaHash: hash, role: 'USER' },
  });
  targetUserId = target.id;
  await prisma.storeUserAccess.create({
    data: { storeId, userId: target.id, role: 'VENDEDOR' },
  });

  const professional = await prisma.professional.create({
    data: { storeId, nome: 'Prof Original', comissaoPercentual: 5 },
  });
  professionalId = professional.id;

  const serviceType = await prisma.serviceType.create({
    data: { storeId, nome: 'Serviço Original', precoPadrao: 100 },
  });
  serviceTypeId = serviceType.id;

  const login = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '10.0.0.1')
    .send({ email: user.email, password: SENHA });
  token = login.headers['set-cookie']?.[0]?.split(';')[0] || '';
});

afterAll(async () => {
  await prisma.professional.deleteMany({ where: { storeId } });
  await prisma.serviceType.deleteMany({ where: { storeId } });
  await prisma.storeUserAccess.deleteMany({ where: { storeId } });
  await prisma.store.delete({ where: { id: storeId } });
  await prisma.control.delete({ where: { id: controlId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, targetUserId] } } });
  await prisma.$disconnect();
});

function authed(req: request.Test) {
  return req.set('Cookie', token).set('Origin', 'http://localhost:5173').set('x-workspace-id', storeId);
}

describe('Mass assignment (over-posting)', () => {
  it('rejeita campos desconhecidos/sensíveis no update de profissional', async () => {
    const res = await authed(
      request(app)
        .put(`/api/appointments/professionals/${professionalId}`)
        .send({ nome: 'Hackeado', comissaoPercentual: 999, storeId: 'outra-loja', criadoPor: 1 })
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('storeId');

    const prof = await prisma.professional.findUnique({ where: { id: professionalId } });
    expect(prof?.nome).toBe('Prof Original');
    expect(prof?.comissaoPercentual?.toString()).toBe('5');
  });

  it('rejeita valores fora de faixa no update de profissional', async () => {
    const res = await authed(
      request(app)
        .put(`/api/appointments/professionals/${professionalId}`)
        .send({ comissaoPercentual: 'abc' })
    );
    expect(res.status).toBe(400);
  });

  it('rejeita campos desconhecidos no update de tipo de serviço', async () => {
    const res = await authed(
      request(app)
        .put(`/api/service-orders/service-types/${serviceTypeId}`)
        .send({ precoPadrao: 10, ownerId: 'x', storeId: 'y' })
    );
    expect(res.status).toBe(400);

    const st = await prisma.serviceType.findUnique({ where: { id: serviceTypeId } });
    expect(st?.precoPadrao?.toString()).toBe('100');
  });

  it('permite update legítimo com campos da allow-list', async () => {
    const res = await authed(
      request(app)
        .put(`/api/appointments/professionals/${professionalId}`)
        .send({ nome: 'Prof Atualizado', comissaoPercentual: 8 })
    );
    expect(res.status).toBe(200);
  });
});

describe('Anti-escalada de papel (role)', () => {
  it('bloqueia promoção para SUPER_ADMIN via payload', async () => {
    const res = await authed(
      request(app)
        .put(`/api/settings/users/${targetUserId}`)
        .send({ role: 'SUPER_ADMIN' })
    );
    expect(res.status).toBe(400);

    const access = await prisma.storeUserAccess.findUnique({
      where: { storeId_userId: { storeId, userId: targetUserId } },
    });
    expect(access?.role).toBe('VENDEDOR');
  });

  it('bloqueia criação de funcionário com papel global', async () => {
    const res = await authed(
      request(app)
        .post('/api/settings/users')
        .send({ nome: 'Novo', email: 'novo_val@lpzteste.app', senha: SENHA, role: 'SUPER_ADMIN' })
    );
    expect(res.status).toBe(400);
  });
});
