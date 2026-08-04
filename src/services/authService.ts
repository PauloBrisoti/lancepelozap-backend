import { User } from "@prisma/client";
import { comparePassword } from "../utils/password";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

export async function validateUser(
  email: string,
  passwordPlain: string
): Promise<{ user: any; token: string }> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      clientAccess: true,
      storeAccess: true
    }
  });

  if (!user) {
    throw Object.assign(new Error("Credenciais inválidas"), { status: 401 });
  }

  const isValid = await comparePassword(passwordPlain, user.senhaHash);
  if (!isValid) {
    throw Object.assign(new Error("Credenciais inválidas"), { status: 401 });
  }

  // Registrar último acesso (fuso UTC no banco; exibição converte para America/Sao_Paulo)
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() }
  }).catch(() => {});

  // Verificar se a conta do cliente está ativa
  const clientAccess = user.clientAccess?.[0];
  if (clientAccess) {
    const client = await prisma.client.findUnique({ where: { id: clientAccess.clientId } });
    if (client && client.status === 'PENDENTE') {
      throw Object.assign(new Error("Sua conta ainda não foi aprovada. Aguarde o administrador."), { status: 403 });
    }
    if (client && client.deletedAt) {
      throw Object.assign(new Error("Sua conta foi arquivada. Contate o suporte."), { status: 403 });
    }
  }

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    throw Object.assign(new Error("JWT_SECRET não configurado"), { status: 500 });
  }

  const storeAccesses = user.storeAccess || [];
  const allowedStoreIds = storeAccesses.map((acc: any) => acc.storeId);
  const storeId = allowedStoreIds.length > 0 ? allowedStoreIds[0] : null;

  const clientId = user.clientAccess?.[0]?.clientId || null;

  const token = jwt.sign(
    { 
      id: user.id, 
      storeId, // Default first store
      allowedStoreIds, // Array of allowed stores for Context Switch
      clientId,
      role: user.role,
      internalRoleId: user.internalRoleId
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  // Anexar as lojas disponíveis no objeto de usuário para o frontend
  const availableStores = await prisma.store.findMany({
    where: { id: { in: allowedStoreIds } },
    select: { id: true, nomeFantasia: true, control: { select: { id: true, nome: true, tipo: true } } }
  });

  const userWithStores = {
    ...user,
    availableStores
  };

  return { user: userWithStores, token };
}
