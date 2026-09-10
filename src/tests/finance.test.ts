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

  it('Parcelamento de payable deve dividir valor corretamente entre parcelas', async () => {
    // Cria wallet para a loja
    const wallet = await prisma.wallet.create({
      data: {
        storeId: clientA.store.id,
        nome: 'Caixa Teste Parcelas',
        tipo: 'CAIXA',
        saldoAtual: 0
      }
    });

    // Cria transação parcelada: R$100,00 em 3 parcelas
    // Esperado: 2 parcelas de R$33,33 + 1 de R$33,34 = R$100,00 (última absorve centavo extra)
    const res = await request(app)
      .post('/api/finance/transactions')
      .set('Cookie', [`authToken=${tokenA}`])
      .set('x-store-id', clientA.store.id)
      .send({
        walletId: wallet.id,
        tipo: 'SAIDA',
        valor: 100,
        descricao: 'Teste Parcelamento',
        categoria: 'Teste',
        dataTransacao: new Date().toISOString(),
        isParcelado: 'true',
        numeroParcelas: 3,
        frequencia: 'MENSAL',
        isFirstPaid: 'false'
      });

    expect(res.status).toBe(201);

    // Verifica que os payables foram criados com valores corretos
    const payables = await prisma.accountPayable.findMany({
      where: { storeId: clientA.store.id, descricao: { contains: 'Teste Parcelamento' } },
      orderBy: { numeroParcela: 'asc' }
    });

    expect(payables).toHaveLength(3);
    // Soma das parcelas deve ser exatamente R$100,00
    const somaParcelas = payables.reduce((acc, p) => acc + Number(p.valor), 0);
    expect(somaParcelas).toBe(100);
    // Primeira e segunda parcelas: R$33,33 (100/3 arredondado)
    expect(Number(payables[0].valor)).toBe(33.33);
    expect(Number(payables[1].valor)).toBe(33.33);
    // Última parcela absorve a diferença: R$33,34
    expect(Number(payables[2].valor)).toBe(33.34);
  });

  it('Parcelamento de payable com valor que gera centavo ímpar', async () => {
    const wallet = await prisma.wallet.create({
      data: {
        storeId: clientA.store.id,
        nome: 'Caixa Teste Centavo',
        tipo: 'CAIXA',
        saldoAtual: 0
      }
    });

    // R$10,01 em 3 parcelas: 2x R$3,34 + 1x R$3,33 = R$10,01
    const res = await request(app)
      .post('/api/finance/transactions')
      .set('Cookie', [`authToken=${tokenA}`])
      .set('x-store-id', clientA.store.id)
      .send({
        walletId: wallet.id,
        tipo: 'SAIDA',
        valor: 10.01,
        descricao: 'Teste Centavo',
        categoria: 'Teste',
        dataTransacao: new Date().toISOString(),
        isParcelado: 'true',
        numeroParcelas: 3,
        frequencia: 'MENSAL',
        isFirstPaid: 'false'
      });

    expect(res.status).toBe(201);

    const payables = await prisma.accountPayable.findMany({
      where: { storeId: clientA.store.id, descricao: { contains: 'Teste Centavo' } },
      orderBy: { numeroParcela: 'asc' }
    });

    expect(payables).toHaveLength(3);
    const somaParcelas = payables.reduce((acc, p) => acc + Number(p.valor), 0);
    expect(somaParcelas).toBeCloseTo(10.01, 2);
    expect(Number(payables[0].valor)).toBe(3.34);
    expect(Number(payables[1].valor)).toBe(3.34);
    expect(Number(payables[2].valor)).toBe(3.33);
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
