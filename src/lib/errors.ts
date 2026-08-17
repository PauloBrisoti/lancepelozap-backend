/** Extrai mensagem legível de um erro desconhecido. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Erro desconhecido';
}

/** Extrai código (ex.: Prisma P2003) de um erro desconhecido. */
export function getErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    return String((err as { code: unknown }).code);
  }
  return undefined;
}
