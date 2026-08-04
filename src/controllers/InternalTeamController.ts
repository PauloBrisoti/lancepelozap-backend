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
      const { email, nome, roleId, expiresAt } = req.body;
      
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
          ativo: false, // ficará false até aceitar
          expiresAt: expiresAt ? new Date(expiresAt) : null
        }
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          storeId: null, // Log de equipe interna
          acao: "TEAM_INVITE_SENT",
          tabelaAfetada: "users",
          dadosNovos: { email, roleId, expiresAt: user.expiresAt }
        }
      });

      // Em produção, dispararia e-mail aqui.
      res.json({ message: "Convite enviado (simulado).", user });
    } catch (error) {
      res.status(500).json({ error: "Erro ao convidar usuário." });
    }
  }

  // Define ou remove a expiração de acesso de um usuário
  async updateUserExpiry(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const { expiresAt } = req.body; // ISO string ou null

      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

      const parsed = expiresAt ? new Date(expiresAt) : null;
      if (parsed && Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: "Data de expiração inválida." });
      }

      await prisma.user.update({
        where: { id },
        data: { expiresAt: parsed }
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          storeId: null,
          acao: "TEAM_ACCESS_EXPIRY_UPDATED",
          tabelaAfetada: "users",
          dadosAntigos: { id, expiresAt: user.expiresAt },
          dadosNovos: { id, expiresAt: parsed }
        }
      });

      res.json({ message: "Expiração atualizada." });
    } catch (error) {
      res.status(500).json({ error: "Erro ao atualizar expiração." });
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
      const includeRoles = {
        permissions: true,
        _count: { select: { users: true } },
        client: { select: { id: true, nomeCompleto: true } }
      };

      let roles = await prisma.internalRole.findMany({ include: includeRoles });

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
        const modules = ['CLIENTES', 'PLANOS_E_MODULOS', 'ACESSO_E_LIBERACOES', 'FINANCEIRO', 'AUDITORIA', 'CONFIGURACOES'];

        for (const mod of modules) {
          await prisma.internalRolePermission.create({
            data: { roleId: superAdminRole.id, module: mod, accessLevel: 'FULL' }
          });
        }

        // Support permissions
        await prisma.internalRolePermission.create({ data: { roleId: supportRole.id, module: 'CLIENTES', accessLevel: 'VIEW' } });

        // Finance permissions
        await prisma.internalRolePermission.create({ data: { roleId: financeRole.id, module: 'FINANCEIRO', accessLevel: 'FULL' } });
        await prisma.internalRolePermission.create({ data: { roleId: financeRole.id, module: 'CLIENTES', accessLevel: 'VIEW' } });

        roles = await prisma.internalRole.findMany({
          include: includeRoles
        });
      }

      res.json(roles);
    } catch (error) {
      res.status(500).json({ error: "Erro ao listar papéis." });
    }
  }

  // Cria um novo papel
  async createRole(req: Request, res: Response) {
    try {
      const { name, description, permissions, clientId } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Nome do papel é obrigatório." });
      }

      const existing = await prisma.internalRole.findUnique({ where: { name: name.trim().toUpperCase() } });
      if (existing) return res.status(409).json({ error: "Já existe um papel com esse nome." });

      if (clientId) {
        const client = await prisma.client.findUnique({ where: { id: clientId } });
        if (!client) return res.status(400).json({ error: "Cliente do escopo não encontrado." });
      }

      const role = await prisma.internalRole.create({
        data: {
          name: name.trim().toUpperCase(),
          description: description || null,
          clientId: clientId || null,
          permissions: Array.isArray(permissions)
            ? {
                create: permissions
                  .filter((p: any) => p.module && (p.accessLevel === 'FULL' || p.accessLevel === 'VIEW' || (Array.isArray(p.actions) && p.actions.length > 0)))
                  .map((p: any) => ({
                    module: p.module,
                    accessLevel: p.accessLevel || 'NONE',
                    actions: Array.isArray(p.actions) ? p.actions : []
                  }))
              }
            : undefined
        },
        include: { permissions: true }
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          storeId: null,
          acao: "ROLE_CREATED",
          tabelaAfetada: "internal_roles",
          dadosNovos: { id: role.id, name: role.name }
        }
      });

      res.status(201).json(role);
    } catch (error) {
      console.error("[InternalTeamController.createRole] Error:", error);
      res.status(500).json({ error: "Erro ao criar papel." });
    }
  }

  // Atualiza metadados de um papel (nome/descrição/escopo)
  async updateRole(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const { name, description, clientId } = req.body;

      const role = await prisma.internalRole.findUnique({ where: { id } });
      if (!role) return res.status(404).json({ error: "Papel não encontrado." });
      if (role.isSystem) return res.status(400).json({ error: "Papel de sistema não pode ser alterado." });

      const data: Record<string, string | null> = {};
      if (name !== undefined && name.trim()) {
        const normalized = name.trim().toUpperCase();
        const clash = await prisma.internalRole.findFirst({ where: { name: normalized, id: { not: id } } });
        if (clash) return res.status(409).json({ error: "Já existe um papel com esse nome." });
        data.name = normalized;
      }
      if (description !== undefined) data.description = description || null;
      if (clientId !== undefined) {
        if (clientId) {
          const client = await prisma.client.findUnique({ where: { id: clientId } });
          if (!client) return res.status(400).json({ error: "Cliente do escopo não encontrado." });
        }
        data.clientId = clientId || null;
      }

      const updated = await prisma.internalRole.update({
        where: { id },
        data,
        include: { permissions: true }
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          storeId: null,
          acao: "ROLE_UPDATED",
          tabelaAfetada: "internal_roles",
          dadosAntigos: { name: role.name, description: role.description },
          dadosNovos: { name: updated.name, description: updated.description }
        }
      });

      res.json(updated);
    } catch (error) {
      console.error("[InternalTeamController.updateRole] Error:", error);
      res.status(500).json({ error: "Erro ao atualizar papel." });
    }
  }

  // Exclui um papel (protegido: sistema e papéis em uso)
  async deleteRole(req: Request, res: Response) {
    try {
      const id = req.params.id as string;

      const role = await prisma.internalRole.findUnique({
        where: { id },
        include: { _count: { select: { users: true } } }
      });
      if (!role) return res.status(404).json({ error: "Papel não encontrado." });
      if (role.isSystem) return res.status(400).json({ error: "Papel de sistema não pode ser excluído." });
      if (role._count.users > 0) {
        return res.status(409).json({ error: `Papel em uso por ${role._count.users} usuário(s). Reatribua os usuários antes de excluir.` });
      }

      await prisma.$transaction(async (tx) => {
        await tx.internalRolePermission.deleteMany({ where: { roleId: id } });
        await tx.internalRole.delete({ where: { id } });
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          storeId: null,
          acao: "ROLE_DELETED",
          tabelaAfetada: "internal_roles",
          dadosAntigos: { id, name: role.name }
        }
      });

      res.json({ message: "Papel excluído." });
    } catch (error) {
      console.error("[InternalTeamController.deleteRole] Error:", error);
      res.status(500).json({ error: "Erro ao excluir papel." });
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
          update: { accessLevel: p.accessLevel, actions: Array.isArray(p.actions) ? p.actions : [] },
          create: { roleId: role.id, module: p.module, accessLevel: p.accessLevel, actions: Array.isArray(p.actions) ? p.actions : [] }
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
