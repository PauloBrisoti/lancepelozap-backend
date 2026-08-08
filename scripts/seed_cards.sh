#!/bin/bash
# SEGURANÇA: credenciais vêm do .env (nunca hardcoded no script)
# Carrega as variáveis do .env do backend
set -a
[ -f .env ] && source .env
set +a
cd /opt/saas/backend
npx tsx scripts/seed_cards.ts
