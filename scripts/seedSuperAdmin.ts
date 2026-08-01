import { hashPassword } from "../utils/password";
import { prisma } from "../lib/prisma";

async function main() {
  const email = "super@lancepelozap.com.br";
  const passwordPlain = "admin";

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    console.log(`Usuário ${email} já existe. Ignorando.`);
    return;
  }

  const passwordHash = await hashPassword(passwordPlain);
  const user = await prisma.user.create({
    data: {
      nome: "Super Administrador",
      email,
      senhaHash: passwordHash,
      role: "SUPER_ADMIN"
    }
  });

  console.log(`Usuário criado com sucesso!
Email: ${email}
Senha: ${passwordPlain}
Role: SUPER_ADMIN`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
