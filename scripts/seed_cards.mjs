import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  console.error('ERRO: DATABASE_URL não configurada. Execute com DATABASE_URL=... node scripts/seed_cards.mjs');
  process.exit(1);
}

const prisma = new PrismaClient();
async function main() {
  const stores = await prisma.store.findMany({ select: { id: true, nomeFantasia: true } });
  console.log("Stores:", JSON.stringify(stores, null, 2));
  
  // Insert a test credit card for the "Empresa Exemplo" store
  const storeId = "cmqubm8l7000avbl2lhvb8v0q";  // Empresa Exemplo
  const existing = await prisma.creditCard.findMany();
  console.log("Existing cards:", JSON.stringify(existing));
  
  if (existing.length === 0) {
    const card = await prisma.creditCard.create({
      data: {
        storeId: storeId,
        nome: "Cartão Teste Mastercard",
        bandeira: "Mastercard",
        limiteTotal: 10000,
        diaFechamento: 15,
        diaVencimento: 22,
        ativo: true,
      }
    });
    console.log("Created card:", JSON.stringify(card));
    
    const card2 = await prisma.creditCard.create({
      data: {
        storeId: storeId,
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
  
  const final = await prisma.creditCard.findMany();
  console.log("Final cards:", JSON.stringify(final));
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
