import { prisma } from './src/lib/prisma';

async function run() {
  const p = await prisma.product.findMany({
    take: 5,
    orderBy: { id: 'desc' }
  });
  console.log("Recent products:", p.map(x => ({ nome: x.nome, p: Number(x.precoVendaSugerido), created: x.id })));
}
run().finally(() => prisma.$disconnect());
