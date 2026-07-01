import { prisma } from './lib/prisma';

async function run() {
  const storeId = "cmqpl80yo0002xqvkdd3bdh8d";
  
  const storeExists = await prisma.store.findUnique({ where: { id: storeId } });
  console.log("Store:", storeExists);
  
  if (storeExists) {
    console.log("Creating category...");
    try {
      const cat = await prisma.category.create({
        data: {
          storeId,
          nome: 'Geral_Test_' + Date.now(),
          corHexadecimal: '#cccccc'
        }
      });
      console.log("Created category:", cat);
    } catch (err) {
      console.error("Error creating category:", err);
    }
  }
}
run().catch(console.error);
