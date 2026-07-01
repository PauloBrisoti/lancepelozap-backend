const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const storeId = 'cmqr035w30005opvk4i4z4y2i'; // let me get the storeId from DB first
  const sales = await prisma.sale.findMany({
    // where: { storeId }
    select: { storeId: true, id: true, dataVenda: true }
  });
  console.log(sales);
}
main().finally(() => prisma.$disconnect());
