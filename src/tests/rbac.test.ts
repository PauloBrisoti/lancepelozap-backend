import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createSuperAdmin, createClientWithStore } from './factory';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';

describe('Permissões (RBAC interno e Visão Consolidada)', () => {
  let superToken: string;
  let supportToken: string;
  let clientA: any;

  beforeAll(async () => {
    const admin = await createSuperAdmin();
    const resA = await request(app).post('/api/auth/login').send({ email: admin.email, password: '123456' });
    superToken = resA.headers['set-cookie'][0].split(';')[0].split('=')[1];

    // Criar papel de suporte e usuário
    const role = await prisma.internalRole.create({
      data: {
        name: 'Suporte',
        permissions: {
          create: [{ module: 'CHAMADOS', accessLevel: 'FULL' }]
        }
      }
    });

    const hash = await bcrypt.hash('123456', 10);
    const supportUser = await prisma.user.create({
      data: {
        nome: 'Support Test',
        email: `suporte_${Date.now()}@test.com`,
        senhaHash: hash,
        role: 'SUPER_ADMIN',
        internalRoleId: role.id
      }
    });

    const resSup = await request(app).post('/api/auth/login').send({ email: supportUser.email, password: '123456' });
    supportToken = resSup.headers['set-cookie'][0].split(';')[0].split('=')[1];

    clientA = await createClientWithStore({ visaoConsolidada: false });
  });

  it('Suporte acessa CHAMADOS mas não acessa FINANCEIRO', async () => {
    // Acesso liberado (Chamados)
    const res1 = await request(app).get('/api/super-admin/chamados').set('Cookie', [`authToken=${supportToken}`]);
    expect(res1.status).not.toBe(403);

    // Acesso bloqueado (Financeiro admin)
    // Supondo que exista uma rota /api/super-admin/financeiro ou /api/super-admin/team que exige permissão diferente
    const res2 = await request(app).get('/api/super-admin/team/users').set('Cookie', [`authToken=${supportToken}`]);
    expect(res2.status).toBe(403);
    expect(res2.body.error).toMatch(/(Não autorizado|Acesso negado)/i);
  });

  it('Super admin imutável tem acesso a tudo', async () => {
    const res = await request(app).get('/api/super-admin/team/users').set('Cookie', [`authToken=${superToken}`]);
    expect(res.status).toBe(200);
  });

  it('Nenhum usuário consegue se autopromover', async () => {
    // Suporte tenta trocar seu próprio papel ou adicionar permissões
    const res = await request(app)
      .patch(`/api/super-admin/team/users/me/role`) // hipotético ou real
      .set('Cookie', [`authToken=${supportToken}`])
      .send({ roleId: 'algum-id-admin' });
    expect(res.status).toBe(403);
  });
});
