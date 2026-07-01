import { prisma } from './lib/prisma';

async function main() {
  // Encontra o role SUPORTE
  const role = await prisma.internalRole.findFirst({
    where: { name: 'SUPORTE' }
  });
  
  console.log("Role ID:", role?.id);
  
  if (!role) return;

  const permissions = [
    { module: 'CLIENTES', accessLevel: 'FULL' }
  ];

  for (const p of permissions) {
    try {
      await prisma.internalRolePermission.upsert({
        where: { roleId_module: { roleId: role.id, module: p.module } },
        update: { accessLevel: p.accessLevel },
        create: { roleId: role.id, module: p.module, accessLevel: p.accessLevel }
      });
      console.log("Upserted", p.module);
    } catch (err) {
      console.error("Upsert erro:", (err as Error).message);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
