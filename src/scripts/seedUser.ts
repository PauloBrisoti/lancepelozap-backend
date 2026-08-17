import { hashPassword } from "../utils/password";
import { prisma } from "../lib/prisma";

async function main() {
  const email = "admin@example.com";
  const passwordPlain = "123456";

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    console.log(`Usuário ${email} já existe. Ignorando.`);
    return;
  }

  // Primeiro garantimos que existe um Tenant
  let client = await prisma.client.findFirst();
  if (!client) {
    client = await prisma.client.create({
      data: {
        nomeCompleto: "Empresa Teste",
        email: "admin@example.com",
      }
    });
  }

  let control = await prisma.control.findFirst();
  if (!control) {
    control = await prisma.control.create({
      data: {
        clientId: client.id,
        nome: "Varejo Teste",
        tipo: "PJ"
      }
    });
  }

  let tenant = await prisma.store.findFirst();
  if (!tenant) {
    tenant = await prisma.store.create({
      data: {
        controlId: control.id,
        nomeFantasia: "Empresa Teste",
        cnpjCpf: "00000000000100"
      }
    });
    console.log(`Tenant criado: ${tenant.id}`);
  }

  const passwordHash = await hashPassword(passwordPlain);
  await prisma.user.create({
    data: {
      nome: "Admin",
      email,
      senhaHash: passwordHash,
      role: "ADMIN",
      storeAccess: {
        create: {
          storeId: tenant.id,
          role: "GERENTE"
        }
      }
    }
  });

  console.log(`Usuário criado com sucesso!
Email: ${email}
Senha: ${passwordPlain}
Tenant: ${tenant.nomeFantasia}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
