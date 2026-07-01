import { prisma } from './src/lib/prisma';

async function main() {
  const storeId = 'cmqpl80yo0002xqvkdd3bdh8d';
  
  console.log('Limpando sistema para loja', storeId);
  await prisma.saleItem.deleteMany({ where: { sale: { storeId } } });
  await prisma.accountReceivable.deleteMany({ where: { storeId } });
  await prisma.sale.deleteMany({ where: { storeId } });
  await prisma.financialTransaction.deleteMany({ where: { wallet: { storeId } } });
  await prisma.product.deleteMany({ where: { storeId } });
  await prisma.category.deleteMany({ where: { storeId } });
  await prisma.customer.deleteMany({ where: { storeId } });
  
  console.log('Sistema zerado com sucesso!');
}
main().catch(console.error).finally(() => prisma.$disconnect());
