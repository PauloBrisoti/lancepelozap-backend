import { prisma } from './src/lib/prisma';

async function clearDuplicates() {
  console.log('Iniciando limpeza de duplicidades...');
  
  const stores = await prisma.store.findMany();

  let totalDeleted = 0;

  for (const store of stores) {
    const products = await prisma.product.findMany({
      where: { storeId: store.id }
    });

    const productMap = new Map<string, string>();
    const toDelete: string[] = [];

    for (const p of products) {
      const normalizedName = p.nome.trim().toLowerCase();
      if (productMap.has(normalizedName)) {
        // Já existe um produto com este nome, marcar para exclusão
        toDelete.push(p.id);
      } else {
        // Primeiro produto com este nome (como está ordenado por desc, é o mais recente)
        productMap.set(normalizedName, p.id);
      }
    }

    if (toDelete.length > 0) {
      console.log(`Loja ${store.id}: Encontradas ${toDelete.length} duplicidades.`);
      
      // Apagar em lotes
      for (let i = 0; i < toDelete.length; i += 50) {
        const batch = toDelete.slice(i, i + 50);
        await prisma.product.deleteMany({
          where: { id: { in: batch } }
        });
      }
      totalDeleted += toDelete.length;
    }
  }

  console.log(`Limpeza concluída! Total de produtos duplicados removidos: ${totalDeleted}`);
}

clearDuplicates()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
