import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

export class ProductController {
  async list(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) {
        return res.status(401).json({ message: "Tenant ID não encontrado no token" });
      }

      const products = await prisma.product.findMany({
        where: { storeId },
        include: {
          category: {
            select: { nome: true, corHexadecimal: true }
          },
          brand: {
            select: { id: true, nome: true }
          }
        },
        orderBy: { nome: 'asc' }
      });

      res.json(products);
    } catch (error) {
      console.error("Erro ao listar produtos:", error);
      res.status(500).json({ message: "Erro interno do servidor" });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) {
        return res.status(401).json({ message: "Tenant ID não encontrado no token" });
      }

      const {
        categoryId,
        brandId,
        codigoBarrasEan,
        nome,
        descricaoVariante,
        ncm,
        unidade,
        pesoBruto,
        pesoLiquido,
        precoCusto,
        precoVendaSugerido,
        impostoEstimadoPercentual,
        qtdEstoqueAtual,
        imageUrl,
        status,
        dataPedido,
        previsaoChegada
      } = req.body;

      if (!nome || !categoryId || precoCusto === undefined || precoVendaSugerido === undefined) {
        return res.status(400).json({ message: "Campos obrigatórios faltando (nome, categoryId, precoCusto, precoVendaSugerido)" });
      }

      if (isNaN(Number(precoCusto)) || isNaN(Number(precoVendaSugerido))) {
        return res.status(400).json({ message: "Preço de custo e Preço de venda devem ser numéricos" });
      }

      // Validar se a categoria existe e pertence ao tenant
      const category = await prisma.category.findFirst({
        where: { id: categoryId, storeId }
      });

      if (!category) {
        return res.status(400).json({ message: "Categoria inválida" });
      }

      // Validar marca se informada
      if (brandId) {
        const brand = await prisma.brand.findFirst({
          where: { id: brandId, storeId }
        });
        if (!brand) {
          return res.status(400).json({ message: "Marca inválida" });
        }
      }

      const finalCodigo = codigoBarrasEan?.trim() ? codigoBarrasEan.trim() : null;
      // Generates a random alphanumeric code like P-1X4D
      const generatedCodigoVisual = 'P-' + Math.random().toString(36).substring(2, 6).toUpperCase();

      const product = await prisma.product.create({
        data: {
          storeId,
          categoryId,
          brandId: brandId || undefined,
          codigoBarrasEan: finalCodigo,
          codigoVisual: generatedCodigoVisual,
          nome,
          descricaoVariante,
          ncm,
          unidade: unidade || 'UN',
          pesoBruto: pesoBruto || undefined,
          pesoLiquido: pesoLiquido || undefined,
          precoCusto,
          precoVendaSugerido,
          impostoEstimadoPercentual: impostoEstimadoPercentual || 0,
          qtdEstoqueAtual: qtdEstoqueAtual || 0,
          imageUrl,
          status: status || 'ATIVO',
          dataPedido: dataPedido ? new Date(dataPedido) : null,
          previsaoChegada: previsaoChegada ? new Date(previsaoChegada) : null
        }
      });

      res.status(201).json(product);
    } catch (error) {
      console.error("Erro ao criar produto:", error);
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

      const {
        categoryId,
        brandId,
        codigoBarrasEan,
        nome,
        descricaoVariante,
        ncm,
        unidade,
        pesoBruto,
        pesoLiquido,
        precoCusto,
        precoVendaSugerido,
        impostoEstimadoPercentual,
        qtdEstoqueAtual,
        imageUrl,
        status,
        dataPedido,
        previsaoChegada
      } = req.body;

      const existingProduct = await prisma.product.findFirst({
        where: { id, storeId }
      });

      if (!existingProduct) {
        return res.status(404).json({ message: "Produto não encontrado" });
      }

      if (categoryId) {
        const category = await prisma.category.findFirst({
          where: { id: categoryId, storeId }
        });
        if (!category) {
          return res.status(404).json({ message: "Categoria informada não encontrada" });
        }
      }

      if (brandId) {
        const brand = await prisma.brand.findFirst({
          where: { id: brandId, storeId }
        });
        if (!brand) {
          return res.status(404).json({ message: "Marca informada não encontrada" });
        }
      }

      const product = await prisma.product.update({
        where: { id },
        data: {
          categoryId,
          brandId: brandId || null,
          codigoBarrasEan,
          codigoVisual: req.body.codigoVisual,
          nome,
          descricaoVariante,
          ncm,
          unidade,
          pesoBruto: pesoBruto !== undefined ? pesoBruto : undefined,
          pesoLiquido: pesoLiquido !== undefined ? pesoLiquido : undefined,
          precoCusto,
          precoVendaSugerido,
          impostoEstimadoPercentual,
          qtdEstoqueAtual,
          imageUrl,
          status,
          dataPedido: dataPedido ? new Date(dataPedido) : null,
          previsaoChegada: previsaoChegada ? new Date(previsaoChegada) : null
        }
      });

      res.json(product);
    } catch (error) {
      console.error("Erro ao atualizar produto:", error);
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

      const existingProduct = await prisma.product.findFirst({
        where: { id, storeId }
      });

      if (!existingProduct) {
        return res.status(404).json({ message: "Produto não encontrado" });
      }

      // Excluir produto (Futuramente, validaremos se ele já foi vendido. Se foi, devemos inativar, não excluir)
      // Por ora, vamos permitir excluir para facilitar o desenvolvimento do CRUD.
      // O banco tem chaves estrangeiras com sale_items, então falhará sozinho se houver venda.
      
      await prisma.product.delete({
        where: { id }
      });

      res.status(204).send();
    } catch (error) {
      console.error("Erro ao excluir produto:", error);
      res.status(500).json({ message: "Erro ao excluir produto. Ele pode já estar vinculado a uma venda." });
    }
  }
}
