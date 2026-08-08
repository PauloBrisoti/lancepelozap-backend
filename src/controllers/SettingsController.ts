import { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { asyncHandler } from "../lib/asyncHandler";
import { hashPassword } from '../utils/password';

// SEGURANÇA: papéis permitidos para funcionários criados/editados por loja.
// O cliente NUNCA pode definir papéis globais (SUPER_ADMIN, CLIENT_OWNER, USER)
// nem papéis que não existem no RBAC de loja — só papéis de loja válidos.
const STORE_ROLES_ALLOWED = new Set(['CAIXA', 'VENDEDOR', 'GERENTE', 'MANAGER', 'ADMIN', 'ADMIN_LOJA']);

export class SettingsController {
  
  // ==========================================
  // CONFIGURAÇÕES DA LOJA (TENANT)
  // ==========================================
  
  getTenantSettings = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ error: 'Não autorizado' });

      const tenant = await prisma.store.findUnique({
        where: { id: storeId }
      });

      // SEGURANÇA: nunca expor credenciais de integração (WhatsApp)
      const { whatsappApiKey, ...safeTenant } = tenant as any;
      return res.json(safeTenant);
    
  }, "obter tenant configurações");

  updateTenantSettings = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ error: 'Não autorizado' });
      
      // Apenas ADMIN_LOJA, GERENTE ou SUPER_ADMIN podem editar a loja
      if (req.user?.role !== 'SUPER_ADMIN') {
        const access = await prisma.storeUserAccess.findUnique({
          where: { storeId_userId: { storeId, userId: req.user!.id } }
        });
        if (!access || (access.role !== 'ADMIN_LOJA' && access.role !== 'GERENTE')) {
          return res.status(403).json({ error: 'Acesso negado' });
        }
      }

      const { nomeFantasia, nichoPrincipal, telefoneWhatsapp, emailContato, chavePix, aliquotaImposto } = req.body;

      const updatedTenant = await prisma.store.update({
        where: { id: storeId },
        data: {
          nomeFantasia,
          nichoPrincipal,
          telefoneWhatsapp,
          emailContato,
          chavePix,
          aliquotaImposto: aliquotaImposto !== undefined ? Number(aliquotaImposto) : undefined,
        },
        select: {
          nomeFantasia: true,
          cnpjCpf: true,
          nichoPrincipal: true,
          telefoneWhatsapp: true,
          emailContato: true,
          chavePix: true,
          pixQrCodeUrl: true,
          aliquotaImposto: true,
        }
      });

      return res.json(updatedTenant);
    
  }, "atualizar tenant configurações");

  resetRevenue = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ error: 'Não autorizado' });
      
      const userId = req.user!.id as string;
      if (req.user?.role !== 'SUPER_ADMIN') {
        const access = await prisma.storeUserAccess.findUnique({
          where: { storeId_userId: { storeId, userId } }
        });
        if (!access || (access.role !== 'ADMIN_LOJA' && access.role !== 'GERENTE')) {
          return res.status(403).json({ error: 'Acesso negado. Apenas o administrador da loja pode zerar o faturamento.' });
        }
      }

      await prisma.$transaction([
        prisma.financialTransaction.deleteMany({ where: { storeId } }),
        prisma.sale.deleteMany({ where: { storeId } }),
        prisma.accountReceivable.deleteMany({ where: { storeId } }),
        prisma.cashRegister.deleteMany({ where: { storeId } }),
      ]);

      return res.json({ message: 'Faturamento zerado com sucesso.' });
    
  }, "redefinir revenue");

  // ==========================================
  // GESTÃO DE EQUIPE (USUÁRIOS)
  // ==========================================

  getUsers = asyncHandler(async (req: Request, res: Response) => {
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
    
  }, "obter usuários");

  createUser = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(401).json({ error: 'Não autorizado' });

      if (req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const { nome, email, senha, role, permiteVendaPrazo, limiteDescontoMaximo } = req.body;

      if (!nome || !email || !senha || !role) {
        return res.status(400).json({ error: 'Preencha todos os campos obrigatórios' });
      }

      // Anti-escalada: apenas papéis de loja válidos (nunca SUPER_ADMIN/USER/etc.)
      if (!STORE_ROLES_ALLOWED.has(role)) {
        return res.status(400).json({ error: 'Papel inválido para funcionário' });
      }

      // Verifica e-mail duplicado
      const emailExists = await prisma.user.findUnique({ where: { email } });
      if (emailExists) {
        return res.status(400).json({ error: 'E-mail já está em uso' });
      }

      const senhaHash = await hashPassword(senha);

      const newUser = await prisma.user.create({
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
        // SEGURANÇA: devolve apenas campos seguros — nunca o senhaHash
        select: {
          id: true,
          nome: true,
          email: true,
          role: true,
          ativo: true,
          createdAt: true,
          storeAccess: {
            select: {
              storeId: true,
              role: true,
              permiteVendaPrazo: true,
              limiteDescontoMaximo: true
            }
          }
        }
      });

      return res.status(201).json(newUser);
    
  }, "criar usuário");

  updateUser = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;
      
      if (!storeId) return res.status(401).json({ error: 'Não autorizado' });

      if (req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const { nome, email, senha, role, permiteVendaPrazo, limiteDescontoMaximo, ativo } = req.body;

      // Anti-escalada: apenas papéis de loja válidos (nunca SUPER_ADMIN/USER/etc.)
      if (role !== undefined && !STORE_ROLES_ALLOWED.has(role)) {
        return res.status(400).json({ error: 'Papel inválido para funcionário' });
      }

      // Garantir que o usuário existe e pertence à mesma loja
      const existingUser = await prisma.storeUserAccess.findUnique({
        where: { storeId_userId: { storeId, userId: id } },
        include: { user: true }
      });

      if (!existingUser) {
        return res.status(404).json({ error: 'Funcionário não encontrado' });
      }

      // Impede modificar o SUPER_ADMIN
      if (existingUser.user.role === 'SUPER_ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Você não pode modificar um Super Administrador' });
      }

      const updateData: any = {};
      if (nome) updateData.nome = nome;
      if (email) updateData.email = email;
      if (role) updateData.role = role;
      if (permiteVendaPrazo !== undefined) updateData.permiteVendaPrazo = permiteVendaPrazo;
      if (limiteDescontoMaximo !== undefined) updateData.limiteDescontoMaximo = limiteDescontoMaximo;
      if (ativo !== undefined) updateData.ativo = ativo;

      if (senha) {
        updateData.senhaHash = await hashPassword(senha);
      }

      const updatedUser = await prisma.user.update({
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
        // SEGURANÇA: devolve apenas campos seguros — nunca o senhaHash
        select: {
          id: true,
          nome: true,
          email: true,
          role: true,
          ativo: true,
          createdAt: true,
          storeAccess: {
            select: {
              storeId: true,
              role: true,
              permiteVendaPrazo: true,
              limiteDescontoMaximo: true
            }
          }
        }
      });

      return res.json(updatedUser);
    
  }, "atualizar usuário");

  uploadPix = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId as string;
      if (!storeId) return res.status(403).json({ error: 'Acesso negado' });

      if (!req.file) {
        return res.status(400).json({ error: 'Nenhuma imagem enviada' });
      }

      // O caminho salvo será algo como '/uploads/pix-12345.jpg'
      const fileUrl = `/uploads/${req.file.filename}`;

      await prisma.store.update({
        where: { id: storeId },
        data: { pixQrCodeUrl: fileUrl }
      });

      return res.json({ message: 'QR Code atualizado com sucesso', pixQrCodeUrl: fileUrl });
    
  }, "enviar pix");

}
