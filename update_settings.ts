import fs from 'fs';

const filePath = '/Users/paulobarbosa/Projetos/backend/src/controllers/SettingsController.ts';
let code = fs.readFileSync(filePath, 'utf8');

code = code.replace(/async getUsers\(req: Request, res: Response\) \{[\s\S]*?async createUser/g, `async getUsers(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ error: 'Não autorizado' });

      const accesses = await prisma.storeUserAccess.findMany({
        where: { storeId },
        include: {
          user: {
            select: {
              id: true,
              nome: true,
              email: true,
              ativo: true,
              createdAt: true,
              role: true
            }
          }
        }
      });

      const users = accesses.map(acc => ({
        id: acc.user.id,
        nome: acc.user.nome,
        email: acc.user.email,
        role: acc.role,
        ativo: acc.user.ativo,
        permiteVendaPrazo: acc.permiteVendaPrazo,
        limiteDescontoMaximo: acc.limiteDescontoMaximo,
        createdAt: acc.user.createdAt
      })).sort((a, b) => a.nome.localeCompare(b.nome));

      return res.json(users);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao buscar funcionários' });
    }
  }

  async createUser`);

code = code.replace(/const newUser = await prisma\.user\.create\(\{[\s\S]*?\}\);/g, `const newUser = await prisma.user.create({
        data: {
          nome,
          email,
          senhaHash,
          role: 'USER',
          storeAccess: {
            create: {
              storeId,
              role,
              permiteVendaPrazo: permiteVendaPrazo ?? false,
              limiteDescontoMaximo: limiteDescontoMaximo ?? 0
            }
          }
        },
        include: {
          storeAccess: true
        }
      });`);

code = code.replace(/const existingUser = await prisma\.user\.findFirst\(\{[\s\S]*?\}\);[\s\S]*?if \(!existingUser\) \{/g, `const existingUser = await prisma.storeUserAccess.findUnique({
        where: { storeId_userId: { storeId, userId: id } },
        include: { user: true }
      });

      if (!existingUser) {`);

code = code.replace(/if \(existingUser\.role === 'SUPER_ADMIN'/g, `if (existingUser.user.role === 'SUPER_ADMIN'`);

code = code.replace(/const updatedUser = await prisma\.user\.update\(\{[\s\S]*?\}\);/g, `const updatedUser = await prisma.user.update({
        where: { id },
        data: {
          nome: updateData.nome,
          email: updateData.email,
          ativo: updateData.ativo,
          senhaHash: updateData.senhaHash,
          storeAccess: {
            update: {
              where: { storeId_userId: { storeId, userId: id } },
              data: {
                role: updateData.role,
                permiteVendaPrazo: updateData.permiteVendaPrazo,
                limiteDescontoMaximo: updateData.limiteDescontoMaximo
              }
            }
          }
        },
        include: {
          storeAccess: true
        }
      });`);

fs.writeFileSync(filePath, code);
