import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

export class CategoryController {
  async list(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) {
        return res.status(401).json({ message: "Tenant ID não encontrado no token" });
      }

      const categories = await prisma.category.findMany({
        where: { storeId },
        orderBy: { nome: 'asc' }
      });

      res.json(categories);
    } catch (error) {
      console.error("Erro ao listar categorias:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) {
        return res.status(401).json({ message: "Tenant ID não encontrado no token" });
      }

      const { nome, corHexadecimal, margemLucroPadrao, aliquotaImposto } = req.body;

      if (!nome) {
        return res.status(400).json({ message: "O nome da categoria é obrigatório" });
      }

      const category = await prisma.category.create({
        data: {
          nome,
          corHexadecimal,
          margemLucroPadrao,
          aliquotaImposto: aliquotaImposto !== undefined ? Number(aliquotaImposto) : undefined,
          storeId
        }
      });

      res.status(201).json(category);
    } catch (error) {
      console.error("Erro ao criar categoria:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;
      if (!storeId) {
        return res.status(401).json({ message: "Tenant ID não encontrado no token" });
      }

      const { nome, corHexadecimal, margemLucroPadrao, aliquotaImposto } = req.body;

      // Verificar se a categoria pertence ao lojista
      const existingCategory = await prisma.category.findFirst({
        where: { id, storeId }
      });

      if (!existingCategory) {
        return res.status(404).json({ message: "Categoria não encontrada" });
      }

      const category = await prisma.category.update({
        where: { id },
        data: {
          nome,
          corHexadecimal,
          margemLucroPadrao,
          aliquotaImposto: aliquotaImposto !== undefined ? Number(aliquotaImposto) : undefined,
        }
      });

      res.json(category);
    } catch (error) {
      console.error("Erro ao atualizar categoria:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      const id = req.params.id as string;
      
      if (!storeId) {
        return res.status(401).json({ message: "Tenant ID não encontrado no token" });
      }

      // Verificar se pertence ao tenant
      const existingCategory = await prisma.category.findFirst({
        where: { id, storeId }
      });

      if (!existingCategory) {
        return res.status(404).json({ message: "Categoria não encontrada" });
      }

      // Verificar se há produtos usando essa categoria
      const productsCount = await prisma.product.count({
        where: { categoryId: id }
      });

      if (productsCount > 0) {
        return res.status(400).json({ 
          message: `Não é possível excluir: existem ${productsCount} produtos vinculados a esta categoria.` 
        });
      }

      await prisma.category.delete({
        where: { id }
      });

      res.status(204).send();
    } catch (error) {
      console.error("Erro ao excluir categoria:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }
}
