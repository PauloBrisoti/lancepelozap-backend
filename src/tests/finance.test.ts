import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createClientWithStore } from './factory';
import { prisma } from '../lib/prisma';

describe('Cálculos Financeiros', () => {
  let tokenA: string;
  let clientA: any;

  let categoryId: string;

  beforeAll(async () => {
    clientA = await createClientWithStore();
    const resA = await request(app).post('/api/auth/login').send({ email: clientA.user.email, password: '123456' });
    tokenA = resA.headers['set-cookie'][0].split(';')[0].split('=')[1];

    const category = await prisma.category.create({
      data: {
        nome: 'Geral',
        storeId: clientA.store.id
      }
    });
    categoryId = category.id;
  });

  it('Cálculo de Margem e Imposto - Produto', async () => {
    // Rejeitar criar com texto
    const resFail = await request(app)
      .post('/api/products')
      .set('Cookie', [`authToken=${tokenA}`])
      .set('x-store-id', clientA.store.id)
      .send({
        nome: 'Tênis X',
        categoryId,
        precoCusto: 'vinte',
        precoVendaSugerido: 100,
        impostoEstimadoPercentual: 6
      });
    expect(resFail.status).toBe(400);

    const res = await request(app)
      .post('/api/products')
      .set('Cookie', [`authToken=${tokenA}`])
      .set('x-store-id', clientA.store.id)
      .send({
        nome: 'Tênis X',
        categoryId,
        precoCusto: 50,
        precoVendaSugerido: 100,
        impostoEstimadoPercentual: 6
      });
    
    // Supondo que a API retorna ou calcula o produto criado
    expect(res.status).toBe(201);

    // Margem = 100 - 50 = 50
    // Margem% = 50%
    // Imposto = 6% de 100 = 6
    // Margem liquida = 50 - 6 = 44
    // Isso pode ser testado na lógica de exibição, mas vamos garantir que o backend não salve lixo ou retorne dados errados

    const product = await prisma.product.findUnique({ where: { id: res.body.id } });
    expect(Number(product?.precoCusto)).toBe(50);
  });

  it('Divisão por zero no cálculo percentual', async () => {
    // Quando o preço for zero (doação, brinde), a API não deve travar
    const res = await request(app)
      .post('/api/products')
      .set('Cookie', [`authToken=${tokenA}`])
      .set('x-store-id', clientA.store.id)
      .send({
        nome: 'Brinde',
        categoryId,
        precoCusto: 10,
        precoVendaSugerido: 0,
        impostoEstimadoPercentual: 0
      });
    expect(res.status).toBe(201);
  });
});
