/**
 * Helpers para eliminar o boilerplate repetido de try/catch + logger.error +
 * res.status(500) e a verificação manual de storeId que se repetia em ~70
 * handlers e 85 pontos de controllers.
 */

import { Request, Response } from "express";
import { logger } from "./logger";

/** Erro com status HTTP explícito (ex.: 401, 404, 400). */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Extrai o storeId do token autenticado (requireAuth já garante req.user).
 * Lança HttpError 401 se ausente — tratado centralmente pelo asyncHandler.
 */
export function getStoreId(req: Request): string {
  const storeId = req.user?.storeId as string | undefined;
  if (!storeId) {
    throw new HttpError("Loja não identificada", 401);
  }
  return storeId;
}

/**
 * Envolve um handler de controller com try/catch centralizado:
 *  - HttpError -> responde com o statusCode e mensagem do erro
 *  - qualquer outro erro -> loga com `logger.error` e responde 500
 *
 * Uso:
 *   list: asyncHandler(async (req, res) => {
 *     const storeId = getStoreId(req);
 *     res.json(await prisma.category.findMany({ where: { storeId } }));
 *   }, "listar categorias")
 */
export const asyncHandler = (
  fn: (req: Request, res: Response) => Promise<unknown>,
  label: string,
) => async (req: Request, res: Response): Promise<void> => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }
    logger.error(`Erro ao ${label}:`, error);
    res.status(500).json({ message: "Erro interno do servidor" });
  }
};
