#!/usr/bin/env bash
# ============================================================
# Instala o Redis (endurecido) na VPS — Debian/Ubuntu
#
# Uso (como root ou com sudo):
#   REDIS_PASSWORD="senha-forte" ./deploy/redis/install-redis.sh
#   ./deploy/redis/install-redis.sh            # senha gerada automaticamente
#
# O que faz:
#   1. Instala o redis-server via apt (se ausente)
#   2. Gera/injeta requirepass no /etc/redis/redis.conf
#   3. Cria usuário redis + diretório /var/lib/redis com permissões corretas
#   4. Instala e ativa o unit do systemd (com hardening)
#   5. Imprime a linha REDIS_URL para o .env do backend
# ============================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Execute como root (sudo)." >&2
  exit 1
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v redis-server > /dev/null 2>&1; then
  echo "==> Instalando redis-server (apt)..."
  apt-get update -qq
  apt-get install -y -qq redis-server
else
  echo "==> redis-server já instalado ($(redis-server --version | awk '{print $3}'))"
fi

REDIS_PASSWORD="${REDIS_PASSWORD:-$(openssl rand -hex 24)}"
echo "==> requirepass: ${REDIS_PASSWORD:0:4}... (confira abaixo se precisar)"

echo "==> Escrevendo /etc/redis/redis.conf (endurecido)..."
mkdir -p /etc/redis
sed "s/__REDIS_PASSWORD__/${REDIS_PASSWORD}/" "$DIR/redis.conf" > /etc/redis/redis.conf
chmod 640 /etc/redis/redis.conf
chown root:redis /etc/redis/redis.conf

echo "==> Preparando /var/lib/redis..."
if ! id redis > /dev/null 2>&1; then
  useradd --system --home-dir /var/lib/redis --shell /usr/sbin/nologin redis
fi
mkdir -p /var/lib/redis
chown redis:redis /var/lib/redis
chmod 750 /var/lib/redis

echo "==> Instalando unit do systemd..."
cp "$DIR/redis.service" /etc/systemd/system/redis.service
systemctl daemon-reload
systemctl enable redis > /dev/null 2>&1 || true

# Se o pacote apt deixou um serviço antigo rodando, reinicia via nosso unit
systemctl restart redis
systemctl --no-pager status redis --lines=0 | head -4

echo
echo "==> Validação: redis-cli -a '<senha>' ping  ->  PONG"
redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping

echo
echo "==> Adicione ao .env do backend:"
echo "REDIS_URL=\"redis://:${REDIS_PASSWORD}@127.0.0.1:6379\""
