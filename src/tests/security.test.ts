import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';

describe('Segurança e Carga Básica', () => {
  it('Rotas sensíveis exigem autenticação', async () => {
    const res = await request(app).get('/api/finance/dashboard');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Token não fornecido|não autorizado|Acesso negado/i);
  });
});
