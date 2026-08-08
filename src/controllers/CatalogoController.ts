import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/asyncHandler';

export class CatalogoController {
  // Endpoint PÚBLICO — lista produtos ativos de um tenant
  static getPublicCatalog = asyncHandler(async (req: Request, res: Response) => {
    const storeId = req.params.storeId as string;

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, nomeFantasia: true, telefoneWhatsapp: true, chavePix: true, status: true }
    });

    if (!store || store.status !== 'ATIVO') {
      return res.status(404).json({ error: 'Loja não encontrada ou inativa.' });
    }

    const products = await prisma.product.findMany({
      where: { storeId, status: 'ATIVO' },
      select: {
        id: true,
        nome: true,
        precoVendaSugerido: true,
        descricaoVariante: true,
        category: { select: { nome: true } }
      },
      orderBy: { nome: 'asc' }
    });

    return res.json({ store, products });
  }, "carregar catálogo público");
}
