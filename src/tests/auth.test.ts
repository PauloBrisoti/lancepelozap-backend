import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createClientWithStore } from './factory';
import { limitFor } from '../lib/rateLimit';

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
    // Limite real da janela de 1 minuto é limitFor(30) (×5 em modo teste):
    // estoura com uma tentativa acima desse valor.
    const tentativas = limitFor(30) + 1;
    for (let i = 0; i < tentativas; i++) {
      res = await request(app)
        .post('/api/auth/login')
        .send({ email: clientA.user.email, password: 'wrongpassword' });
    }
    expect(res.status).toBe(429);
  }, 30000);
});
