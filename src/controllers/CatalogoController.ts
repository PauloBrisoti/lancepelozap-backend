import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export class CatalogoController {
  // Endpoint PÚBLICO — lista produtos ativos de um tenant
  static async getPublicCatalog(req: Request, res: Response) {
    try {
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
    } catch (error) {
      console.error('Erro no catálogo público:', error);
      return res.status(500).json({ error: 'Erro ao carregar catálogo' });
    }
  }
}
