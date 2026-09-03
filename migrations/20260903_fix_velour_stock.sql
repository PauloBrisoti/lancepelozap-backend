-- Migration: Fix Velour stock_movements
-- Store: cmqvdlgnv00028gl24va1b9eq (Velour)
-- Date: 2026-09-03
-- Description: Clean up duplicate/orphaned stock_movements and recalculate from source data

BEGIN;

-- 1. DELETE all existing stock_movements for Velour store
DELETE FROM stock_movements WHERE store_id = 'cmqvdlgnv00028gl24va1b9eq';

-- 2. INSERT ENTRADA movements from received purchase_order_items
-- Using 0 as placeholder for saldo (will recalculate below)
INSERT INTO stock_movements (id, store_id, product_id, user_id, tipo, quantidade, saldo_anterior, saldo_posterior, referencia_id, motivo, observacao, created_at)
SELECT 
  gen_random_uuid()::text,
  'cmqvdlgnv00028gl24va1b9eq',
  poi.product_id,
  'cmqvdlgny00038gl2cuf1ptot',
  'ENTRADA',
  poi.quantidade,
  0,
  0,
  po.id,
  'Recebimento de compra',
  NULL,
  po.created_at
FROM purchase_order_items poi
JOIN purchase_orders po ON po.id = poi.purchase_order_id
WHERE po.status = 'RECEBIDO'
  AND po.store_id = 'cmqvdlgnv00028gl24va1b9eq';

-- 3. INSERT SAIDA movements from finalized sale_items
INSERT INTO stock_movements (id, store_id, product_id, user_id, tipo, quantidade, saldo_anterior, saldo_posterior, referencia_id, motivo, observacao, created_at)
SELECT 
  gen_random_uuid()::text,
  'cmqvdlgnv00028gl24va1b9eq',
  si.product_id,
  'cmqvdlgny00038gl2cuf1ptot',
  'SAIDA',
  si.quantidade,
  0,
  0,
  s.id,
  'Venda',
  NULL,
  s.data_venda
FROM sale_items si
JOIN sales s ON s.id = si.sale_id
WHERE s.store_id = 'cmqvdlgnv00028gl24va1b9eq'
  AND s.status = 'FINALIZADA';

-- 4. Recalculate saldo_anterior and saldo_posterior per product
-- Using window functions over created_at order
WITH ordered_movements AS (
  SELECT 
    id,
    product_id,
    tipo,
    quantidade,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY created_at, id) as rn
  FROM stock_movements
  WHERE store_id = 'cmqvdlgnv00028gl24va1b9eq'
),
running_balance AS (
  SELECT 
    id,
    product_id,
    tipo,
    quantidade,
    rn,
    SUM(CASE WHEN tipo = 'ENTRADA' THEN quantidade ELSE -quantidade END) 
      OVER (PARTITION BY product_id ORDER BY rn) as running_total
  FROM ordered_movements
),
balances AS (
  SELECT 
    id,
    product_id,
    running_total,
    quantidade,
    tipo,
    LAG(running_total, 1, 0) OVER (PARTITION BY product_id ORDER BY rn) as prev_balance
  FROM running_balance
)
UPDATE stock_movements sm
SET saldo_anterior = b.prev_balance,
    saldo_posterior = b.running_total
FROM balances b
WHERE sm.id = b.id;

-- 5. UPDATE products qtd_estoque_atual based on calculated stock
UPDATE products p
SET qtd_estoque_atual = COALESCE(entradas.total_entrada, 0) - COALESCE(saidas.total_saida, 0)
FROM (
  SELECT 
    product_id,
    SUM(quantidade) as total_entrada
  FROM stock_movements
  WHERE store_id = 'cmqvdlgnv00028gl24va1b9eq'
    AND tipo = 'ENTRADA'
  GROUP BY product_id
) entradas
LEFT JOIN (
  SELECT 
    product_id,
    SUM(quantidade) as total_saida
  FROM stock_movements
  WHERE store_id = 'cmqvdlgnv00028gl24va1b9eq'
    AND tipo = 'SAIDA'
  GROUP BY product_id
) saidas ON entradas.product_id = saidas.product_id
WHERE p.id = entradas.product_id
  AND p.store_id = 'cmqvdlgnv00028gl24va1b9eq';

-- Also set to 0 for products that have no movements
UPDATE products 
SET qtd_estoque_atual = 0
WHERE store_id = 'cmqvdlgnv00028gl24va1b9eq'
  AND id NOT IN (
    SELECT DISTINCT product_id 
    FROM stock_movements 
    WHERE store_id = 'cmqvdlgnv00028gl24va1b9eq'
  );

COMMIT;
