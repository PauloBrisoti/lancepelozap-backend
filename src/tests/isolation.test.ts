import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createClientWithStore } from './factory';
import { prisma } from '../lib/prisma';

describe('Isolamento de Dados', () => {
  let clientA: any;
  let clientB: any;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    clientA = await createClientWithStore();
    clientB = await createClientWithStore();

    // Login Client A
    const resA = await request(app)
      .post('/api/auth/login')
      .send({ email: clientA.user.email, password: '123456' });
    tokenA = resA.headers['set-cookie'][0].split(';')[0].split('=')[1];

    // Login Client B
    const resB = await request(app)
      .post('/api/auth/login')
      .send({ email: clientB.user.email, password: '123456' });
    tokenB = resB.headers['set-cookie'][0].split(';')[0].split('=')[1];
  });

  it('Cliente A não consegue acessar loja do Cliente B', async () => {
    const response = await request(app)
      .get(`/api/finance/dashboard`) // Rota que usa loja no header
      .set('Cookie', [`authToken=${tokenA}`])
      .set('x-store-id', clientB.store.id); // Tentativa de spoofing

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/não autorizado|acesso negado/i);
  });

  it('Uma loja só exibe vendas vinculadas a ela mesma', async () => {
    // Criar vendas
    await prisma.sale.create({
      data: {
        storeId: clientA.store.id,
        userId: clientA.user.id,
        valorTotalBruto: 100,
        valorTotalLiquido: 100,
        status: 'CONCLUIDA'
      }
    });

    await prisma.sale.create({
      data: {
        storeId: clientB.store.id,
        userId: clientB.user.id,
        valorTotalBruto: 500,
        valorTotalLiquido: 500,
        status: 'CONCLUIDA'
      }
    });

    const resA = await request(app)
      .get('/api/sales')
      .set('Cookie', [`authToken=${tokenA}`])
      .set('x-store-id', clientA.store.id);

    expect(resA.status).toBe(200);
    expect(resA.body).toHaveLength(1);
    expect(Number(resA.body[0].valorTotalBruto)).toBe(100);
  });

  it('IDOR: venda com customerId de OUTRA loja é rejeitada', async () => {
    // Cliente cadastrado apenas na loja B
    const foreignCustomer = await prisma.customer.create({
      data: {
        storeId: clientB.store.id,
        nomeCompleto: 'Cliente Secreto da Loja B',
        telefoneWhatsapp: '11988887777',
      },
    });

    // Produto da loja A para a venda
    const categoryA = await prisma.category.create({
      data: { nome: 'Categoria Teste A', storeId: clientA.store.id },
    });
    const productA = await prisma.product.create({
      data: {
        nome: 'Produto Teste A',
        storeId: clientA.store.id,
        categoryId: categoryA.id,
        precoCusto: 10,
        precoVendaSugerido: 50,
        qtdEstoqueAtual: 100,
      },
    });

    // Loja A tenta vender referenciando o cliente da loja B
    const resA = await request(app)
      .post('/api/sales')
      .set('Cookie', [`authToken=${tokenA}`])
      .set('x-store-id', clientA.store.id)
      .send({
        itens: [{ productId: productA.id, quantidade: 1, precoUnitarioVendido: 50 }],
        formaPagamento: 'DINHEIRO',
        customerId: foreignCustomer.id,
      });

    expect(resA.status).toBe(400);
    expect(resA.body.message).toMatch(/Cliente não encontrado nesta loja/);

    // Nenhuma venda foi criada com o cliente alheio
    const sale = await prisma.sale.findFirst({
      where: { storeId: clientA.store.id, customerId: foreignCustomer.id },
    });
    expect(sale).toBeNull();
  });
});
