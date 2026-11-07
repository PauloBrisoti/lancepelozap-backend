import { Request, Response } from "express";
import { logger } from '../lib/logger';
import { prisma } from "../lib/prisma";
import { hashPassword } from "../utils/password";
import crypto from "crypto";
import { asyncHandler } from "../lib/asyncHandler";
import { sendTeamInvite } from "../services/email.service";

export class InternalTeamController {
  // Lista usuários internos
  listUsers = asyncHandler(async (_req: Request, res: Response) => {
      // SEGURANÇA: whitelist de campos — nunca expor senhaHash/resetToken/twoFactorSecret
      const users = await prisma.user.findMany({
        where: {
          AND: [
            {
              OR: [
                { role: "SUPER_ADMIN" },
                { internalRoleId: { not: null } }
              ]
            },
            { email: { not: { startsWith: "excluido_" } } }
          ]
        },
        select: {
          id: true,
          nome: true,
          email: true,
          role: true,
          ativo: true,
          expiresAt: true,
          internalRoleId: true,
          internalRole: {
            include: { permissions: true }
          }
        }
      });
      res.json(users);
  }, "listar usuários da equipe");

  // Convida um usuário (cria conta pendente e envia e-mail de convite)
  inviteUser = asyncHandler(async (req: Request, res: Response) => {
      const { email, nome, roleId, expiresAt } = req.body;
      
      logger.info('[INVITE] Dados recebidos:', { email, nome, roleId, expiresAt, bodyKeys: Object.keys(req.body || {}) });

      if (!email || !nome || !roleId) {
        return res.status(400).json({ error: "Email, nome e papel são obrigatórios." });
      }

      const role = await prisma.internalRole.findUnique({ where: { id: roleId } });
      if (!role) return res.status(404).json({ error: "Papel não encontrado." });

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) return res.status(400).json({ error: "Usuário com esse e-mail já existe." });

      // Criptografar uma senha aleatória para garantir segurança até o aceite
      // (zero-knowledge: ninguém — nem o admin — conhece ou recebe essa senha)
      const randomPassword = crypto.randomBytes(20).toString('hex');
      const senhaHash = await hashPassword(randomPassword);

      // Gerar token de convite (expira em 7 dias)
      const inviteToken = crypto.randomBytes(32).toString('hex');
      const inviteTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const user = await prisma.user.create({
        data: {
          email,
          nome,
          senhaHash,
          role: role.name === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER",
          internalRoleId: role.id,
          ativo: false, // ficará false até aceitar
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          inviteToken,
          inviteTokenExpires
        },
        // SEGURANÇA: devolve apenas campos seguros — nunca o senhaHash
        select: {
          id: true,
          email: true,
          nome: true,
          role: true,
          ativo: true,
          expiresAt: true,
          createdAt: true
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

      // Enviar e-mail de convite
      const baseUrl = process.env.FRONTEND_URL || 'https://app.lancepelozap.com.br';
      const inviteLink = `${baseUrl}/convite?token=${inviteToken}`;
      
      try {
        await sendTeamInvite(email, nome, role.description || role.name, inviteLink);
        res.json({ message: "Convite enviado com sucesso!", user });
      } catch (emailError) {
        logger.error('[TEAM_INVITE] Falha ao enviar e-mail:', { error: emailError });
        // Mesmo se o e-mail falhar, o usuário foi criado
        res.json({ message: "Convite registrado, mas houve falha no envio do e-mail.", user, emailError: "Falha no envio" });
      }
  }, "convidar usuário");

  // Define ou remove a expiração de acesso de um usuário
  updateUserExpiry = asyncHandler(async (req: Request, res: Response) => {
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
  }, "atualizar expiração");

  // Altera o papel de um usuário
  changeRole = asyncHandler(async (req: Request, res: Response) => {
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
  }, "alterar papel");

  // Alterna o status ativo/inativo de um usuário da equipe
  toggleAccess = asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

      const newAtivo = !user.ativo;

      if (!newAtivo && user.role === "SUPER_ADMIN") {
        const adminCount = await prisma.user.count({ where: { role: "SUPER_ADMIN", ativo: true } });
        if (adminCount <= 1) {
          return res.status(400).json({ error: "Não é possível revogar acesso do último Super Admin." });
        }
      }

      await prisma.user.update({
        where: { id },
        data: { ativo: newAtivo }
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          storeId: null,
          acao: newAtivo ? "TEAM_ACCESS_RESTORED" : "TEAM_ACCESS_REVOKED",
          tabelaAfetada: "users",
          dadosAntigos: { id, ativo: user.ativo },
          dadosNovos: { id, ativo: newAtivo }
        }
      });

      res.json({ message: newAtivo ? "Acesso restaurado com sucesso." : "Acesso revogado com sucesso." });
  }, "alternar acesso");

  // Exclui permanentemente um usuário da equipe (soft delete: desativa + limpa dados sensíveis)
  deleteUser = asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

      if (user.role === "SUPER_ADMIN" && user.ativo) {
        const adminCount = await prisma.user.count({ where: { role: "SUPER_ADMIN", ativo: true } });
        if (adminCount <= 1) {
          return res.status(400).json({ error: "Não é possível excluir o último Super Admin." });
        }
      }

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          storeId: null,
          acao: "TEAM_USER_DELETED",
          tabelaAfetada: "users",
          dadosAntigos: { id, email: user.email, nome: user.nome }
        }
      });

      await prisma.user.update({
        where: { id },
        data: {
          ativo: false,
          nome: "Usuário excluído",
          email: `excluido_${id}@removed.local`,
          senhaHash: "REMOVED",
          inviteToken: null,
          inviteTokenExpires: null,
          twoFactorSecret: null,
          resetToken: null,
          resetTokenExpiry: null,
        }
      });

      res.json({ message: "Usuário excluído com sucesso." });
  }, "excluir usuário");

  // Lista todos os papéis e permissões
  listRoles = asyncHandler(async (_req: Request, res: Response) => {
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
  }, "listar papéis");

  // Cria um novo papel
  createRole = asyncHandler(async (req: Request, res: Response) => {
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
  }, "criar papel");

  // Atualiza metadados de um papel (nome/descrição/escopo)
  updateRole = asyncHandler(async (req: Request, res: Response) => {
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
  }, "atualizar papel");

  // Exclui um papel (protegido: sistema e papéis em uso)
  deleteRole = asyncHandler(async (req: Request, res: Response) => {
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
  }, "excluir papel");

  // Edita permissões de um papel
  updateRolePermissions = asyncHandler(async (req: Request, res: Response) => {
    logger.debug(`[updateRolePermissions] Called for role ${req.params.id}`);
    const id = req.params.id as string;
    const { permissions } = req.body; // array { module: string, accessLevel: 'FULL'|'VIEW'|'NONE' }
    logger.debug(`[updateRolePermissions] Permissions body:`, { arg0: permissions });

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
  }, "atualizar permissões");
}
