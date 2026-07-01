import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

const request = supertest.agent(app);

describe('Fornecedores (Suppliers) API', () => {
  let client: any;
  let supplierId: string;

  beforeAll(async () => {
    client = await createClientWithStore();
    const loginRes = await request.post('/api/auth/login').send({
      email: client.user.email,
      password: '123456',
    });
    expect(loginRes.status).toBe(200);
  });

  afterAll(async () => {
    await prisma.supplier.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.storeUserAccess.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.store.delete({ where: { id: client.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: client.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: client.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: client.user.id } }).catch(() => {});
  });

  it('GET /api/suppliers - lista vazia', async () => {
    const res = await request.get('/api/suppliers');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('POST /api/suppliers - cria fornecedor PJ', async () => {
    const res = await request.post('/api/suppliers').send({
      nome: 'Distribuidora ABC',
      tipoPessoa: 'PJ',
      cnpjCpf: '11222333000181',
      telefone: '11999999999',
      email: 'abc@distribuidora.com',
    });
    expect(res.status).toBe(201);
    expect(res.body.nome).toBe('Distribuidora ABC');
    expect(res.body.tipoPessoa).toBe('PJ');
    expect(res.body.status).toBe('ATIVO');
    supplierId = res.body.id;
  });

  it('POST /api/suppliers - cria fornecedor PF', async () => {
    const res = await request.post('/api/suppliers').send({
      nome: 'João Fornecedor',
      tipoPessoa: 'PF',
      cnpjCpf: '12345678901',
    });
    expect(res.status).toBe(201);
  });

  it('GET /api/suppliers - lista todos', async () => {
    const res = await request.get('/api/suppliers');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it('GET /api/suppliers/:id - retorna por id', async () => {
    const res = await request.get(`/api/suppliers/${supplierId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(supplierId);
    expect(res.body.nome).toBe('Distribuidora ABC');
  });

  it('PUT /api/suppliers/:id - atualiza', async () => {
    const res = await request.put(`/api/suppliers/${supplierId}`).send({
      nome: 'Distribuidora XYZ',
      telefone: '11988888888',
    });
    expect(res.status).toBe(200);
    expect(res.body.nome).toBe('Distribuidora XYZ');
    expect(res.body.telefone).toBe('11988888888');
  });

  it('PUT /api/suppliers/:id - inativa fornecedor', async () => {
    const res = await request.put(`/api/suppliers/${supplierId}`).send({
      status: 'INATIVO',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('INATIVO');
  });

  it('GET /api/suppliers?status=ATIVO - filtra', async () => {
    const res = await request.get('/api/suppliers?status=ATIVO');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it('POST /api/suppliers - rejeita sem nome', async () => {
    const res = await request.post('/api/suppliers').send({ tipoPessoa: 'PJ' });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/suppliers/:id - remove fornecedor sem vínculos', async () => {
    // Find the PF supplier (without purchase orders)
    const list = await request.get('/api/suppliers');
    const pf = list.body.find((s: any) => s.tipoPessoa === 'PF');
    if (!pf) return;

    const res = await request.delete(`/api/suppliers/${pf.id}`);
    expect(res.status).toBe(200);
  });

  it('GET /api/suppliers/sem-auth - retorna 401', async () => {
    const res = await supertest(app).get('/api/suppliers');
    expect(res.status).toBe(401);
  });
});
