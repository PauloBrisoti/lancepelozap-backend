import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../src/utils/password';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL não configurada.');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding database...');

  // Clean existing data (cascade)
  await prisma.$transaction([
    prisma.stockMovement.deleteMany(),
    prisma.financialTransaction.deleteMany(),
    prisma.accountReceivable.deleteMany(),
    prisma.saleItem.deleteMany(),
    prisma.sale.deleteMany(),
    prisma.productEntryItem.deleteMany(),
    prisma.productEntry.deleteMany(),
    prisma.paymentMethodFee.deleteMany(),
    prisma.commissionRule.deleteMany(),
    prisma.product.deleteMany(),
    prisma.category.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.wallet.deleteMany(),
    prisma.storeUserAccess.deleteMany(),
    prisma.store.deleteMany(),
    prisma.control.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.subscription.deleteMany(),
    prisma.clientUser.deleteMany(),
    prisma.client.deleteMany(),
    prisma.user.deleteMany(),
    prisma.plan.deleteMany(),
  ]);

  // 1. Plan
  const plan = await prisma.plan.create({
    data: {
      nome: 'Plano Profissional',
      precoMensal: 97.00,
      maxControls: 2,
      maxStores: 5,
    },
  });
  console.log(`  ✅ Plan: ${plan.nome}`);

  // 2. Users
  const adminPassword = await hashPassword('admin123');
  const vendedorPassword = await hashPassword('vendedor123');
  const superPassword = await hashPassword('super123');

  const superAdminUser = await prisma.user.create({
    data: {
      nome: 'Super Admin',
      email: 'super@lancepelozap.com.br',
      senhaHash: superPassword,
      role: 'SUPER_ADMIN',
    },
  });

  const adminUser = await prisma.user.create({
    data: {
      nome: 'Paulo Admin',
      email: 'admin@teste.com',
      senhaHash: adminPassword,
      role: 'USER',
    },
  });

  const vendedorUser = await prisma.user.create({
    data: {
      nome: 'Carlos Vendedor',
      email: 'vendedor@teste.com',
      senhaHash: vendedorPassword,
      role: 'USER',
    },
  });

  const caixaUser = await prisma.user.create({
    data: {
      nome: 'Marina Caixa',
      email: 'caixa@teste.com',
      senhaHash: vendedorPassword,
      role: 'USER',
    },
  });

  console.log('  ✅ Users created');

  // 3. Client
  const client = await prisma.client.create({
    data: {
      nomeCompleto: 'Empresa Exemplo Ltda',
      cnpjCpf: '12.345.678/0001-90',
      email: 'admin@teste.com',
      telefoneWhatsapp: '11999999999',
      status: 'ATIVO',
      cep: '01001-000',
      logradouro: 'Rua Exemplo',
      numero: '100',
      bairro: 'Centro',
      cidade: 'São Paulo',
      uf: 'SP',
      aceiteTermosData: new Date(),
    },
  });

  // 4. ClientUser
  await prisma.clientUser.create({
    data: {
      clientId: client.id,
      userId: adminUser.id,
      role: 'OWNER',
    },
  });

  // 5. Subscription + Invoice
  const subscription = await prisma.subscription.create({
    data: {
      clientId: client.id,
      planId: plan.id,
      valorMensalidade: 97.00,
      dataVencimento: new Date('2026-07-01'),
      statusPagamento: 'PAGO',
      bloqueioAutomaticoAtivo: true,
    },
  });

  await prisma.invoice.create({
    data: {
      subscriptionId: subscription.id,
      mesReferencia: '2026-06',
      valorCobrado: 97.00,
      status: 'PAGO',
      dataPagamento: new Date(),
    },
  });

  // 6. Control (PF)
  const control = await prisma.control.create({
    data: {
      clientId: client.id,
      nome: 'Controle Principal PF',
      tipo: 'PF',
      status: 'ATIVO',
    },
  });

  // 7. Store
  const store = await prisma.store.create({
    data: {
      controlId: control.id,
      nomeFantasia: 'Empresa Exemplo',
      cnpjCpf: '12.345.678/0001-90',
      nichoPrincipal: 'Alimentício',
      tipoWorkspace: 'PJ',
      emailContato: 'admin@teste.com',
      telefoneWhatsapp: '11999999999',
      chavePix: 'admin@teste.com',
    },
  });

  // 8. StoreUserAccess
  await prisma.storeUserAccess.createMany({
    data: [
      {
        storeId: store.id,
        userId: adminUser.id,
        role: 'ADMIN_LOJA',
        permiteVendaPrazo: true,
        limiteDescontoMaximo: 50,
      },
      {
        storeId: store.id,
        userId: vendedorUser.id,
        role: 'VENDEDOR',
        permiteVendaPrazo: true,
        limiteDescontoMaximo: 10,
      },
      {
        storeId: store.id,
        userId: caixaUser.id,
        role: 'CAIXA',
        permiteVendaPrazo: false,
        limiteDescontoMaximo: 5,
      },
    ],
  });

  // 9. PaymentMethodFees
  await prisma.paymentMethodFee.createMany({
    data: [
      { storeId: store.id, formaPagamento: 'PIX', parcelas: 1, taxaPercentual: 0, taxaFixa: 0, prazoRecebimento: 0 },
      { storeId: store.id, formaPagamento: 'DINHEIRO', parcelas: 1, taxaPercentual: 0, taxaFixa: 0, prazoRecebimento: 0 },
      { storeId: store.id, formaPagamento: 'CARTAO_DEBITO', parcelas: 1, taxaPercentual: 2.49, taxaFixa: 0.50, prazoRecebimento: 2 },
      { storeId: store.id, formaPagamento: 'CARTAO_CREDITO', parcelas: 1, taxaPercentual: 3.99, taxaFixa: 0.50, prazoRecebimento: 30 },
      { storeId: store.id, formaPagamento: 'CARTAO_CREDITO', parcelas: 2, taxaPercentual: 5.49, taxaFixa: 0.50, prazoRecebimento: 30 },
      { storeId: store.id, formaPagamento: 'CARTAO_CREDITO', parcelas: 3, taxaPercentual: 6.99, taxaFixa: 0.50, prazoRecebimento: 30 },
    ],
  });

  // 10. Categories
  const catBebidas = await prisma.category.create({
    data: { storeId: store.id, nome: 'Bebidas', corHexadecimal: '#3B82F6', margemLucroPadrao: 50 },
  });
  const catLanches = await prisma.category.create({
    data: { storeId: store.id, nome: 'Lanches', corHexadecimal: '#F59E0B', margemLucroPadrao: 40 },
  });
  const catPadaria = await prisma.category.create({
    data: { storeId: store.id, nome: 'Padaria', corHexadecimal: '#EF4444', margemLucroPadrao: 60 },
  });

  // 11. Products
  const products = await Promise.all([
    prisma.product.create({
      data: { storeId: store.id, categoryId: catBebidas.id, nome: 'Coca-Cola 2L', codigoBarrasEan: '7894900010017', codigoVisual: 'COCA2L', precoCusto: 5.50, precoVendaSugerido: 9.00, qtdEstoqueAtual: 100 },
    }),
    prisma.product.create({
      data: { storeId: store.id, categoryId: catBebidas.id, nome: 'Guaraná Antarctica 2L', codigoBarrasEan: '7894900060012', codigoVisual: 'GUA2L', precoCusto: 4.80, precoVendaSugerido: 8.00, qtdEstoqueAtual: 80 },
    }),
    prisma.product.create({
      data: { storeId: store.id, categoryId: catBebidas.id, nome: 'Água Mineral 500ml', codigoBarrasEan: '7896045523834', codigoVisual: 'AGUA500', precoCusto: 1.20, precoVendaSugerido: 3.00, qtdEstoqueAtual: 200 },
    }),
    prisma.product.create({
      data: { storeId: store.id, categoryId: catLanches.id, nome: 'X-Burguer', codigoVisual: 'XBURG', precoCusto: 6.00, precoVendaSugerido: 15.00, qtdEstoqueAtual: 30 },
    }),
    prisma.product.create({
      data: { storeId: store.id, categoryId: catLanches.id, nome: 'X-Salada', codigoVisual: 'XSAL', precoCusto: 7.00, precoVendaSugerido: 18.00, qtdEstoqueAtual: 25 },
    }),
    prisma.product.create({
      data: { storeId: store.id, categoryId: catLanches.id, nome: 'X-Bacon', codigoVisual: 'XBACON', precoCusto: 8.50, precoVendaSugerido: 22.00, qtdEstoqueAtual: 20 },
    }),
    prisma.product.create({
      data: { storeId: store.id, categoryId: catLanches.id, nome: 'Batata Frita Média', codigoVisual: 'BATMED', precoCusto: 3.50, precoVendaSugerido: 12.00, qtdEstoqueAtual: 40 },
    }),
    prisma.product.create({
      data: { storeId: store.id, categoryId: catPadaria.id, nome: 'Pão Francês (un)', codigoVisual: 'PAOFRAN', precoCusto: 0.35, precoVendaSugerido: 1.00, qtdEstoqueAtual: 500 },
    }),
    prisma.product.create({
      data: { storeId: store.id, categoryId: catPadaria.id, nome: 'Pão de Queijo (un)', codigoVisual: 'PAOQJO', precoCusto: 0.80, precoVendaSugerido: 2.50, qtdEstoqueAtual: 100 },
    }),
    prisma.product.create({
      data: { storeId: store.id, categoryId: catPadaria.id, nome: 'Sonho de Creme', codigoVisual: 'SONHO', precoCusto: 2.00, precoVendaSugerido: 6.00, qtdEstoqueAtual: 15 },
    }),
  ]);

  console.log(`  ✅ ${products.length} products created`);

  // 12. Customers
  const customers = await Promise.all([
    prisma.customer.create({ data: { storeId: store.id, nomeCompleto: 'João Silva', cpf: '529.982.247-25', telefoneWhatsapp: '11911111111' } }),
    prisma.customer.create({ data: { storeId: store.id, nomeCompleto: 'Maria Souza', cpf: '123.456.789-09', telefoneWhatsapp: '11922222222' } }),
    prisma.customer.create({ data: { storeId: store.id, nomeCompleto: 'Pedro Alves', telefoneWhatsapp: '11933333333' } }),
    prisma.customer.create({ data: { storeId: store.id, nomeCompleto: 'Ana Costa', cpf: '987.654.321-00', telefoneWhatsapp: '11944444444' } }),
    prisma.customer.create({ data: { storeId: store.id, nomeCompleto: 'Lucas Oliveira', telefoneWhatsapp: '11955555555' } }),
  ]);

  // 13. Wallets
  const walletCaixa = await prisma.wallet.create({
    data: { storeId: store.id, nome: 'Caixa', tipo: 'CARTEIRA', saldoAtual: 1500.00 },
  });
  const walletBanco = await prisma.wallet.create({
    data: { storeId: store.id, nome: 'Banco', tipo: 'CONTA_CORRENTE', saldoAtual: 5000.00 },
  });

  // 14. Sales
  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);

  // Sale 1: Cash sale - PIX
  const sale1 = await prisma.sale.create({
    data: {
      storeId: store.id,
      userId: vendedorUser.id,
      dataVenda: daysAgo(5),
      valorTotalBruto: 37.00,
      valorDesconto: 2.00,
      valorTotalLiquido: 35.00,
      formaPagamento: 'PIX',
      valorSinal: 0,
      numeroParcelas: 1,
      cmvTotal: 16.30,
      status: 'FINALIZADA',
      saleItems: {
        create: [
          { productId: products[3].id, quantidade: 1, precoUnitarioVendido: 15.00, custoUnitarioHistorico: 6.00 },
          { productId: products[7].id, quantidade: 5, precoUnitarioVendido: 1.00, custoUnitarioHistorico: 0.35 },
          { productId: products[1].id, quantidade: 2, precoUnitarioVendido: 8.00, custoUnitarioHistorico: 4.80 },
        ],
      },
    },
    include: { saleItems: true },
  });
  const cmv1 = 6.00 * 1 + 0.35 * 5 + 4.80 * 2;
  await prisma.sale.update({ where: { id: sale1.id }, data: { cmvTotal: cmv1 } });

  // Sale 2: Fiado/Crediário (2 parcels)
  const sale2 = await prisma.sale.create({
    data: {
      storeId: store.id,
      userId: vendedorUser.id,
      customerId: customers[0].id,
      dataVenda: daysAgo(10),
      valorTotalBruto: 65.00,
      valorDesconto: 0,
      valorTotalLiquido: 65.00,
      formaPagamento: 'CREDIARIO',
      valorSinal: 15.00,
      numeroParcelas: 2,
      cmvTotal: 24.50,
      status: 'FINALIZADA',
      saleItems: {
        create: [
          { productId: products[4].id, quantidade: 2, precoUnitarioVendido: 18.00, custoUnitarioHistorico: 7.00 },
          { productId: products[8].id, quantidade: 6, precoUnitarioVendido: 2.50, custoUnitarioHistorico: 0.80 },
          { productId: products[9].id, quantidade: 1, precoUnitarioVendido: 6.00, custoUnitarioHistorico: 2.00 },
        ],
      },
    },
    include: { saleItems: true },
  });
  const cmv2 = 7.00 * 2 + 0.80 * 6 + 2.00 * 1;
  await prisma.sale.update({ where: { id: sale2.id }, data: { cmvTotal: cmv2 } });

  // Receivables for Sale 2: 2 parcels of R$25 each (after R$15 sinal)
  const remaining2 = 65.00 - 15.00;
  await prisma.accountReceivable.createMany({
    data: [
      {
        storeId: store.id,
        saleId: sale2.id,
        customerId: customers[0].id,
        dataVencimento: daysAgo(0),
        numeroParcela: 1,
        totalParcelas: 2,
        valorParcela: remaining2 / 2,
        formaPagamentoEsperada: 'DINHEIRO',
        status: 'PAGO',
        dataPagamentoEfetivo: daysAgo(0),
      },
      {
        storeId: store.id,
        saleId: sale2.id,
        customerId: customers[0].id,
        dataVencimento: new Date(now.getTime() + 25 * 86400000),
        numeroParcela: 2,
        totalParcelas: 2,
        valorParcela: remaining2 / 2,
        formaPagamentoEsperada: 'DINHEIRO',
        status: 'PENDENTE',
      },
    ],
  });

  // Sale 3: Another fiado (already overdue)
  const sale3 = await prisma.sale.create({
    data: {
      storeId: store.id,
      userId: caixaUser.id,
      customerId: customers[1].id,
      dataVenda: daysAgo(20),
      valorTotalBruto: 28.00,
      valorDesconto: 0,
      valorTotalLiquido: 28.00,
      formaPagamento: 'CREDIARIO',
      valorSinal: 0,
      numeroParcelas: 1,
      cmvTotal: 10.50,
      status: 'FINALIZADA',
      saleItems: {
        create: [
          { productId: products[0].id, quantidade: 2, precoUnitarioVendido: 9.00, custoUnitarioHistorico: 5.50 },
          { productId: products[6].id, quantidade: 1, precoUnitarioVendido: 10.00, custoUnitarioHistorico: 3.50 },
        ],
      },
    },
    include: { saleItems: true },
  });
  const cmv3 = 5.50 * 2 + 3.50 * 1;
  await prisma.sale.update({ where: { id: sale3.id }, data: { cmvTotal: cmv3 } });

  await prisma.accountReceivable.create({
    data: {
      storeId: store.id,
      saleId: sale3.id,
      customerId: customers[1].id,
      dataVencimento: daysAgo(5),
      numeroParcela: 1,
      totalParcelas: 1,
      valorParcela: 28.00,
      formaPagamentoEsperada: 'DINHEIRO',
      status: 'VENCIDO',
    },
  });

  // Sale 4: Card payment with tax
  const sale4 = await prisma.sale.create({
    data: {
      storeId: store.id,
      userId: vendedorUser.id,
      dataVenda: daysAgo(2),
      valorTotalBruto: 45.00,
      valorDesconto: 5.00,
      valorTotalLiquido: 40.00,
      formaPagamento: 'CARTAO_CREDITO',
      valorSinal: 0,
      numeroParcelas: 2,
      valorTaxasGateway: 2.75,
      cmvTotal: 19.50,
      status: 'FINALIZADA',
      saleItems: {
        create: [
          { productId: products[3].id, quantidade: 1, precoUnitarioVendido: 15.00, custoUnitarioHistorico: 6.00 },
          { productId: products[5].id, quantidade: 1, precoUnitarioVendido: 22.00, custoUnitarioHistorico: 8.50 },
          { productId: products[2].id, quantidade: 2, precoUnitarioVendido: 3.00, custoUnitarioHistorico: 1.20 },
          { productId: products[8].id, quantidade: 2, precoUnitarioVendido: 2.50, custoUnitarioHistorico: 0.80 },
        ],
      },
    },
    include: { saleItems: true },
  });
  const cmv4 = 6.00 * 1 + 8.50 * 1 + 1.20 * 2 + 0.80 * 2;
  await prisma.sale.update({ where: { id: sale4.id }, data: { cmvTotal: cmv4 } });

  // Sale 5: Cash - DINHEIRO
  const sale5 = await prisma.sale.create({
    data: {
      storeId: store.id,
      userId: vendedorUser.id,
      dataVenda: daysAgo(1),
      valorTotalBruto: 12.00,
      valorDesconto: 0,
      valorTotalLiquido: 12.00,
      formaPagamento: 'DINHEIRO',
      cmvTotal: 4.50,
      status: 'FINALIZADA',
      saleItems: {
        create: [
          { productId: products[6].id, quantidade: 1, precoUnitarioVendido: 12.00, custoUnitarioHistorico: 3.50 },
        ],
      },
    },
    include: { saleItems: true },
  });
  const cmv5 = 3.50 * 1;
  await prisma.sale.update({ where: { id: sale5.id }, data: { cmvTotal: cmv5 } });

  // 15. CommissionRule
  await prisma.commissionRule.create({
    data: {
      storeId: store.id,
      userId: vendedorUser.id,
      percentual: 3.00,
      ativo: true,
    },
  });

  // 16. Financial Transactions for wallet balances
  await prisma.financialTransaction.createMany({
    data: [
      { storeId: store.id, walletId: walletCaixa.id, tipo: 'ENTRADA', valor: 35.00, descricao: 'Venda #1 - PIX', dataTransacao: daysAgo(5) },
      { storeId: store.id, walletId: walletCaixa.id, tipo: 'ENTRADA', valor: 15.00, descricao: 'Venda #2 - Sinal', dataTransacao: daysAgo(10) },
      { storeId: store.id, walletId: walletCaixa.id, tipo: 'ENTRADA', valor: 12.50, descricao: 'Venda #2 - Parcela 1', dataTransacao: daysAgo(0) },
      { storeId: store.id, walletId: walletBanco.id, tipo: 'ENTRADA', valor: 40.00, descricao: 'Venda #4 - Cartão Crédito', dataTransacao: daysAgo(2) },
      { storeId: store.id, walletId: walletCaixa.id, tipo: 'ENTRADA', valor: 12.00, descricao: 'Venda #5 - Dinheiro', dataTransacao: daysAgo(1) },
    ],
  });

  console.log('  ✅ 5 sales + receivables + transactions created');

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌱 Seed complete!');
  console.log('');
  console.log('📧 Credenciais de teste:');
  console.log('   Super Admin: super@lancepelozap.com.br / super123');
  console.log('   Admin Loja:  admin@teste.com / admin123');
  console.log('   Vendedor:    vendedor@teste.com / vendedor123');
  console.log('   Caixa:       caixa@teste.com / vendedor123');
  console.log('');
  console.log(`🏪 Loja: ${store.nomeFantasia} (${store.id})`);
  console.log(`📦 ${products.length} produtos, ${customers.length} clientes`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
