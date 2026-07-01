import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import app from '../app';
import { prisma } from '../lib/prisma';
import { createClientWithStore } from './factory';

async function createMinimaxlsx(): Promise<string> {
  const workbook = new ExcelJS.Workbook();

  const wsProdutos = workbook.addWorksheet('PRODUTOS');
  wsProdutos.columns = [
    { header: 'Nome', key: 'nome' },
    { header: 'Categoria', key: 'categoria' },
    { header: 'Preço de Custo', key: 'custo' },
    { header: 'Preço de Venda', key: 'venda' },
    { header: 'Estoque', key: 'estoque' },
  ];
  wsProdutos.addRows([
    ['Coca-Cola 2L', 'Bebidas', '5.50', '9.00', '100'],
    ['Pão Francês', 'Padaria', '0.35', '1.00', '500'],
  ]);

  const wsClientes = workbook.addWorksheet('CLIENTES');
  wsClientes.columns = [
    { header: 'Nome', key: 'nome' },
    { header: 'CPF', key: 'cpf' },
    { header: 'Telefone', key: 'telefone' },
  ];
  wsClientes.addRows([
    ['João Cliente', '529.982.247-25', '11911111111'],
  ]);

  const filePath = path.join(process.cwd(), 'uploads', `test-import-${Date.now()}.xlsx`);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

describe('Planilha Import (integração)', () => {
  let clientA: any;
  const agent = request.agent(app);
  let tmpFile: string;

  beforeAll(async () => {
    clientA = await createClientWithStore();

    await agent
      .post('/api/auth/login')
      .send({ email: clientA.user.email, password: '123456' });

    // Set the store context header so requireAuth selects the right store
    agent.set('x-store-id', clientA.store.id);

    tmpFile = await createMinimaxlsx();
  });

  afterAll(async () => {
    if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    await prisma.storeUserAccess.deleteMany({ where: { storeId: clientA.store.id } });
    await prisma.store.delete({ where: { id: clientA.store.id } }).catch(() => {});
    await prisma.control.delete({ where: { id: clientA.control.id } }).catch(() => {});
    await prisma.clientUser.deleteMany({ where: { clientId: clientA.client.id } }).catch(() => {});
    await prisma.client.delete({ where: { id: clientA.client.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: clientA.user.id } }).catch(() => {});
  });

  it('POST /api/planilha/preview — processa arquivo e retorna preview', async () => {
    const res = await agent
      .post('/api/planilha/preview')
      .attach('file', tmpFile);
    expect(res.status).toBe(200);
    expect(res.body.data.preview).toBeDefined();
    const sheets = res.body.data.preview;
    expect(sheets.length).toBeGreaterThanOrEqual(1);
    const produtosSheet = sheets.find((s: any) => s.detectedType === 'PRODUTOS');
    expect(produtosSheet).toBeDefined();
    expect(produtosSheet.rowCount).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/planilha/import — importa dados da planilha', async () => {
    const res = await agent
      .post('/api/planilha/import')
      .attach('file', tmpFile);
    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBeDefined();
    expect(res.body.data.imported.produtos).toBeGreaterThanOrEqual(1);
    expect(res.body.data.imported.clientes).toBeGreaterThanOrEqual(1);
  });

  it('produtos foram salvos no banco', async () => {
    const products = await prisma.product.findMany({ where: { storeId: clientA.store.id } });
    expect(products.length).toBeGreaterThanOrEqual(2);
    expect(products.some(p => p.nome === 'Coca-Cola 2L')).toBe(true);
    expect(products.some(p => p.nome === 'Pão Francês')).toBe(true);
  });

  it('clientes foram salvos no banco', async () => {
    const customers = await prisma.customer.findMany({ where: { storeId: clientA.store.id } });
    expect(customers.length).toBeGreaterThanOrEqual(1);
    expect(customers.some(c => c.nomeCompleto === 'João Cliente')).toBe(true);
  });

  it('POST /api/planilha/preview — rejeita sem arquivo', async () => {
    const res = await agent.post('/api/planilha/preview');
    expect(res.status).toBe(400);
  });
});
