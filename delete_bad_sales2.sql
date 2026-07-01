BEGIN;
DELETE FROM financial_transactions WHERE sale_id IN (SELECT id FROM sales WHERE status != 'CANCELADA');
DELETE FROM accounts_receivable WHERE sale_id IN (SELECT id FROM sales WHERE status != 'CANCELADA');
DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE status != 'CANCELADA');
DELETE FROM sales WHERE status != 'CANCELADA';
COMMIT;
