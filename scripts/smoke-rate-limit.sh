#!/usr/bin/env bash
# ============================================================
# Smoke test pós-deploy — Rate limiting distribuído + jobs/cron
#
# Uso:
#   BASE_URL="https://api.seudominio.com.br" \
#   CRON_SECRET="..." \
#   ./scripts/smoke-rate-limit.sh
#
# Opcionais:
#   EXECUTE_JOBS=1   também executa os jobs reais (ATENÇÃO: podem
#                    disparar WhatsApp/e-mail/boletos em produção)
#   REDIS_PASSWORD=...  verifica os contadores rl:* no Redis
#                       (precisa rodar na própria VPS)
# ============================================================
set -euo pipefail

BASE_URL="${BASE_URL:?Defina BASE_URL (ex: https://api.seudominio.com.br)}"
CRON_SECRET="${CRON_SECRET:?Defina CRON_SECRET}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; NC='\033[0m'
PASS=0; FAIL=0; SKIP=0

check() { # $1 descricao, $2 esperado, $3 obtido
  if [[ "$3" == "$2" ]]; then
    echo -e "${GREEN}PASS${NC} $1"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}FAIL${NC} $1 (esperado: $2, obtido: $3)"
    FAIL=$((FAIL + 1))
  fi
}

code() { # curl com corpo em /tmp e status na stdout
  curl -s -o /tmp/smoke_body.$$ -w '%{http_code}' "$@"
}

echo "==> Base: $BASE_URL"
echo "==> 1. Healthcheck"
check "GET /health responde 200" 200 "$(code "$BASE_URL/health")"

echo "==> 2. Jobs/cron — autenticação"
check "sem Authorization -> 401"  401 "$(code -X POST "$BASE_URL/api/jobs/ping")"
check "segredo errado -> 403"     403 "$(code -X POST "$BASE_URL/api/jobs/ping" -H "Authorization: Bearer segredo-errado")"
check "query string bloqueada -> 400" 400 "$(code -X POST "$BASE_URL/api/jobs/ping?smoke=1" -H "Authorization: Bearer $CRON_SECRET")"
BODY=$(curl -s -X POST "$BASE_URL/api/jobs/ping" -H "Authorization: Bearer $CRON_SECRET")
STATUS=$(code -X POST "$BASE_URL/api/jobs/ping" -H "Authorization: Bearer $CRON_SECRET")
check "Bearer correto -> 200" 200 "$STATUS"
if [[ "$BODY" == *'"ok":true'* ]]; then
  echo -e "${GREEN}PASS${NC} corpo do ping contém ok:true"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC} corpo do ping não contém ok:true (obtido: $BODY)"
  FAIL=$((FAIL + 1))
fi

if [[ "${EXECUTE_JOBS:-0}" == "1" ]]; then
  echo "==> 3. Jobs reais (EXECUTE_JOBS=1 — efeitos colaterais possíveis)"
  check "pet-lembretes -> 200" 200 "$(code -X POST "$BASE_URL/api/jobs/pet-lembretes" -H "Authorization: Bearer $CRON_SECRET")"
  check "pet-recorrencia -> 200" 200 "$(code -X POST "$BASE_URL/api/jobs/pet-recorrencia" -H "Authorization: Bearer $CRON_SECRET")"
  check "varredura-financeira -> 200" 200 "$(code -X POST "$BASE_URL/api/jobs/varredura-financeira" -H "Authorization: Bearer $CRON_SECRET")"
else
  echo -e "${YELLOW}SKIP${NC} jobs reais (defina EXECUTE_JOBS=1 para executar)"
  SKIP=$((SKIP + 1))
fi

echo "==> 4. Rate limit de login (10/min por IP)"
EMAIL="smoke-$(date +%s)@exemplo.com"
for _ in $(seq 1 10); do
  code -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"senha-errada\"}" > /dev/null
done
STATUS_429=$(code -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"senha-errada\"}")
check "11º login no mesmo minuto -> 429" 429 "$STATUS_429"
RETRY_AFTER=$(curl -s -D - -o /dev/null -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"senha-errada\"}" \
  | grep -i '^retry-after:' | tr -d '\r' | awk '{print $2}')
if [[ -n "$RETRY_AFTER" ]]; then
  echo -e "${GREEN}PASS${NC} cabeçalho Retry-After presente ($RETRY_AFTER s)"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC} cabeçalho Retry-After ausente no 429"
  FAIL=$((FAIL + 1))
fi

if [[ -n "${REDIS_PASSWORD:-}" ]]; then
  echo "==> 5. Contadores no Redis"
  KEYS=$(redis-cli -a "$REDIS_PASSWORD" --no-auth-warning keys 'rl:*' 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$KEYS" -gt 0 ]]; then
    echo -e "${GREEN}PASS${NC} $KEYS chaves rl:* presentes no Redis"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}FAIL${NC} nenhuma chave rl:* encontrada (rate limit não está usando Redis?)"
    FAIL=$((FAIL + 1))
  fi
else
  echo -e "${YELLOW}SKIP${NC} verificação do Redis (defina REDIS_PASSWORD e rode na VPS)"
  SKIP=$((SKIP + 1))
fi

echo
echo "Resumo: $PASS PASS, $FAIL FAIL, $SKIP SKIP"
[[ "$FAIL" -eq 0 ]]
