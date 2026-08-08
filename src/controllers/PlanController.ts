import { Request, Response } from 'express';
import { asyncHandler } from "../lib/asyncHandler";
import { prisma } from '../lib/prisma';

export class PlanController {
  list = asyncHandler(async (req: Request, res: Response) => {
      const plans = await prisma.plan.findMany({ orderBy: { precoMensal: 'asc' } });
      return res.json(plans);
    
  }, "listar");

  create = asyncHandler(async (req: Request, res: Response) => {
      const { nome, precoMensal, maxControls, maxStores, features } = req.body;
      if (!nome || precoMensal === undefined) {
        return res.status(400).json({ error: 'Nome e preço mensal são obrigatórios' });
      }
      const plan = await prisma.plan.create({
        data: {
          nome,
          precoMensal,
          maxControls: maxControls || 1,
          maxStores: maxStores || 1,
          features: features ? JSON.stringify(features) : null,
        },
      });
      return res.status(201).json(plan);
    
  }, "criar");

  update = asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const existing = await prisma.plan.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: 'Plano não encontrado' });

      const { nome, precoMensal, maxControls, maxStores, features } = req.body;
      const updated = await prisma.plan.update({
        where: { id },
        data: {
          ...(nome && { nome }),
          ...(precoMensal !== undefined && { precoMensal }),
          ...(maxControls !== undefined && { maxControls }),
          ...(maxStores !== undefined && { maxStores }),
          ...(features !== undefined && { features: JSON.stringify(features) }),
        },
      });
      return res.json(updated);
    
  }, "atualizar");

  delete = asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const existing = await prisma.plan.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: 'Plano não encontrado' });

      const subsCount = await prisma.subscription.count({ where: { planId: id } });
      if (subsCount > 0) {
        return res.status(400).json({ error: `Plano possui ${subsCount} assinatura(s). Remova-as primeiro.` });
      }

      await prisma.plan.delete({ where: { id } });
      return res.json({ message: 'Plano excluído' });
    
  }, "excluir");
}
