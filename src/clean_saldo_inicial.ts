import { prisma } from './lib/prisma';

async function clean() {
  const products = await prisma.product.findMany({
    where: { nome: 'Saldo Inicial' }
  });

  console.log(`Found ${products.length} bogus products to delete.`);

  for (const p of products) {
    try {
      await prisma.product.delete({ where: { id: p.id } });
      console.log(`Deleted ${p.id}`);
    } catch (e: any) {
      console.error(`Error deleting ${p.id}:`, e.message);
    }
  }
}

clean().finally(() => prisma.$disconnect());
