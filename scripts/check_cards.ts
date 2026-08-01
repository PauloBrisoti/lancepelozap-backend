import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const stores = await prisma.store.findMany({ select: { id: true, nomeFantasia: true } });
  console.log("Stores:", JSON.stringify(stores, null, 2));
  const cards = await prisma.creditCard.findMany();
  console.log("Cards:", JSON.stringify(cards));
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
