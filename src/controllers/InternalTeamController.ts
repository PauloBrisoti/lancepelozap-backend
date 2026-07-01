import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import bcrypt from "bcrypt";
import crypto from "crypto";

export class InternalTeamController {
  // Lista usuários internos
  async listUsers(req: Request, res: Response) {
    try {
      const users = await prisma.user.findMany({
        where: {
          OR: [
            { role: "SUPER_ADMIN" },
            { internalRoleId: { not: null } }
          ]
        },
        include: {
          internalRole: {
            include: { permissions: true }
          }
        }
      });
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: "Erro ao listar usuários da equipe" });
    }
  }

  // Convida um usuário (apenas insere no banco como PENDENTE por enquanto)
  async inviteUser(req: Request, res: Response) {
    try {
      const { email, nome, roleId } = req.body;
      
      const role = await prisma.internalRole.findUnique({ where: { id: roleId } });
      if (!role) return res.status(404).json({ error: "Papel não encontrado." });

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) return res.status(400).json({ error: "Usuário com esse e-mail já existe." });

      // Criptografar uma senha aleatória para garantir segurança até o aceite
      const randomPassword = crypto.randomBytes(20).toString('hex');
      const senhaHash = await bcrypt.hash(randomPassword, 10);

      const user = await prisma.user.create({
        data: {
          email,
          nome,
          senhaHash,
          role: role.name === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER",
          internalRoleId: role.id,
          ativo: false // ficará false até aceitar
        }
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          storeId: null, // Log de equipe interna
          acao: "TEAM_INVITE_SENT",
          tabelaAfetada: "users",
          dadosNovos: { email, roleId }
        }
      });

      // Em produção, dispararia e-mail aqui.
      res.json({ message: "Convite enviado (simulado).", user });
    } catch (error) {
      res.status(500).json({ error: "Erro ao convidar usuário." });
    }
  }

  // Altera o papel de um usuário
  async changeRole(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const { roleId } = req.body;

      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

      const role = await prisma.internalRole.findUnique({ where: { id: roleId } });
      if (!role) return res.status(404).json({ error: "Papel não encontrado." });

      // Proteção: não deixar remover o último SUPER_ADMIN
      if (user.role === "SUPER_ADMIN" && role.name !== "SUPER_ADMIN") {
        const adminCount = await prisma.user.count({ where: { role: "SUPER_ADMIN", ativo: true } });
        if (adminCount <= 1) {
          return res.status(400).json({ error: "Não é possível alterar o papel do último Super Admin." });
        }
      }

      await prisma.user.update({
        where: { id },
        data: {
          role: role.name === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER",
          internalRoleId: role.id
        }
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          storeId: null,
          acao: "TEAM_ROLE_CHANGED",
          tabelaAfetada: "users",
          dadosAntigos: { roleId: user.internalRoleId },
          dadosNovos: { roleId }
        }
      });

      res.json({ message: "Papel atualizado com sucesso." });
    } catch (error) {
      res.status(500).json({ error: "Erro ao alterar papel." });
    }
  }

  // Revoga o acesso de um usuário (inativa)
  async revokeAccess(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

      if (user.role === "SUPER_ADMIN") {
        const adminCount = await prisma.user.count({ where: { role: "SUPER_ADMIN", ativo: true } });
        if (adminCount <= 1) {
          return res.status(400).json({ error: "Não é possível revogar acesso do último Super Admin." });
        }
      }

      await prisma.user.update({
        where: { id },
        data: { ativo: false }
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          storeId: "admin_internal",
          acao: "TEAM_ACCESS_REVOKED",
          tabelaAfetada: "users",
          dadosAntigos: { id }
        }
      });

      res.json({ message: "Acesso revogado com sucesso." });
    } catch (error) {
      res.status(500).json({ error: "Erro ao revogar acesso." });
    }
  }

  // Lista todos os papéis e permissões
  async listRoles(req: Request, res: Response) {
    try {
      let roles = await prisma.internalRole.findMany({
        include: { permissions: true }
      });

      // Auto-seed if empty
      if (roles.length === 0) {
        const superAdminRole = await prisma.internalRole.create({
          data: {
            name: 'SUPER_ADMIN',
            description: 'Acesso total e irrestrito ao sistema.',
            isSystem: true
          }
        });
        const supportRole = await prisma.internalRole.create({
          data: {
            name: 'SUPORTE',
            description: 'Pode ver chamados e dados de leitura dos clientes.',
            isSystem: false
          }
        });
        const financeRole = await prisma.internalRole.create({
          data: {
            name: 'FINANCEIRO',
            description: 'Acesso às configurações de pagamentos e assinaturas.',
            isSystem: false
          }
        });

        // Add some basic permissions
        const modules = ['CLIENTES', 'PLANOS_E_MODULOS', 'ACESSO_E_LIBERACOES', 'FINANCEIRO', 'CHAMADOS', 'AUDITORIA', 'CONFIGURACOES'];
        
        for (const mod of modules) {
          await prisma.internalRolePermission.create({
            data: { roleId: superAdminRole.id, module: mod, accessLevel: 'FULL' }
          });
        }

        // Support permissions
        await prisma.internalRolePermission.create({ data: { roleId: supportRole.id, module: 'CHAMADOS', accessLevel: 'FULL' } });
        await prisma.internalRolePermission.create({ data: { roleId: supportRole.id, module: 'CLIENTES', accessLevel: 'VIEW' } });

        // Finance permissions
        await prisma.internalRolePermission.create({ data: { roleId: financeRole.id, module: 'FINANCEIRO', accessLevel: 'FULL' } });
        await prisma.internalRolePermission.create({ data: { roleId: financeRole.id, module: 'CLIENTES', accessLevel: 'VIEW' } });

        roles = await prisma.internalRole.findMany({
          include: { permissions: true }
        });
      }

      res.json(roles);
    } catch (error) {
      res.status(500).json({ error: "Erro ao listar papéis." });
    }
  }

  // Edita permissões de um papel
  async updateRolePermissions(req: Request, res: Response) {
    console.log(`[updateRolePermissions] Called for role ${req.params.id}`);
    try {
      const id = req.params.id as string;
      const { permissions } = req.body; // array { module: string, accessLevel: 'FULL'|'VIEW'|'NONE' }
      console.log(`[updateRolePermissions] Permissions body:`, permissions);

      const role = await prisma.internalRole.findUnique({ where: { id } });
      if (!role) return res.status(404).json({ error: "Papel não encontrado." });

      if (role.name === "SUPER_ADMIN") {
        return res.status(400).json({ error: "Não é possível alterar as permissões do SUPER_ADMIN nativo." });
      }

      // Upsert permissões
      for (const p of permissions) {
        await prisma.internalRolePermission.upsert({
          where: { roleId_module: { roleId: role.id, module: p.module } },
          update: { accessLevel: p.accessLevel },
          create: { roleId: role.id, module: p.module, accessLevel: p.accessLevel }
        });
      }

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          storeId: null,
          acao: "ROLE_PERMISSION_UPDATED",
          tabelaAfetada: "internal_roles",
          dadosNovos: { roleId: role.id, permissions }
        }
      });

      res.json({ message: "Permissões atualizadas com sucesso." });
    } catch (error) {
      console.error("[InternalTeamController.updateRolePermissions] Error:", error);
      res.status(500).json({ error: "Erro ao atualizar permissões." });
    }
  }
}
