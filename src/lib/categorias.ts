export const CATEGORIA_VENDAS = 'VENDAS';
export const CATEGORIA_CANCELAMENTO = 'CANCELAMENTO';
export const CATEGORIA_PADRAO = 'OUTROS';

export function normalizarCategoria(categoria: string | null | undefined, fallback: string = CATEGORIA_PADRAO): string {
  const c = (categoria ?? '').trim().toUpperCase();
  return c || fallback;
}
