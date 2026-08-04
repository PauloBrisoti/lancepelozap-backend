import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import express from 'express';
import { requireStorePermission } from '../middleware/requireStorePermission';

function createMockRequestResponse(storeId: string, userId: string) {
  const req = {
    user: { id: userId, storeId },
    body: {},
  } as any;

  const res = {
    _status: 200,
    _json: null,
    status(code: number) { this._status = code; return this; },
    json(data: any) { this._json = data; return this; },
  } as any;

  const next = () => {};

  return { req, res, next, mockNext: vi.fn() };
}

describe('requireStorePermission middleware', () => {
  let user: any;
  let store: any;

  beforeAll(async () => {
    // Criar loja e usuário de teste
    const hash = await bcrypt.hash('123456', 10);
    user = await prisma.user.create({
      data: { nome: 'Test Vendedor', email: `vendedor_${Date.now()}@lpzteste.app`, senhaHash: hash, role: 'USER' }
    });

    const client = await prisma.client.create({
      data: { nomeCompleto: 'Test Client', email: `client_perm_${Date.now()}@lpzteste.app` }
    });

    const control = await prisma.control.create({
      data: { clientId: client.id, nome: 'Controle Test', tipo: 'PJ' }
    });

    store = await prisma.store.create({
      data: { controlId: control.id, nomeFantasia: 'Loja Teste Perm', status: 'ATIVO' }
    });
  });

  afterAll(async () => {
    if (store) await prisma.store.delete({ where: { id: store.id } }).catch(() => {});
    if (user) await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  });

  it('bloqueia acesso sem permissão de loja', async () => {
    // Usuário sem acesso à loja
    const { req, res, mockNext } = createMockRequestResponse(store.id, 'fake-user-id');
    const middleware = requireStorePermission('vender');
    await middleware(req, res, mockNext);
    expect(res._status).toBe(403);
  });

  it('permite acesso com permissão correta', async () => {
    // Dar permissão de VENDEDOR ao usuário
    await prisma.storeUserAccess.create({
      data: { storeId: store.id, userId: user.id, role: 'VENDEDOR', permiteVendaPrazo: true }
    });

    const { req, res, mockNext } = createMockRequestResponse(store.id, user.id);
    const middleware = requireStorePermission('vender');
    await middleware(req, res, mockNext);
    // Deve chamar next, não retornar erro
    expect(res._status).toBe(200);
  });

  it('bloqueia vendedor de gerenciar financeiro', async () => {
    const { req, res, mockNext } = createMockRequestResponse(store.id, user.id);
    const middleware = requireStorePermission('gerenciar_financeiro');
    await middleware(req, res, mockNext);
    expect(res._status).toBe(403);
  });

  it('bloqueia venda no crediário sem permissão', async () => {
    // Remover permissão de venda a prazo
    await prisma.storeUserAccess.update({
      where: { storeId_userId: { storeId: store.id, userId: user.id } },
      data: { permiteVendaPrazo: false }
    });

    const { req, res, mockNext } = createMockRequestResponse(store.id, user.id);
    const middleware = requireStorePermission('vender_crediario');
    await middleware(req, res, mockNext);
    expect(res._status).toBe(403);

    // Restaurar permissão
    await prisma.storeUserAccess.update({
      where: { storeId_userId: { storeId: store.id, userId: user.id } },
      data: { permiteVendaPrazo: true }
    });
  });
});
