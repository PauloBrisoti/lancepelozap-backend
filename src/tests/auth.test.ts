import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createClientWithStore } from './factory';

describe('Autenticação e 2FA', () => {
  let clientA: any;

  beforeAll(async () => {
    clientA = await createClientWithStore();
  });

  it('Login falha com credenciais inválidas sem expor o motivo exato', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: clientA.user.email, password: 'wrongpassword' });
    
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Credenciais inválidas/i);
  });

  it('Bloqueio por força bruta (Rate limit) no login', async () => {
    let res: any;
    // Rate limit é max=100 em modo teste; precisa de 101 tentativas para estourar
    for (let i = 0; i < 101; i++) {
      res = await request(app)
        .post('/api/auth/login')
        .send({ email: clientA.user.email, password: 'wrongpassword' });
    }
    expect(res.status).toBe(429);
  }, 30000);
});
