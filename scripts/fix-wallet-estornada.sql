-- ============================================================
-- CORREÇÃO RETROATIVA DE CARTEIRAS - Transações ESTORNADA sem sale_id
-- ============================================================
-- Problema: 4 transações ESTORNADA criadas pelo fluxo de cancelamento
-- de vendas não decrementaram o saldo da carteira, deixando-a inflada.
--
-- Impacto: R$437,09 total (Velour R$247,09 + Paulo Barbosa R$190,00)
--
-- USO:
--   dry-run (simulação):  psql -f fix-wallet-estornada.sql -v dry_run=true
--   aplicar:              psql -f fix-wallet-estornada.sql
-- ============================================================

\echo '========================================'
\echo 'CORREÇÃO DE CARTEIRAS - ESTORNADA sem sale_id'
\echo '========================================'

-- Modo dry-run por padrão (precisa passar -v dry_run=false para aplicar)
\if :dry_run is null
  \set dry_run true
\endif

\if :dry_run
  \echo ''
  \echo '>>> MODO DRY-RUN (nenhuma alteração será feita) <<<'
  \echo ''
\else
  \echo ''
  \echo '>>> MODO APLICAR - ALTERAÇÕES SERÃO GRAVADAS NO BANCO <<<'
  \echo ''
\endif

-- -----------------------------------------------------------
-- 1. Diagnóstico: mostrar transações problemáticas
-- -----------------------------------------------------------
\echo '--- Transações ESTORNADA sem sale_id ---'
SELECT
  ft.id,
  ft.store_id,
  s.nome_fantasia AS loja,
  ft.wallet_id,
  w.nome AS carteira,
  ft.valor,
  ft.status,
  ft.descricao,
  ft.created_at
FROM financial_transactions ft
JOIN stores s ON s.id = ft.store_id
JOIN wallets w ON w.id = ft.wallet_id
WHERE ft.status = 'ESTORNADA'
  AND ft.sale_id IS NULL
  AND ft.descricao LIKE '%Estorno%cancelamento%'
ORDER BY ft.created_at;

-- -----------------------------------------------------------
-- 2. Saldo atual das carteiras afetadas
-- -----------------------------------------------------------
\echo ''
\echo '--- Saldo atual das carteiras afetadas ---'
SELECT
  w.id,
  w.nome,
  s.nome_fantasia AS loja,
  w.saldo_atual,
  CASE
    WHEN w.saldo_atual < 0 THEN 'DEVEDORA'
    ELSE 'POSITIVA'
  END AS situacao
FROM wallets w
JOIN stores s ON s.id = w.store_id
WHERE w.id IN (
  SELECT DISTINCT ft.wallet_id
  FROM financial_transactions ft
  WHERE ft.status = 'ESTORNADA'
    AND ft.sale_id IS NULL
    AND ft.descricao LIKE '%Estorno%cancelamento%'
);

-- -----------------------------------------------------------
-- 3. Cálculo do impacto por carteira
-- -----------------------------------------------------------
\echo ''
\echo '--- Impacto por carteira (débito necessário) ---'
SELECT
  w.id AS wallet_id,
  w.nome AS carteira,
  s.nome_fantasia AS loja,
  SUM(ft.valor) AS total_estornado,
  w.saldo_atual AS saldo_atual,
  ROUND(w.saldo_atual - SUM(ft.valor), 2) AS saldo_corrigido
FROM financial_transactions ft
JOIN wallets w ON w.id = ft.wallet_id
JOIN stores s ON s.id = w.store_id
WHERE ft.status = 'ESTORNADA'
  AND ft.sale_id IS NULL
  AND ft.descricao LIKE '%Estorno%cancelamento%'
GROUP BY w.id, w.nome, s.nome_fantasia, w.saldo_atual;

-- -----------------------------------------------------------
-- 4. Correção: decrementar saldo das carteiras
-- -----------------------------------------------------------
\if :dry_run
  \echo ''
  \echo '>>> [DRY-RUN] Nenhuma UPDATE executada. Para aplicar, reexe com -v dry_run=false <<<'
\else
  \echo ''
  \echo '--- Aplicando correção ---'

  -- Backup das carteiras antes da correção
  CREATE TABLE IF NOT EXISTS wallet_balance_backup_20260910 AS
  SELECT w.id, w.nome, w.saldo_atual, NOW() AS backup_at
  FROM wallets w
  WHERE w.id IN (
    SELECT DISTINCT ft.wallet_id
    FROM financial_transactions ft
    WHERE ft.status = 'ESTORNADA'
      AND ft.sale_id IS NULL
      AND ft.descricao LIKE '%Estorno%cancelamento%'
  );

  -- Aplicar débito
  UPDATE wallets w
  SET saldo_atual = ROUND(w.saldo_atual - sub.total_estornado, 2),
      updated_at = NOW()
  FROM (
    SELECT ft.wallet_id, SUM(ft.valor) AS total_estornado
    FROM financial_transactions ft
    WHERE ft.status = 'ESTORNADA'
      AND ft.sale_id IS NULL
      AND ft.descricao LIKE '%Estorno%cancelamento%'
    GROUP BY ft.wallet_id
  ) sub
  WHERE w.id = sub.wallet_id;

  \echo ''
  \echo '--- Saldo após correção ---'
  SELECT
    w.id,
    w.nome,
    s.nome_fantasia AS loja,
    w.saldo_atual AS saldo_corrigido
  FROM wallets w
  JOIN stores s ON s.id = w.store_id
  WHERE w.id IN (
    SELECT DISTINCT ft.wallet_id
    FROM financial_transactions ft
    WHERE ft.status = 'ESTORNADA'
      AND ft.sale_id IS NULL
      AND ft.descricao LIKE '%Estorno%cancelamento%'
  );

  \echo ''
  \echo '>>> Correção aplicada com sucesso <<<'
  \echo '>>> Backup salvo em wallet_balance_backup_20260910 <<<'
\endif

-- -----------------------------------------------------------
-- 5. Verificação final
-- -----------------------------------------------------------
\echo ''
\echo '--- Verificação: alguma ESTORNADA sem sale_id ainda existe? ---'
SELECT COUNT(*) AS transacoes_estornada_sem_sale_id
FROM financial_transactions
WHERE status = 'ESTORNADA'
  AND sale_id IS NULL
  AND descricao LIKE '%Estorno%cancelamento%';
