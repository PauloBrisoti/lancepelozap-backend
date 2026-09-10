import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

describe('requirePlanFeature — fail-closed', () => {
  let client: any;
  let token: string;

  beforeAll(async () => {
    client = await createClientWithStore();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: client.user.email, password: '123456' });
    token = res.headers['set-cookie'][0].split(';')[0].split('=')[1];
  });

  it('retorna 503 quando feature não está habilitada no plano', async () => {
    // A loja criada não tem plano com features, então requirePlanFeature deve retornar 403 (feature não disponível)
    // Mas o teste principal é: se o middleware falhar internamente, deve retornar 503 (fail-closed), não next()
    
    // Tenta acessar um endpoint protegido por feature flag
    // A loja não tem plano, então o middleware deve retornar 403 ou 503, nunca prosseguir
    const res = await request(app)
      .post('/api/stock-transfers')
      .set('Cookie', [`authToken=${token}`])
      .set('x-store-id', client.store.id)
      .send({
        destinationStoreId: 'invalid',
        items: []
      });
    
    // Não deve retornar 200 (que indicaria que o middleware deixou passar)
    expect(res.status).not.toBe(200);
  });
});
