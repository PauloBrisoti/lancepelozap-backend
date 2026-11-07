import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';
import { PeriodCloseService } from '../services/PeriodCloseService';

describe('Contabilidade e Governança Contábil (Fase 2)', () => {
  let client: any;
  let agent: request.Agent;
  let storeId: string;

  beforeAll(async () => {
    agent = request.agent(app);
    client = await createClientWithStore();
    storeId = client.store.id;

    const loginRes = await agent
      .post('/api/auth/login')
      .send({ email: client.user.email, password: '123456' });
    expect(loginRes.status).toBe(200);
  });

  afterAll(async () => {
    await prisma.periodClose.deleteMany({ where: { storeId } }).catch(() => {});
    await prisma.journalEntry.deleteMany({ where: { storeId } }).catch(() => {});
    await prisma.chartOfAccount.deleteMany({ where: { storeId } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { storeId } }).catch(() => {});
  });

  describe('Fechamento de Período (Period Close)', () => {
    it('deve fechar um período contábil passado com sucesso', async () => {
      const res = await agent
        .post('/api/accounting/period-closes')
        .send({
          ano: 2025,
          mes: 12,
          observacao: 'Fechamento fiscal anual 2025',
        });

      expect(res.status).toBe(201);
      expect(res.body.ano).toBe(2025);
      expect(res.body.mes).toBe(12);

      const isClosed = await PeriodCloseService.isPeriodClosed(storeId, new Date('2025-12-15'));
      expect(isClosed).toBe(true);
    });

    it('deve impedir criação de venda retroativa em período fechado', async () => {
      const cat = await prisma.category.create({ data: { storeId, nome: 'Cat Test Acc' } });
      const product = await prisma.product.create({
        data: {
          storeId,
          categoryId: cat.id,
          nome: 'Produto Periodo Fechado',
          precoCusto: 10,
          precoVendaSugerido: 20,
          qtdEstoqueAtual: 10,
        },
      });

      const res = await agent
        .post('/api/sales')
        .send({
          formaPagamento: 'DINHEIRO',
          dataVenda: '2025-12-10T12:00:00.000Z',
          itens: [{ productId: product.id, quantidade: 1, precoUnitarioVendido: 20 }],
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Período contábil fechado/i);
    });

    it('deve reabrir período com justificativa de auditoria válida', async () => {
      const res = await agent
        .post('/api/accounting/period-closes/reopen')
        .send({
          ano: 2025,
          mes: 12,
          motivo: 'Reabertura autorizada pela auditoria para ajuste fiscal',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/reaberto com sucesso/i);

      const isClosed = await PeriodCloseService.isPeriodClosed(storeId, new Date('2025-12-15'));
      expect(isClosed).toBe(false);
    });
  });

  describe('Partidas Dobradas e Plano de Contas', () => {
    it('deve inicializar e listar o plano de contas padrão', async () => {
      const res = await agent.get('/api/accounting/chart-of-accounts');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((a: any) => a.codigo === '1.1.01.001')).toBe(true);
      expect(res.body.some((a: any) => a.codigo === '4.1.01.001')).toBe(true);
    });

    it('deve rejeitar lançamento contábil desbalanceado (Débito != Crédito)', async () => {
      const accounts = await prisma.chartOfAccount.findMany({ where: { storeId } });
      const conta1 = accounts[0];
      const conta2 = accounts[1];

      const res = await agent
        .post('/api/accounting/journal-entries')
        .send({
          descricao: 'Lançamento desbalanceado proposital',
          lines: [
            { accountId: conta1.id, tipo: 'DEBITO', valor: 100 },
            { accountId: conta2.id, tipo: 'CREDITO', valor: 80 },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/desbalanceada/i);
    });
  });

  describe('Governança de Crédito e Fiado', () => {
    it('deve bloquear venda no crediário para cliente com bloqueadoFiado=true', async () => {
      const customer = await prisma.customer.create({
        data: {
          storeId,
          nomeCompleto: 'Cliente Inadimplente Bloqueado',
          bloqueadoFiado: true,
          motivoBloqueioFiado: 'Inadimplência recorrente',
        },
      });

      const product = await prisma.product.findFirst({ where: { storeId } });

      const res = await agent
        .post('/api/sales')
        .send({
          customerId: customer.id,
          formaPagamento: 'CREDIARIO',
          numeroParcelas: 2,
          itens: [{ productId: product!.id, quantidade: 1, precoUnitarioVendido: 50 }],
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/crediário bloqueado/i);
    });

    it('deve rejeitar venda no crediário que exceda o limite de crédito', async () => {
      const customer = await prisma.customer.create({
        data: {
          storeId,
          nomeCompleto: 'Cliente com Limite R$ 100',
          limiteCredito: 100,
          bloqueadoFiado: false,
        },
      });

      const product = await prisma.product.findFirst({ where: { storeId } });

      const res = await agent
        .post('/api/sales')
        .send({
          customerId: customer.id,
          formaPagamento: 'CREDIARIO',
          numeroParcelas: 1,
          itens: [{ productId: product!.id, quantidade: 3, precoUnitarioVendido: 50 }], // Total R$ 150 > Limite R$ 100
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Limite de crédito excedido/i);
    });

    it('deve bloquear venda no crediário para cliente com parcela vencida acima da tolerância', async () => {
      const customer = await prisma.customer.create({
        data: {
          storeId,
          nomeCompleto: 'Cliente com Parcela Vencida',
          limiteCredito: 0,
          bloqueadoFiado: false,
        },
      });

      await prisma.accountReceivable.create({
        data: {
          storeId,
          customerId: customer.id,
          dataVencimento: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
          numeroParcela: 1,
          totalParcelas: 1,
          valorParcela: 100,
          formaPagamentoEsperada: 'CREDIARIO',
          status: 'PENDENTE',
        },
      });

      const product = await prisma.product.findFirst({ where: { storeId } });

      const res = await agent
        .post('/api/sales')
        .send({
          customerId: customer.id,
          formaPagamento: 'CREDIARIO',
          numeroParcelas: 1,
          itens: [{ productId: product!.id, quantidade: 1, precoUnitarioVendido: 20 }],
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/inadimplente|vencida/i);
    });
  });
});
