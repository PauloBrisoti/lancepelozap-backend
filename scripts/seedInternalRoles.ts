import { prisma } from "../lib/prisma";

const modules = [
  "CLIENTES",
  "PLANOS_E_MODULOS",
  "ACESSO_E_LIBERACOES",
  "FINANCEIRO",
  "CHAMADOS",
  "AUDITORIA",
  "CONFIGURACOES"
];

async function main() {
  console.log("Semeando papéis internos...");

  // 1. Criar ou atualizar papel SUPER_ADMIN nativo
  let superAdminRole = await prisma.internalRole.findUnique({
    where: { name: "SUPER_ADMIN" }
  });

  if (!superAdminRole) {
    superAdminRole = await prisma.internalRole.create({
      data: {
        name: "SUPER_ADMIN",
        description: "Acesso total e irrestrito ao painel",
        isSystem: true,
      }
    });
    console.log("Papel SUPER_ADMIN criado.");
  } else {
    console.log("Papel SUPER_ADMIN já existe.");
  }

  // Permissões do Super Admin (FULL em todos)
  for (const mod of modules) {
    await prisma.internalRolePermission.upsert({
      where: {
        roleId_module: {
          roleId: superAdminRole.id,
          module: mod
        }
      },
      update: { accessLevel: "FULL" },
      create: {
        roleId: superAdminRole.id,
        module: mod,
        accessLevel: "FULL"
      }
    });
  }

  // 2. Vincular o usuário super admin atual ao papel SUPER_ADMIN (caso exista e não esteja vinculado)
  const existingSuperUser = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" }
  });

  if (existingSuperUser && !existingSuperUser.internalRoleId) {
    await prisma.user.update({
      where: { id: existingSuperUser.id },
      data: { internalRoleId: superAdminRole.id }
    });
    console.log(`Usuário ${existingSuperUser.email} vinculado ao InternalRole SUPER_ADMIN.`);
  }

  console.log("Semeio de papéis internos concluído.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
