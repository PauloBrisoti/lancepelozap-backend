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
  const stores = await prisma.store.findMany({ select: { id: true, nomeFantasia: true } });
  console.log("Stores:", JSON.stringify(stores, null, 2));

  // Insert test credit cards for "Empresa Exemplo"
  const storeId = "cmqubm8l7000avbl2lhvb8v0q";
  const existing = await prisma.creditCard.findMany({ where: { storeId } });
  console.log("Existing cards for store:", JSON.stringify(existing));

  if (existing.length === 0) {
    const card1 = await prisma.creditCard.create({
      data: {
        storeId,
        nome: "Cartão Teste Mastercard",
        bandeira: "Mastercard",
        limiteTotal: 10000,
        diaFechamento: 15,
        diaVencimento: 22,
        ativo: true,
      }
    });
    console.log("Created card1:", JSON.stringify(card1));

    const card2 = await prisma.creditCard.create({
      data: {
        storeId,
        nome: "Cartão Teste Visa",
        bandeira: "Visa",
        limiteTotal: 5000,
        diaFechamento: 5,
        diaVencimento: 12,
        ativo: true,
      }
    });
    console.log("Created card2:", JSON.stringify(card2));
  }

  const final = await prisma.creditCard.findMany({ where: { storeId } });
  console.log("Final cards:", JSON.stringify(final));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
