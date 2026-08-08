import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, getStoreId } from "../lib/asyncHandler";

export class CategoryController {
  list = asyncHandler(async (_req: Request, res: Response) => {
    const storeId = getStoreId(_req);

    const categories = await prisma.category.findMany({
      where: { storeId },
      orderBy: { nome: 'asc' }
    });

    res.json(categories);
  }, "listar categorias");

  create = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);

    const { nome, corHexadecimal, margemLucroPadrao, aliquotaImposto } = req.body;

    if (!nome) {
      res.status(400).json({ message: "O nome da categoria é obrigatório" });
      return;
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
  }, "criar categoria");

  update = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;

    const { nome, corHexadecimal, margemLucroPadrao, aliquotaImposto } = req.body;

    // Verificar se a categoria pertence ao lojista
    const existingCategory = await prisma.category.findFirst({
      where: { id, storeId }
    });

    if (!existingCategory) {
      res.status(404).json({ message: "Categoria não encontrada" });
      return;
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
  }, "atualizar categoria");

  delete = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;

    // Verificar se pertence ao tenant
    const existingCategory = await prisma.category.findFirst({
      where: { id, storeId }
    });

    if (!existingCategory) {
      res.status(404).json({ message: "Categoria não encontrada" });
      return;
    }

    // Verificar se há produtos usando essa categoria
    const productsCount = await prisma.product.count({
      where: { categoryId: id }
    });

    if (productsCount > 0) {
      res.status(400).json({
        message: `Não é possível excluir: existem ${productsCount} produtos vinculados a esta categoria.`
      });
      return;
    }

    await prisma.category.delete({
      where: { id }
    });

    res.status(204).send();
  }, "excluir categoria");
}
