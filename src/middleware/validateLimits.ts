import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { fail } from '../lib/response';

export async function validateStoreLimit(req: Request, res: Response, next: NextFunction) {
  try {
    const clientId = req.user?.clientId;
    if (!clientId) return fail(res, 'Cliente não identificado', 401);

    const sub = await prisma.subscription.findFirst({
      where: { clientId, statusPagamento: { in: ['PAGO', 'PENDENTE'] } },
      include: { plan: true }
    });

    if (!sub) return fail(res, 'Assinatura não encontrada', 400);

    const plan = sub.plan;
    const controlId = req.body?.controlId;
    const storeCount = controlId
      ? await prisma.store.count({ where: { controlId } })
      : await prisma.store.count({
          where: { control: { clientId } }
        });

    if (storeCount >= plan.maxStores) {
      return fail(res, `Limite de ${plan.maxStores} lojas atingido. Faça upgrade do plano.`, 403);
    }

    const controlCount = await prisma.control.count({ where: { clientId } });
    if (controlCount >= plan.maxControls) {
      return fail(res, `Limite de ${plan.maxControls} controles atingido. Faça upgrade do plano.`, 403);
    }

    next();
  } catch (error) {
    console.error('Erro ao validar limite:', error);
    return fail(res, 'Erro interno ao validar limites', 500);
  }
}

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
    console.error('Erro ao validar limite de funcionários:', error);
    return fail(res, 'Erro interno ao validar limites', 500);
  }
}
