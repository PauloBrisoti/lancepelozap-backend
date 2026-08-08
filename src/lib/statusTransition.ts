/**
 * Helpers para operações de "recurso pertence à loja" e transições de status,
 * eliminando o boilerplate repetido de findFirst + 404 + validação de status
 * que se repetia nos controllers (ex.: AppointmentController, ServiceOrderController).
 */

import { HttpError } from './asyncHandler';

interface PrismaLike {
  findFirst(args: any): Promise<any>;
  update(args: any): Promise<any>;
}

/**
 * Busca um registro garantindo que pertence à loja do usuário autenticado.
 * Lança HttpError 404 se não existir (o asyncHandler responde no formato padrão).
 */
export async function findOwnedOrThrow<T>(
  model: { findFirst(args: any): Promise<any> },
  id: string,
  storeId: string,
  notFoundMessage: string,
  include?: unknown,
): Promise<T> {
  const record = (await model.findFirst({
    where: { id, storeId },
    ...(include ? { include } : {}),
  })) as T | null;
  if (!record) throw new HttpError(notFoundMessage, 404);
  return record;
}

export interface TransitionStatusOptions<T extends { status: string }> {
  model: PrismaLike;
  id: string;
  storeId: string;
  notFoundMessage: string;
  /** Status em que o registro pode estar para a transição ser válida. */
  allowedFrom: readonly T['status'][];
  invalidMessage: string;
  to: T['status'];
  extraData?: Record<string, unknown>;
}

/**
 * Executa uma transição de status com validação de dono e de estado:
 * findFirst(storeId) -> 404 se ausente -> 400 se status não permitido -> update.
 */
export async function transitionStatus<T extends { status: string }>(
  opts: TransitionStatusOptions<T>,
): Promise<T> {
  const { model, id, storeId, notFoundMessage, allowedFrom, invalidMessage, to, extraData } = opts;
  const record = await findOwnedOrThrow<T>(model, id, storeId, notFoundMessage);
  if (!allowedFrom.includes(record.status)) throw new HttpError(invalidMessage, 400);
  return (await model.update({ where: { id }, data: { status: to, ...extraData } })) as T;
}
