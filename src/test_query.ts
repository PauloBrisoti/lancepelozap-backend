import { prisma } from './lib/prisma';

async function run() {
  const storeId = "cmqpl80yo0002xqvkdd3bdh8d";
  const storeExists = await prisma.store.findUnique({ where: { id: storeId } });
  console.log("storeExists:", storeExists);
}
run().catch(console.error);
