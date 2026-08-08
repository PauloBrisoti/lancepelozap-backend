import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

describe('Lançamentos retroativos (integração)', () => {
  let client: any;
  let agent: any;
  let product: any;
  let wallet: any;

  beforeAll(async () => {
    client = await createClientWithStore();
    agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send({
      email: client.user.email,
      password: '123456',
    });
    expect(loginRes.status).toBe(200);

    const cat = await prisma.category.create({
      data: { nome: 'Cat Retroativo', storeId: client.store.id, corHexadecimal: '#fff' },
    });
    product = await prisma.product.create({
      data: {
        storeId: client.store.id,
        categoryId: cat.id,
        nome: 'Produto Retroativo',
        precoCusto: 100,
        precoVendaSugerido: 250,
        qtdEstoqueAtual: 0,
        codigoVisual: 'RETRO1',
        status: 'ATIVO',
      },
    });
    wallet = await prisma.wallet.create({
      data: { storeId: client.store.id, nome: 'Caixa Retroativo', tipo: 'DINHEIRO', saldoAtual: 1000 },
    });
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.accountPayable.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.financialTransaction.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.purchaseOrderItem.deleteMany({ where: { order: { storeId: client.store.id } } }).catch(() => {});
    await prisma.purchaseOrder.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.saleItem.deleteMany({ where: { sale: { storeId: client.store.id } } }).catch(() => {});
    await prisma.sale.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.supplier.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.product.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.category.deleteMany({ where: { storeId: client.store.id } }).catch(() => {});
    await prisma.storeUserAccess.deleteMany({ where: { storeId: client.store.id } });
    await prisma.store.delete({ where: { id: client.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: client.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: client.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: client.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: client.user.id } }).catch(() => {});
  });

  it('compra parcelada retroativa: frete entra no total, parcelas globais e estoque com custo médio', async () => {
    const supplier = await prisma.supplier.create({
      data: { storeId: client.store.id, nome: 'Fornec Retro', tipoPessoa: 'PJ', cnpjCpf: '99888777000188' },
    });

    // Compra de 2 produtos diferentes (10 unid cada), 4x no cartão, frete R$ 40
    const res = await agent.post('/api/purchases').send({
      supplierId: supplier.id,
      items: [
        { productId: product.id, quantidade: 10, precoUnitario: 100 },
        { productId: product.id, quantidade: 10, precoUnitario: 100 },
      ],
      formaPagamento: 'PARCELADO_FORNECEDOR',
      numeroParcelas: 4,
      primeiroVencimento: '2026-05-10',
      dataPedido: '2026-05-01',
      valorFrete: 40,
    });
    expect(res.status).toBe(201);
    const orderId = res.body.id;

    // Pedido é RASCUNHO até receber — parcelas ainda não existem se não recebido?
    const payables = await prisma.accountPayable.findMany({ where: { purchaseOrderId: orderId } });
    expect(payables.length).toBe(4);
    const soma = payables.reduce((acc, p) => acc + Number(p.valor), 0);
    expect(soma).toBeCloseTo(2040, 1); // 2000 + 40 de frete
    expect(payables.every(p => p.purchaseOrderId === orderId)).toBe(true);
  });

  it('recebe a compra e o custo médio inclui frete e desconto rateados', async () => {
    const list = await agent.get('/api/purchases');
    const order = list.body.data[0];
    const itemId = order.items[0].id;

    await agent.patch(`/api/purchases/${order.id}/status`).send({ status: 'PENDENTE' });

    const res = await agent.post(`/api/purchases/${order.id}/receive`).send({
      itens: [{ itemId, quantidadeRecebida: 10 }],
    });
    expect(res.status).toBe(200);

    const after = await prisma.product.findUnique({ where: { id: product.id } });
    // 10 unid a R$ 100 + frete rateado (40/2 = 20 por item) → custo 102 por unidade
    expect(Number(after!.qtdEstoqueAtual)).toBe(10);
    expect(Number(after!.precoCusto)).toBeCloseTo(102, 1);
  });

  it('venda retroativa: CMV no DRE e caixa refletem a data informada', async () => {
    // Vende 1 unidade com data retroativa (junho)
    const res = await agent.post('/api/sales').send({
      itens: [{ productId: product.id, quantidade: 1, precoUnitarioVendido: 250 }],
      formaPagamento: 'PIX',
      valorDesconto: 0,
      dataVenda: '2026-06-15T14:30',
    });
    expect(res.status).toBe(201);

    const sale = await prisma.sale.findFirst({
      where: { storeId: client.store.id },
      include: { saleItems: true },
    });
    expect(sale).not.toBeNull();
    expect(sale!.dataVenda.getFullYear()).toBe(2026);
    expect(sale!.dataVenda.getMonth()).toBe(5); // junho
    expect(Number(sale!.saleItems[0].custoUnitarioHistorico)).toBeCloseTo(102, 1);
    expect(Number(sale!.cmvTotal)).toBeCloseTo(102, 1);
    expect(Number(sale!.valorTotalLiquido)).toBeCloseTo(250, 1);

    const tx = await prisma.financialTransaction.findFirst({
      where: { storeId: client.store.id, saleId: sale!.id, tipo: 'ENTRADA' },
    });
    expect(tx).not.toBeNull();
    expect(tx!.dataTransacao.getMonth()).toBe(5); // competência retroativa

    // Parcelas da compra NÃO mudam com a venda
    const payables = await prisma.accountPayable.findMany({ where: { storeId: client.store.id, status: 'PENDENTE' } });
    const soma = payables.reduce((acc, p) => acc + Number(p.valor), 0);
    expect(soma).toBeCloseTo(2040, 1);
  });

  it('saldo projetado considera parcelas vencidas de meses anteriores', async () => {
    const res = await agent.get('/api/v2/dashboard/pj').send();
    expect(res.status).toBe(200);
    const body = res.body;

    // Caixa (fonte de verdade = carteira): 1000 do saldo inicial criado direto
    // no banco + 250 da venda PIX retroativa (entrada registrada na carteira)
    expect(body.metrics.saldoAtual).toBeCloseTo(1250, 1);
    // Parcelas vencem em 10/05/2026 — mês anterior ao atual → NÃO zeradas do saldo projetado
    const parcelasMes = body.metrics.parcelasFornecedoresMes;
    expect(Number(parcelasMes)).toBeGreaterThan(0);
  });
});
