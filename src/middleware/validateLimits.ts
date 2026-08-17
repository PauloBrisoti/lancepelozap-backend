import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { fail } from '../lib/response';

export async function validateEmployeeLimit(req: Request, res: Response, next: NextFunction) {
  try {
    const storeId = req.user?.storeId || req.body?.storeId;
    if (!storeId) return fail(res, 'Loja não identificada', 401);

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: {
        control: {
          select: {
            client: {
              select: {
                subscriptions: {
                  where: { statusPagamento: { in: ['PAGO', 'PENDENTE'] } },
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  include: { plan: true }
                }
              }
            }
          }
        }
      }
    });

    const plan = store?.control?.client?.subscriptions?.[0]?.plan;
    const limit = (plan as any)?.maxEmployees ?? 3;

    const employeeCount = await prisma.storeUserAccess.count({ where: { storeId } });
    if (employeeCount >= limit) {
      return fail(res, `Limite de ${limit} funcionários por loja atingido. Faça upgrade do plano.`, 403);
    }

    next();
  } catch (error) {
    logger.error('Erro ao validar limite:', error);
    return fail(res, 'Erro interno ao validar limites', 500);
  }
}
