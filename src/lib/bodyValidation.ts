/**
 * Validação de payload de updates com allow-list explícita,
 * eliminando o bloco repetido de Object.keys(body).filter(...) dos controllers.
 */

/**
 * Rejeita campos desconhecidos/sensíveis em updates (allow-list explícita).
 * Retorna a lista de campos extras, ou null se o payload é válido.
 *
 *   const extra = rejectUnknownFields(req.body, ['nome', 'ativo']);
 *   if (extra) return res.status(400).json({ error: `Campos não permitidos: ${extra.join(', ')}` });
 */
export function rejectUnknownFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): string[] | null {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  return extra.length > 0 ? extra : null;
}
