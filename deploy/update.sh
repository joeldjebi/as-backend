#!/usr/bin/env bash
# Mise à jour d'Adjamé-Smart en production (API + back-office) : bash deploy/update.sh
set -euo pipefail
ROOT=/var/www/adjame-smart
ADMIN_DIR="${ADMIN_DIR:-/home/performx/public_html/admin.as.performx.online}"
CPUSER="${CPUSER:-performx}"

echo "== API"
cd "$ROOT/as-backend"
git pull --ff-only
npm ci
npm run build
pm2 reload as-api --update-env || pm2 start deploy/ecosystem.config.cjs

echo "== Back-office"
cd "$ROOT/as-frontend"
git pull --ff-only
npm ci
npm run build
mkdir -p "$ADMIN_DIR"
rsync -a --delete --exclude ".well-known" dist/ "$ADMIN_DIR/"
chown -R "$CPUSER:$CPUSER" "$ADMIN_DIR"
echo "Mise à jour terminée."
