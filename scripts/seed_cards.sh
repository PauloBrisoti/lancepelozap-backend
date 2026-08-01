#!/bin/bash
export DATABASE_URL="postgresql://saas_admin:***@127.0.0.1:5432/saas_db"
cd /opt/saas/backend
npx tsx scripts/seed_cards.ts
