import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import { validateEmployeeLimit } from '../middleware/validateLimits';

const TEST_SUFFIX = `lim_${Date.now()}`;

describe('validateEmployeeLimit', () => {
  let user: any;
  let store: any;
  let client: any;

  beforeAll(async () => {
    const hash = await bcrypt.hash('123456', 10);
    user = await prisma.user.create({
      data: { nome: 'Test', email: `limit_test_${TEST_SUFFIX}@test.com`, senhaHash: hash, role: 'USER' }
    });

    client = await prisma.client.create({
      data: { nomeCompleto: 'Test Client', email: `limit_client_${TEST_SUFFIX}@test.com` }
    });

    const control = await prisma.control.create({
      data: { clientId: client.id, nome: 'Controle Test', tipo: 'PJ' }
    });

    store = await prisma.store.create({
      data: { controlId: control.id, nomeFantasia: 'Loja Limite Test', status: 'ATIVO' }
    });
  });

  afterAll(async () => {
    await prisma.storeUserAccess.deleteMany({ where: { storeId: store.id } });
    await prisma.store.delete({ where: { id: store.id } });
    await prisma.control.delete({ where: { id: store.controlId } });
    await prisma.client.delete({ where: { id: client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  it('permite criar até 3 funcionários', async () => {
    const hash = await bcrypt.hash('123456', 10);
    const users = [];

    for (let i = 0; i < 3; i++) {
      const u = await prisma.user.create({
        data: { nome: `Func ${i}`, email: `func_limit_${i}_${Date.now()}@test.com`, senhaHash: hash, role: 'USER' }
      });
      users.push(u);
      await prisma.storeUserAccess.create({
        data: { storeId: store.id, userId: u.id, role: 'VENDEDOR' }
      });
    }

    const count = await prisma.storeUserAccess.count({ where: { storeId: store.id } });
    expect(count).toBe(3);
  });

  it('bloqueia criação do 4º funcionário', async () => {
    const { req, res, next } = createMock();
    req.user.storeId = store.id;
    req.body.storeId = store.id;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _middleware = validateEmployeeLimit;
    await validateEmployeeLimit(req, res, next);
    expect(res._status).toBe(403);
    expect(res._json?.error).toContain('3 funcionários');
  });
});

function createMock() {
  const req = { user: { id: 'test', storeId: '' }, body: {} } as any;
  const res = {
    _status: 200,
    _json: null,
    status(code: number) { this._status = code; return this; },
    json(data: any) { this._json = data; return this; },
  } as any;
  const next = vi.fn();
  return { req, res, next };
}
