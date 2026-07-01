import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

function gerarCPFValido(): string {
  const n = () => Math.floor(Math.random() * 9);
  const nums = Array.from({ length: 9 }, n);
  const calc = (d: number[]) => {
    let soma = 0;
    for (let i = 0; i < d.length; i++) soma += d[i] * (d.length + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  nums.push(calc(nums));
  nums.push(calc(nums));
  return nums.join('');
}

describe('Customers CRUD (integração)', () => {
  let client: any;
  let agent: request.Agent;
  const cpf1 = gerarCPFValido();
  const cpf2 = gerarCPFValido();
  const cpf3 = gerarCPFValido();

  beforeAll(async () => {
    agent = request.agent(app);
    client = await createClientWithStore();

    const loginRes = await agent
      .post('/api/auth/login')
      .send({ email: client.user.email, password: '123456' });
    expect(loginRes.status).toBe(200);
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { storeId: client.store.id } });
    await prisma.storeUserAccess.deleteMany({ where: { storeId: client.store.id } });
    await prisma.store.delete({ where: { id: client.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: client.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: client.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: client.user.id } }).catch(() => {});
  });

  it('GET /api/customers — lista vazia', async () => {
    const res = await agent.get('/api/customers');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /api/customers — cria cliente', async () => {
    const res = await agent.post('/api/customers').send({
      nomeCompleto: 'João Silva',
      cpf: cpf1,
      telefoneWhatsapp: '11988888888',
    });
    expect(res.status).toBe(201);
    expect(res.body.nomeCompleto).toBe('João Silva');
  });

  it('POST /api/customers — rejeita sem nome', async () => {
    const res = await agent.post('/api/customers').send({
      cpf: cpf1,
      telefoneWhatsapp: '11999999999',
    });
    expect(res.status).toBe(400);
  });

  it('PUT /api/customers/:id — atualiza cliente', async () => {
    const created = await agent.post('/api/customers').send({
      nomeCompleto: 'Maria Souza',
      cpf: cpf2,
      telefoneWhatsapp: '11977777777',
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const res = await agent.put(`/api/customers/${id}`).send({
      nomeCompleto: 'Maria Souza Atualizada',
      cpf: cpf2,
      telefoneWhatsapp: '11977777777',
    });
    expect(res.status).toBe(200);
    expect(res.body.nomeCompleto).toBe('Maria Souza Atualizada');
  });

  it('DELETE /api/customers/:id — exclui cliente', async () => {
    const created = await agent.post('/api/customers').send({
      nomeCompleto: 'Cliente Deletar',
      cpf: cpf3,
      telefoneWhatsapp: '11966666666',
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const res = await agent.delete(`/api/customers/${id}`);
    expect(res.status).toBe(200);

    const deleted = await prisma.customer.findUnique({ where: { id } });
    expect(deleted).toBeNull();
  });

  it('PUT /api/customers/:id — rejeita inexistente', async () => {
    const res = await agent.put('/api/customers/0000000000').send({
      nomeCompleto: 'Inexistente',
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/customers — sem auth retorna 401', async () => {
    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(401);
  });
});
