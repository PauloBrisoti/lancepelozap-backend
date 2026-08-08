import { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { asyncHandler } from "../lib/asyncHandler";
import { prisma } from '../lib/prisma';

export class CommissionRuleController {
  // VENDEDOR/CAIXA não podem criar/alterar/excluir regras de comissão
  private async isRestrictedRole(storeId: string, userId: string): Promise<boolean> {
    const access = await prisma.storeUserAccess.findUnique({
      where: { storeId_userId: { storeId, userId } },
      select: { role: true }
    });
    return !!access && (access.role === 'VENDEDOR' || access.role === 'CAIXA');
  }

  list = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const rules = await prisma.commissionRule.findMany({
        where: { storeId },
        include: {
          user: { select: { id: true, nome: true } },
          category: { select: { id: true, nome: true } },
        },
        orderBy: { id: 'asc' },
      });

      // VENDEDOR/CAIXA vê apenas as próprias regras de comissão
      const userId = req.user?.id;
      if (userId) {
        const access = await prisma.storeUserAccess.findUnique({
          where: { storeId_userId: { storeId, userId } },
          select: { role: true }
        });
        if (access && (access.role === 'VENDEDOR' || access.role === 'CAIXA')) {
          const own = rules.filter(r => r.userId === userId);
          return res.json(own);
        }
      }

      res.json(rules);
    
  }, "listar");

  create = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { userId, categoryId, percentual } = req.body;

      if (!userId || percentual === undefined) {
        return res.status(400).json({ message: 'userId e percentual são obrigatórios' });
      }

      if (req.user?.id && await this.isRestrictedRole(storeId, req.user.id)) {
        return res.status(403).json({ message: 'Apenas gestores podem configurar comissões' });
      }

      const user = await prisma.storeUserAccess.findUnique({
        where: { storeId_userId: { storeId, userId } }
      });
      if (!user) return res.status(400).json({ message: 'Usuário não encontrado nesta loja' });

      const rule = await prisma.commissionRule.create({
        data: {
          storeId,
          userId,
          categoryId: categoryId || null,
          percentual: Number(percentual),
          ativo: true,
        },
        include: {
          user: { select: { id: true, nome: true } },
          category: { select: { id: true, nome: true } },
        },
      });

      res.status(201).json(rule);
    
  }, "criar");

  update = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { id } = req.params;
      const { percentual, categoryId, ativo } = req.body;

      const existing = await prisma.commissionRule.findFirst({
        where: { id: String(id), storeId }
      });
      if (!existing) return res.status(404).json({ message: 'Regra não encontrada' });

      if (req.user?.id && await this.isRestrictedRole(storeId, req.user.id)) {
        return res.status(403).json({ message: 'Apenas gestores podem configurar comissões' });
      }

      const updated = await prisma.commissionRule.update({
        where: { id: String(id) },
        data: {
          percentual: percentual !== undefined ? Number(percentual) : undefined,
          categoryId: categoryId !== undefined ? categoryId : undefined,
          ativo: ativo !== undefined ? ativo : undefined,
        },
        include: {
          user: { select: { id: true, nome: true } },
          category: { select: { id: true, nome: true } },
        },
      });

      res.json(updated);
    
  }, "atualizar");

  remove = asyncHandler(async (req: Request, res: Response) => {
      const storeId = req.user?.storeId;
      if (!storeId) return res.status(401).json({ message: 'Loja não identificada' });

      const { id } = req.params;
      const existing = await prisma.commissionRule.findFirst({
        where: { id: String(id), storeId }
      });
      if (!existing) return res.status(404).json({ message: 'Regra não encontrada' });

      if (req.user?.id && await this.isRestrictedRole(storeId, req.user.id)) {
        return res.status(403).json({ message: 'Apenas gestores podem configurar comissões' });
      }

      await prisma.commissionRule.delete({ where: { id: String(id) } });

      res.json({ message: 'Regra removida com sucesso' });
    
  }, "remover");
}
