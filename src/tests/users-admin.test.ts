import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createSuperAdmin } from './factory';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';

describe('Gestão de usuários (UsuariosAdminPage)', () => {
  let superToken: string;
  let targetUserId: string;
  let targetEmail: string;
  let otherUserId: string;

  beforeAll(async () => {
    const admin = await createSuperAdmin();
    const resA = await request(app).post('/api/auth/login').send({ email: admin.email, password: '123456' });
    superToken = resA.headers['set-cookie'][0].split(';')[0].split('=')[1];

    const hash = await bcrypt.hash('123456', 10);
    const target = await prisma.user.create({
      data: { nome: 'Alvo Reset', email: `alvo_${Date.now()}@lpzteste.app`, senhaHash: hash, role: 'USER' }
    });
    const other = await prisma.user.create({
      data: { nome: 'Outro Usuário', email: `outro_${Date.now()}@lpzteste.app`, senhaHash: hash, role: 'USER' }
    });
    targetUserId = target.id;
    otherUserId = other.id;
    targetEmail = target.email;
  });

  it('login registra lastLogin', async () => {
    await request(app).post('/api/auth/login').send({ email: targetEmail, password: '123456' });
    const u = await prisma.user.findUnique({ where: { id: targetUserId } });
    expect(u?.lastLogin).toBeTruthy();
  });

  it('listAllUsers expõe lastLogin', async () => {
    const res = await request(app).get('/api/super-admin/users/all').set('Cookie', [`authToken=${superToken}`]);
    expect(res.status).toBe(200);
    const found = res.body.find((u: any) => u.id === targetUserId);
    expect(found).toBeTruthy();
    expect(found.lastLogin).toBeTruthy();
  });

  it('reset individual grava auditoria e troca a senha', async () => {
    const res = await request(app)
      .put(`/api/super-admin/users/${targetUserId}/reset-password`)
      .set('Cookie', [`authToken=${superToken}`])
      .send({ novaSenha: 'NovaSenha@2026' });
    expect(res.status).toBe(200);

    const log = await prisma.auditLog.findFirst({ where: { acao: 'USER_PASSWORD_RESET' } });
    expect(log).toBeTruthy();
    expect(log.dadosNovos).toHaveProperty('userId', targetUserId);

    // senha antiga não funciona mais
    const oldLogin = await request(app).post('/api/auth/login').send({ email: targetEmail, password: '123456' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/auth/login').send({ email: targetEmail, password: 'NovaSenha@2026' });
    expect(newLogin.status).toBe(200);
  });

  it('reset seletivo (userIds) atinge apenas os selecionados e ignora SUPER_ADMIN', async () => {
    const hash = await bcrypt.hash('123456', 10);
    const superUser = await prisma.user.create({
      data: { nome: 'Sup Resettável?', email: `supx_${Date.now()}@lpzteste.app`, senhaHash: hash, role: 'SUPER_ADMIN' }
    });

    const res = await request(app)
      .post('/api/super-admin/users/reset-all-passwords')
      .set('Cookie', [`authToken=${superToken}`])
      .send({ senhaPadrao: 'Selecionado@2026', userIds: [targetUserId, superUser.id], confirmPassword: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);

    // target mudou, other não, super não
    const targetOk = await request(app).post('/api/auth/login').send({ email: targetEmail, password: 'Selecionado@2026' });
    expect(targetOk.status).toBe(200);
    const otherOk = await request(app).post('/api/auth/login').send({
      email: (await prisma.user.findUnique({ where: { id: otherUserId } }))!.email,
      password: '123456'
    });
    expect(otherOk.status).toBe(200);
    const superOk = await request(app).post('/api/auth/login').send({ email: superUser.email, password: '123456' });
    expect(superOk.status).toBe(200);

    const log = await prisma.auditLog.findFirst({ where: { acao: 'USERS_PASSWORD_BULK_RESET' } });
    expect(log).toBeTruthy();
    expect(log.dadosNovos).toHaveProperty('count', 1);
  });

  it('não desativa nem rebaixa o último Super Admin', async () => {
    const hash = await bcrypt.hash('123456', 10);
    const lastAdmin = await prisma.user.create({
      data: { nome: 'Último Admin', email: `lastadmin_${Date.now()}@lpzteste.app`, senhaHash: hash, role: 'SUPER_ADMIN' }
    });
    // Deixa apenas esse como Super Admin ativo
    await prisma.user.updateMany({
      where: { role: 'SUPER_ADMIN', ativo: true, id: { not: lastAdmin.id } },
      data: { ativo: false }
    });

    const deactivate = await request(app)
      .put(`/api/super-admin/users/${lastAdmin.id}`)
      .set('Cookie', [`authToken=${superToken}`])
      .send({ ativo: false });
    expect(deactivate.status).toBe(400);
    expect(deactivate.body.error).toMatch(/último Super Admin/i);

    const demote = await request(app)
      .put(`/api/super-admin/users/${lastAdmin.id}`)
      .set('Cookie', [`authToken=${superToken}`])
      .send({ role: 'USER' });
    expect(demote.status).toBe(400);
  });
});
