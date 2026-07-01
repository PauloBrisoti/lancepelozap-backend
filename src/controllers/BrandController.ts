import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

export class BrandController {
  async list(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) {
        return res.status(401).json({ message: "Tenant ID não encontrado no token" });
      }

      const brands = await prisma.brand.findMany({
        where: { storeId },
        orderBy: { nome: 'asc' }
      });

      res.json(brands);
    } catch (error) {
      console.error("Erro ao listar marcas:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) {
        return res.status(401).json({ message: "Tenant ID não encontrado no token" });
      }

      const { nome } = req.body;

      if (!nome) {
        return res.status(400).json({ message: "O nome da marca é obrigatório" });
      }

      const brand = await prisma.brand.create({
        data: { nome, storeId }
      });

      res.status(201).json(brand);
    } catch (error) {
      console.error("Erro ao criar marca:", error);
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

      const { nome } = req.body;

      const existing = await prisma.brand.findFirst({
        where: { id, storeId }
      });

      if (!existing) {
        return res.status(404).json({ message: "Marca não encontrada" });
      }

      const brand = await prisma.brand.update({
        where: { id },
        data: { nome }
      });

      res.json(brand);
    } catch (error) {
      console.error("Erro ao atualizar marca:", error);
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

      const existing = await prisma.brand.findFirst({
        where: { id, storeId }
      });

      if (!existing) {
        return res.status(404).json({ message: "Marca não encontrada" });
      }

      const productsCount = await prisma.product.count({
        where: { brandId: id }
      });

      if (productsCount > 0) {
        return res.status(400).json({
          message: `Não é possível excluir: existem ${productsCount} produtos vinculados a esta marca.`
        });
      }

      await prisma.brand.delete({ where: { id } });

      res.status(204).send();
    } catch (error) {
      console.error("Erro ao excluir marca:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }
}
