import { Request, Response } from "express";
import { logger } from '../lib/logger';
import { prisma } from "../lib/prisma";
import { parseDate } from "../lib/dateUtils";
import { asyncHandler, getStoreId } from "../lib/asyncHandler";

const RESTRICTED_ROLES = ['VENDEDOR', 'CAIXA'];

async function isRestrictedRole(req: Request): Promise<boolean> {
  const storeId = req.user?.storeId;
  const userId = req.user?.id;
  if (!storeId || !userId) return false;
  if ((req.user as any)?.isImpersonating) return false;
  const access = await prisma.storeUserAccess.findUnique({
    where: { storeId_userId: { storeId, userId } },
    select: { role: true }
  });
  return !!access && RESTRICTED_ROLES.includes(access.role);
}

/** Remove dados sensíveis (custo) para VENDEDOR/CAIXA */
function hideCost<T extends { precoCusto?: unknown }>(items: T[], restricted: boolean): T[] {
  if (!restricted) return items;
  return items.map(item => ({ ...item, precoCusto: 0 })) as T[];
}

export class ProductController {
  list = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);

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

    const encomendaIds = products.filter(p => p.status === 'ENCOMENDA').map(p => p.id);
    if (encomendaIds.length > 0) {
      const encomendaData = await prisma.purchaseOrderItem.findMany({
        where: {
          productId: { in: encomendaIds },
          order: { customerId: { not: null } }
        },
        select: {
          productId: true,
          order: { select: { customer: { select: { nomeCompleto: true } } } }
        },
        distinct: ['productId'],
        orderBy: { id: 'desc' },
      });
      const customerMap = new Map<string, string>();
      for (const item of encomendaData) {
        if (!customerMap.has(item.productId) && item.order.customer) {
          customerMap.set(item.productId, item.order.customer.nomeCompleto);
        }
      }
      for (const p of products) {
        (p as any).clienteNome = customerMap.get(p.id) || null;
      }
    }

    const restricted = await isRestrictedRole(req);
    res.json(hideCost(products, restricted));
  }, "listar produtos");

  async findByEan(req: Request, res: Response) {
    try {
      const storeId = req.user?.storeId as string;
      if (!storeId) {
        return res.status(401).json({ message: "Tenant ID não encontrado no token" });
      }

      const ean = String(req.params.ean || '').trim();
      if (!ean) {
        return res.status(400).json({ message: "Código de barras é obrigatório" });
      }

      const product = await prisma.product.findFirst({
        where: { storeId, codigoBarrasEan: ean },
        include: {
          category: { select: { id: true, nome: true, corHexadecimal: true } },
          brand: { select: { id: true, nome: true } },
        },
      });

      if (!product) {
        return res.status(404).json({ message: "Produto não encontrado" });
      }

      const restricted = await isRestrictedRole(req);
      if (restricted) {
        (product as any).precoCusto = 0;
      }

      res.json(product);
    } catch (error) {
      logger.error('Erro ao buscar produto:', error);
      return res.status(500).json({ error: 'Erro ao buscar produto' });
    }
  }

  create = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);

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
        dataPedido: parseDate(dataPedido),
        previsaoChegada: parseDate(previsaoChegada)
      }
    });

    res.status(201).json(product);
  }, "criar produto");

  update = asyncHandler(async (req: Request, res: Response) => {
    const storeId = getStoreId(req);
    const id = req.params.id as string;

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
        dataPedido: parseDate(dataPedido),
        previsaoChegada: parseDate(previsaoChegada)
      }
    });

    res.json(product);
  }, "atualizar produto");

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
      logger.error("Erro ao excluir produto:", error);
      res.status(500).json({ message: "Erro ao excluir produto. Ele pode já estar vinculado a uma venda." });
    }
  }
}
