import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';

export async function createClientWithStore(options?: { visaoConsolidada?: boolean }) {
  const hash = await bcrypt.hash('123456', 10);
  
  const userEmail = `userclient_${Date.now()}@lpzteste.app`;

  const user = await prisma.user.create({
    data: {
      nome: 'User Client',
      email: userEmail,
      senhaHash: hash,
      role: 'CLIENT_OWNER'
    }
  });

  const client = await prisma.client.create({
    data: {
      nomeCompleto: 'Client Test Full',
      email: `client_${Date.now()}@lpzteste.app`,
      cnpjCpf: `12${Math.floor(Math.random() * 1000000000)}`.slice(0, 11),
      telefoneWhatsapp: '11999999999',
      allowConsolidatedView: options?.visaoConsolidada ?? false,
      clientUsers: {
        create: {
          userId: user.id,
          role: 'OWNER'
        }
      },
      controls: {
        create: {
          nome: 'Controle Principal',
          tipo: 'MATRIZ',
          stores: {
            create: {
              nomeFantasia: 'Loja Teste',
              status: 'ATIVO',
              storeUsers: {
                create: {
                  userId: user.id,
                  role: 'MANAGER'
                }
              }
            }
          }
        }
      }
    },
    include: {
      clientUsers: { include: { user: true } },
      controls: {
        include: {
          stores: true
        }
      }
    }
  });

  return {
    client,
    user: client.clientUsers[0].user,
    control: client.controls[0],
    store: client.controls[0].stores[0]
  };
}

export async function createSuperAdmin() {
  const hash = await bcrypt.hash('123456', 10);
  const user = await prisma.user.create({
    data: {
      nome: 'Admin Test',
      email: `admin_${Date.now()}@lpzteste.app`,
      senhaHash: hash,
      role: 'SUPER_ADMIN'
    }
  });
  return user;
}
