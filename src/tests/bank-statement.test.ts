import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';
import { BankStatementParserService } from '../services/BankStatementParserService';
import { parseDate } from '../lib/dateUtils';

describe('BankStatementParserService', () => {
  it('parseia CSV com separador ";", decimal com vírgula e tipo explícito', () => {
    const csv = [
      'Data;Descrição;Valor;Tipo',
      '05/11/2026;"PIX RECEBIDO; CLIENTE";1.234,56;CREDITO',
      '04/11/2026;TARIFA BANCARIA;-25,90;',
    ].join('\n');

    const items = BankStatementParserService.parseCSV(csv);

    expect(items).toHaveLength(2);
    expect(items[0].descricao).toBe('PIX RECEBIDO; CLIENTE');
    expect(items[0].valor).toBe(1234.56);
    expect(items[0].tipo).toBe('CREDITO');
    expect(items[0].data.toISOString()).toBe(parseDate('2026-11-05')!.toISOString());
    expect(items[1].valor).toBe(25.9);
    expect(items[1].tipo).toBe('DEBITO');
  });

  it('parseia OFX com crédito e débito', () => {
    const ofx = `
      <OFX>
        <BANKMSGSRSV1><STMTTRNRS><STMTRS>
          <BANKACCTFROM><BANKID>001</BANKID></BANKACCTFROM>
          <BANKTRANLIST>
            <ORG>Banco Teste</ORG>
            <STMTTRN>
              <TRNTYPE>DEBIT
              <DTPOSTED>20261104120000[-3:BRT]
              <TRNAMT>-45.90
              <FITID>1
              <MEMO>TARIFA BANCARIA
            </STMTTRN>
            <STMTTRN>
              <TRNTYPE>CREDIT
              <DTPOSTED>20261105100000
              <TRNAMT>250.00
              <FITID>2
              <MEMO>PIX RECEBIDO
            </STMTTRN>
          </BANKTRANLIST>
        </STMTRS></STMTTRNRS></BANKMSGSRSV1>
      </OFX>
    `;

    const parsed = BankStatementParserService.parse(ofx, 'extrato.ofx');

    expect(parsed.format).toBe('OFX');
    expect(parsed.banco).toBe('Banco Teste');
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].tipo).toBe('DEBITO');
    expect(parsed.items[0].valor).toBe(45.9);
    expect(parsed.items[1].tipo).toBe('CREDITO');
    expect(parsed.items[1].valor).toBe(250);
  });
});

