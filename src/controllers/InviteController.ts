import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../utils/password";
import { asyncHandler } from "../lib/asyncHandler";
import { logger } from "../lib/logger";

export class InviteController {
  // Valida se o token de convite é válido
  validateToken = asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: "Token de convite inválido." });
    }

    const user = await prisma.user.findFirst({
      where: {
        inviteToken: token,
        inviteTokenExpires: { gt: new Date() }
      },
      select: {
        id: true,
        email: true,
        nome: true,
        internalRole: {
          select: {
            name: true,
            description: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: "Convite inválido ou expirado." });
    }

    res.json({
      valid: true,
      email: user.email,
      nome: user.nome,
      role: user.internalRole?.description || user.internalRole?.name
    });
  }, "validar token de convite");

  // Aceita o convite e define a senha
  acceptInvite = asyncHandler(async (req: Request, res: Response) => {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: "Token e senha são obrigatórios." });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "A senha deve ter pelo menos 8 caracteres." });
    }

    // Buscar usuário pelo token
    const user = await prisma.user.findFirst({
      where: {
        inviteToken: token,
        inviteTokenExpires: { gt: new Date() }
      }
    });

    if (!user) {
      return res.status(404).json({ error: "Convite inválido ou expirado." });
    }

    // Hash da nova senha
    const senhaHash = await hashPassword(password);

    // Ativar usuário e limpar token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        senhaHash,
        ativo: true,
        inviteToken: null,
        inviteTokenExpires: null
      }
    });

    // Log de auditoria
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        storeId: null,
        acao: "TEAM_INVITE_ACCEPTED",
        tabelaAfetada: "users",
        dadosNovos: { email: user.email }
      }
    });

    logger.info(`[INVITE] Convite aceito por ${user.email}`);

    res.json({ message: "Convite aceito com sucesso! Você já pode fazer login." });
  }, "aceitar convite");
}
