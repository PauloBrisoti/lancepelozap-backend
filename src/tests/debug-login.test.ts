import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createClientWithStore } from './factory';

describe('Debug Login', () => {
  it('check login response', async () => {
    const client = await createClientWithStore();
    const agent = request.agent(app);
    const res = await agent
      .post('/api/auth/login')
      .send({ email: client.user.email, password: '123456' });
    console.log('Login status:', res.status);
    console.log('Login body:', JSON.stringify(res.body));
    expect(res.status).toBe(200);
  });
});
