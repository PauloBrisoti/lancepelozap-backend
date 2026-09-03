import dotenv from 'dotenv';
dotenv.config();
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const ORIGEM = 'cmqvdlgnv00028gl24va1b9eq'; // Velour
const DESTINO = 'cmtbqqtly0009v9yc60znnh4e'; // Loja Teste

async function main() {
  console.log(`Clonando dados de Velour → Teste...\n`);

  // ── 1. Limpar dados existentes da loja destino ──
  console.log('1. Limpando dados existentes da loja Teste...');
  await prisma.$transaction(async (tx) => {
    await tx.financialTransaction.deleteMany({ where: { storeId: DESTINO } });
    await tx.accountReceivable.deleteMany({ where: { storeId: DESTINO } });
    await (tx as any).accountPayable.deleteMany({ where: { storeId: DESTINO } });
    await tx.sale.deleteMany({ where: { storeId: DESTINO } });
    await tx.customer.deleteMany({ where: { storeId: DESTINO } });
    await tx.stockMovement.deleteMany({ where: { storeId: DESTINO } });
    await tx.product.deleteMany({ where: { storeId: DESTINO } });
    await tx.category.deleteMany({ where: { storeId: DESTINO } });
  });
  console.log('   Dados limpos.\n');

  // ── 2. Copiar categorias ──
  console.log('2. Copiando categorias...');
  const categoriasOrigem = await prisma.category.findMany({
    where: { storeId: ORIGEM },
  });

  const catIdMap = new Map<string, string>(); // id original → novo id

  for (const cat of categoriasOrigem) {
    const novoId = randomUUID();
    catIdMap.set(cat.id, novoId);
    await prisma.category.create({
      data: {
        id: novoId,
        storeId: DESTINO,
        nome: cat.nome,
        corHexadecimal: cat.corHexadecimal,
        margemLucroPadrao: cat.margemLucroPadrao,
        aliquotaImposto: cat.aliquotaImposto,
      },
    });
  }
  console.log(`   ${categoriasOrigem.length} categorias copiadas.\n`);

  // ── 3. Copiar produtos (estoque zerado) ──
  console.log('3. Copiando produtos (estoque = 0)...');
  const produtosOrigem = await prisma.product.findMany({
    where: { storeId: ORIGEM },
  });

  let produtosCopiados = 0;
  for (const prod of produtosOrigem) {
    const novaCatId = catIdMap.get(prod.categoryId);
    if (!novaCatId) {
      console.log(`   AVISO: categoria ${prod.categoryId} não mapeada para "${prod.nome}", pulando.`);
      continue;
    }

    await prisma.product.create({
      data: {
        id: randomUUID(),
        storeId: DESTINO,
        categoryId: novaCatId,
        codigoBarrasEan: prod.codigoBarrasEan,
        codigoVisual: prod.codigoVisual,
        nome: prod.nome,
        descricaoVariante: prod.descricaoVariante,
        ncm: prod.ncm,
        unidade: prod.unidade,
        pesoBruto: prod.pesoBruto,
        pesoLiquido: prod.pesoLiquido,
        precoCusto: prod.precoCusto,
        precoVendaSugerido: prod.precoVendaSugerido,
        impostoEstimadoPercentual: prod.impostoEstimadoPercentual,
        qtdEstoqueAtual: 0,
        estoqueMinimo: prod.estoqueMinimo,
        imageUrl: prod.imageUrl,
        status: prod.status,
        brandId: null,
      },
    });
    produtosCopiados++;
  }
  console.log(`   ${produtosCopiados} produtos copiados (estoque zerado).\n`);

  // ── 4. Copiar clientes ──
  console.log('4. Copiando clientes...');
  const clientesOrigem = await prisma.customer.findMany({
    where: { storeId: ORIGEM },
  });

  for (const cli of clientesOrigem) {
    await prisma.customer.create({
      data: {
        id: randomUUID(),
        storeId: DESTINO,
        nomeCompleto: cli.nomeCompleto,
        cpf: cli.cpf,
        telefoneWhatsapp: cli.telefoneWhatsapp,
        cep: cli.cep,
        enderecoCompleto: cli.enderecoCompleto,
        email: cli.email,
        rg: cli.rg,
        dataNascimento: cli.dataNascimento,
        observacoes: cli.observacoes,
        aceitaMarketing: cli.aceitaMarketing,
        aceitaLembreteCobranca: cli.aceitaLembreteCobranca,
      },
    });
  }
  console.log(`   ${clientesOrigem.length} clientes copiados.\n`);

  // ── Resumo ──
  console.log('═══════════════════════════════════════');
  console.log('  CLONAGEM CONCLUÍDA');
  console.log('═══════════════════════════════════════');
  console.log(`  Categorias:  ${categoriasOrigem.length}`);
  console.log(`  Produtos:    ${produtosCopiados} (estoque zerado)`);
  console.log(`  Clientes:    ${clientesOrigem.length}`);
  console.log('═══════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('Erro:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
