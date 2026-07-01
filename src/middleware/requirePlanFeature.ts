import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { fail } from '../lib/response';

type Feature =
  | 'catalogo'
  | 'estoque'
  | 'financeiro'
  | 'multiplos_vendedores'
  | 'multiplas_lojas'
  | 'crediario'
  | 'relatorios'
  | 'suporte_prioritario';

const DEFAULT_FEATURES: Record<Feature, boolean> = {
  catalogo: true,
  estoque: false,
  financeiro: false,
  multiplos_vendedores: false,
  multiplas_lojas: false,
  crediario: false,
  relatorios: false,
  suporte_prioritario: false,
};

export function requirePlanFeature(feature: Feature) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const storeId = req.user?.storeId;
      if (!storeId) {
        return fail(res, 'Loja não identificada', 401);
      }

      if (req.user?.role === 'SUPER_ADMIN') {
        return next();
      }

      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { control: { select: { clientId: true } } }
      });

      if (!store) {
        return fail(res, 'Loja não encontrada', 404);
      }

      const subscription = await prisma.subscription.findFirst({
        where: {
          clientId: store.control.clientId,
          statusPagamento: { in: ['PAGO', 'TRIAL'] }
        },
        orderBy: { createdAt: 'desc' },
        include: { plan: true }
      });

      if (!subscription) {
        return next();
      }

      const features: Record<string, boolean> = subscription.plan.features
        ? { ...DEFAULT_FEATURES, ...JSON.parse(subscription.plan.features) }
        : { ...DEFAULT_FEATURES };

      if (!features[feature]) {
        return fail(res, `Seu plano não inclui a funcionalidade "${feature}". Faça upgrade para liberar.`, 403);
      }

      next();
    } catch (error) {
      console.error('Erro no middleware de plano:', error);
      next();
    }
  };
}
