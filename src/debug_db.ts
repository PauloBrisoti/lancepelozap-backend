import { prisma } from './lib/prisma';

async function run() {
  const users = await prisma.user.findMany({
    include: {
      storeAccess: true
    }
  });
  console.log("Users:", JSON.stringify(users, null, 2));
  
  const stores = await prisma.store.findMany();
  console.log("Stores:", JSON.stringify(stores, null, 2));
}

run().catch(console.error);
