import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, getStoreId } from "../lib/asyncHandler";

export class BrandController {
  list = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);

    const brands = await prisma.brand.findMany({
      where: { storeId },
      orderBy: { nome: 'asc' }
    });

    res.json(brands);
  }, "listar marcas");

  create = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);

    const { nome } = req.body;

    if (!nome) {
      res.status(400).json({ message: "O nome da marca é obrigatório" });
      return;
    }

    const brand = await prisma.brand.create({
      data: { nome, storeId }
    });

    res.status(201).json(brand);
  }, "criar marca");

  update = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;

    const { nome } = req.body;

    const existing = await prisma.brand.findFirst({
      where: { id, storeId }
    });

    if (!existing) {
      res.status(404).json({ message: "Marca não encontrada" });
      return;
    }

    const brand = await prisma.brand.update({
      where: { id },
      data: { nome }
    });

    res.json(brand);
  }, "atualizar marca");

  delete = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;

    const existing = await prisma.brand.findFirst({
      where: { id, storeId }
    });

    if (!existing) {
      res.status(404).json({ message: "Marca não encontrada" });
      return;
    }

    const productsCount = await prisma.product.count({
      where: { brandId: id }
    });

    if (productsCount > 0) {
      res.status(400).json({
        message: `Não é possível excluir: existem ${productsCount} produtos vinculados a esta marca.`
      });
      return;
    }

    await prisma.brand.delete({ where: { id } });

    res.status(204).send();
  }, "excluir marca");
}