describe('Conciliação bancária via API', () => {
  let agent: request.Agent;
  let storeId: string;
  let walletId: string;
  let otherWalletId: string;
  let manualTransactionId: string;
  let manualItemId: string;

  beforeAll(async () => {
    const { user, store } = await createClientWithStore();
    storeId = store.id;

    agent = request.agent(app);
    const login = await agent
      .post('/api/auth/login')
      .send({ email: user.email, password: '123456' });
    expect(login.status).toBe(200);

    const wallet = await prisma.wallet.create({
      data: { storeId, nome: 'Conta Bancária', tipo: 'BANCO' },
    });
    walletId = wallet.id;

    const otherWallet = await prisma.wallet.create({
      data: { storeId, nome: 'Outra Conta Bancária', tipo: 'BANCO' },
    });
    otherWalletId = otherWallet.id;

    await prisma.financialTransaction.createMany({
      data: [
        {
          storeId,
          walletId,
          tipo: 'ENTRADA',
          status: 'ATIVA',
          valor: 100,
          descricao: 'PIX recebido',
          dataTransacao: new Date('2026-11-05T12:00:00Z'),
        },
        {
          storeId,
          walletId,
          tipo: 'SAIDA',
          status: 'ATIVA',
          valor: 45.9,
          descricao: 'Tarifa bancária',
          dataTransacao: new Date('2026-11-06T12:00:00Z'),
        },
        {
          storeId,
          walletId,
          tipo: 'ENTRADA',
          status: 'ATIVA',
          valor: 45.9,
          descricao: 'Entrada de mesmo valor (direção oposta)',
          dataTransacao: new Date('2026-11-06T12:00:00Z'),
        },
        {
          storeId,
          walletId: otherWallet.id,
          tipo: 'ENTRADA',
          status: 'ATIVA',
          valor: 100,
          descricao: 'Mesmo valor em outra carteira',
          dataTransacao: new Date('2026-11-05T12:00:00Z'),
        },
      ],
    });
  });

  it('importa um CSV e cria os itens pendentes', async () => {
    const csv = [
      'Data;Descrição;Valor',
      '05/11/2026;PIX RECEBIDO;100,00',
      '06/11/2026;TARIFA;-45,90',
      '10/11/2026;LANCAMENTO SEM PAR;-45,90',
    ].join('\n');

    const res = await agent
      .post('/api/finance/bank-statements/import')
      .set('x-workspace-id', storeId)
      .field('banco', 'Banco Teste')
      .field('walletId', walletId)
      .attach('file', Buffer.from(csv), { filename: 'extrato.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.banco).toBe('Banco Teste');
    expect(res.body.walletId).toBe(walletId);
    expect(res.body.format).toBe('CSV');
    expect(res.body.totalItems).toBe(3);

    const items = await prisma.bankStatementItem.findMany({
      where: { importId: res.body.id },
    });
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.conciliado === false)).toBe(true);
  });

  it('bloqueia a reimportação do mesmo extrato na mesma loja', async () => {
    const csv = [
      'Data;Descrição;Valor',
      '05/11/2026;PIX RECEBIDO;100,00',
      '06/11/2026;TARIFA;-45,90',
      '10/11/2026;LANCAMENTO SEM PAR;-45,90',
    ].join('\n');

    const res = await agent
      .post('/api/finance/bank-statements/import')
      .set('x-workspace-id', storeId)
      .attach('file', Buffer.from(csv), { filename: 'extrato-copia.csv', contentType: 'text/csv' });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('já foi importado');

    const count = await prisma.bankStatementImport.count({ where: { storeId } });
    expect(count).toBe(1);

    // Conteúdo diferente continua permitido
    const outro = [
      'Data;Descrição;Valor',
      '11/11/2026;RECEBIMENTO NOVO;10,00',
    ].join('\n');
    const resOutro = await agent
      .post('/api/finance/bank-statements/import')
      .set('x-workspace-id', storeId)
      .attach('file', Buffer.from(outro), { filename: 'extrato-2.csv', contentType: 'text/csv' });
    expect(resOutro.status).toBe(201);

    await prisma.bankStatementImport.delete({ where: { id: resOutro.body.id } });
  });

  it('concilia automaticamente por valor exato e data ±2 dias', async () => {
    const res = await agent
      .post('/api/finance/bank-statements/reconcile')
      .set('x-workspace-id', storeId)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.analyzed).toBe(3);
    expect(res.body.reconciled).toBe(2);
    expect(res.body.pending).toBe(1);

    const linked = await prisma.bankStatementItem.findMany({
      where: { import: { storeId }, conciliado: true },
      include: { financialTransaction: true },
    });
    expect(linked).toHaveLength(2);
    expect(linked.every((item) => item.financialTransactionId)).toBe(true);

    const entry = linked.find((item) => item.tipo === 'CREDITO');
    expect(entry?.financialTransaction?.tipo).toBe('ENTRADA');
    expect(entry?.financialTransaction?.walletId).toBe(walletId);
    expect(Number(entry?.financialTransaction?.valor)).toBe(100);

    const exit = linked.find((item) => item.tipo === 'DEBITO');
    expect(exit?.financialTransaction?.tipo).toBe('SAIDA');
    expect(Number(exit?.financialTransaction?.valor)).toBe(45.9);
  });

  it('não reutiliza transações já conciliadas em uma nova execução', async () => {
    const res = await agent
      .post('/api/finance/bank-statements/reconcile')
      .set('x-workspace-id', storeId)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.analyzed).toBe(1);
    expect(res.body.reconciled).toBe(0);
    expect(res.body.pending).toBe(1);
  });

  it('lista importações com totais e permite filtrar itens', async () => {
    const imports = await agent
      .get('/api/finance/bank-statements')
      .set('x-workspace-id', storeId);

    expect(imports.status).toBe(200);
    expect(imports.body).toHaveLength(1);
    expect(imports.body[0].totalItems).toBe(3);
    expect(imports.body[0].reconciledItems).toBe(2);
    expect(imports.body[0].pendingItems).toBe(1);
    expect(imports.body[0].wallet.id).toBe(walletId);

    const items = await agent
      .get(`/api/finance/bank-statements/${imports.body[0].id}/items?conciliado=false`)
      .set('x-workspace-id', storeId);

    expect(items.status).toBe(200);
    expect(items.body.items).toHaveLength(1);
    expect(items.body.items[0].descricao).toBe('LANCAMENTO SEM PAR');
  });

  it('permite conciliação manual e bloqueia reutilização do lançamento', async () => {
    const pending = await prisma.bankStatementItem.findFirst({
      where: { import: { storeId }, conciliado: false, financialTransactionId: null },
    });
    const transaction = await prisma.financialTransaction.findFirst({
      where: { storeId, descricao: 'Entrada de mesmo valor (direção oposta)' },
    });

    expect(pending).not.toBeNull();
    expect(transaction).not.toBeNull();

    manualItemId = pending!.id;
    manualTransactionId = transaction!.id;

    const link = await agent
      .post(`/api/finance/bank-statements/items/${manualItemId}/link`)
      .set('x-workspace-id', storeId)
      .send({ financialTransactionId: manualTransactionId });

    expect(link.status).toBe(200);
    expect(link.body.conciliado).toBe(true);
    expect(link.body.financialTransactionId).toBe(manualTransactionId);

    const alreadyLinked = await prisma.bankStatementItem.findFirst({
      where: {
        import: { storeId },
        conciliado: true,
        financialTransactionId: { not: null },
        id: { not: manualItemId },
      },
    });

    const conflict = await agent
      .patch(`/api/finance/bank-statements/items/${alreadyLinked!.id}`)
      .set('x-workspace-id', storeId)
      .send({ financialTransactionId: manualTransactionId });

    expect(conflict.status).toBe(409);
  });

  it('desconcilia um item manualmente', async () => {
    const res = await agent
      .post(`/api/finance/bank-statements/items/${manualItemId}/unlink`)
      .set('x-workspace-id', storeId)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.conciliado).toBe(false);
    expect(res.body.financialTransactionId).toBeNull();
  });

  it('não permite vincular item a lançamento de outra carteira da mesma loja', async () => {
    const pending = await prisma.bankStatementItem.findFirst({
      where: { import: { storeId }, conciliado: false },
    });
    const otherTransaction = await prisma.financialTransaction.findFirst({
      where: { storeId, walletId: otherWalletId },
    });

    const res = await agent
      .patch(`/api/finance/bank-statements/items/${pending!.id}`)
      .set('x-workspace-id', storeId)
      .send({ financialTransactionId: otherTransaction!.id });

    expect(res.status).toBe(409);
  });

  it('não permite vincular item a lançamento de outra loja', async () => {
    const { store: otherStore } = await createClientWithStore();
    const otherWallet = await prisma.wallet.create({
      data: { storeId: otherStore.id, nome: 'Conta de outra loja', tipo: 'BANCO' },
    });
    const otherTransaction = await prisma.financialTransaction.create({
      data: {
        storeId: otherStore.id,
        walletId: otherWallet.id,
        tipo: 'ENTRADA',
        status: 'ATIVA',
        valor: 10,
        descricao: 'Lançamento de outra loja',
        dataTransacao: new Date('2026-11-05T12:00:00Z'),
      },
    });

    const pending = await prisma.bankStatementItem.findFirst({
      where: { import: { storeId }, conciliado: false },
    });

    const res = await agent
      .patch(`/api/finance/bank-statements/items/${pending!.id}`)
      .set('x-workspace-id', storeId)
      .send({ financialTransactionId: otherTransaction.id });

    expect(res.status).toBe(404);
  });

  it('exclui uma importação e os itens sem tocar nos lançamentos financeiros', async () => {
    const before = await prisma.financialTransaction.count({ where: { storeId } });
    const importId = (await prisma.bankStatementImport.findFirstOrThrow({ where: { storeId } })).id;

    const res = await agent
      .delete(`/api/finance/bank-statements/${importId}`)
      .set('x-workspace-id', storeId);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(importId);
    expect(res.body.deletedItems).toBe(3);

    const remaining = await prisma.bankStatementImport.findMany({ where: { storeId } });
    expect(remaining).toHaveLength(0);
    expect(await prisma.bankStatementItem.count({ where: { importId } })).toBe(0);

    // Lançamentos financeiros permanecem intactos e ativos
    expect(await prisma.financialTransaction.count({ where: { storeId } })).toBe(before);

    const again = await agent
      .delete(`/api/finance/bank-statements/${importId}`)
      .set('x-workspace-id', storeId);
    expect(again.status).toBe(404);
  });
});
