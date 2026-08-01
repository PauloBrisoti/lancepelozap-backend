import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL não configurada. Defina a variável de ambiente.');
  process.exit(1);
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Insert test credit cards for all stores that don't have any
  const stores = await prisma.store.findMany({ select: { id: true, nomeFantasia: true } });
  
  for (const store of stores) {
    const existing = await prisma.creditCard.findMany({ where: { storeId: store.id } });
    if (existing.length === 0) {
      console.log(`Inserting cards for "${store.nomeFantasia.trim()}"...`);
      await prisma.creditCard.create({
        data: {
          storeId: store.id,
          nome: "Mastercard Teste",
          bandeira: "Mastercard",
          limiteTotal: 10000,
          diaFechamento: 15,
          diaVencimento: 22,
          ativo: true,
        }
      });
      await prisma.creditCard.create({
        data: {
          storeId: store.id,
          nome: "Visa Teste",
          bandeira: "Visa",
          limiteTotal: 5000,
          diaFechamento: 5,
          diaVencimento: 12,
          ativo: true,
        }
      });
      console.log(`  -> Done`);
    } else {
      console.log(`"${store.nomeFantasia.trim()}" already has ${existing.length} card(s). Skipping.`);
    }
  }
  console.log("All stores seeded.");
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
