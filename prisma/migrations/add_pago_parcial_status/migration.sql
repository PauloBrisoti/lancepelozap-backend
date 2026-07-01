-- Allow PAGO_PARCIAL status on accounts_receivable
UPDATE accounts_receivable 
SET status = 'PAGO_PARCIAL' 
WHERE status = 'PAGO' 
AND id IN (
  SELECT ar.id FROM accounts_receivable ar
  LEFT JOIN financial_transactions ft ON ft.receivable_id = ar.id AND ft.tipo = 'ENTRADA' AND ft.status = 'ATIVA'
  GROUP BY ar.id
  HAVING COALESCE(SUM(ft.valor), 0) < ar.valor_parcela
);

UPDATE accounts_receivable 
SET status = 'PAGO_PARCIAL' 
WHERE status = 'PENDENTE' 
AND id IN (
  SELECT ar.id FROM accounts_receivable ar
  INNER JOIN financial_transactions ft ON ft.receivable_id = ar.id AND ft.tipo = 'ENTRADA' AND ft.status = 'ATIVA'
  GROUP BY ar.id
  HAVING COALESCE(SUM(ft.valor), 0) > 0 AND COALESCE(SUM(ft.valor), 0) < ar.valor_parcela
);
