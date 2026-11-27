#!/usr/bin/env bash
# Première installation d'Adjamé-Smart sur le serveur de VITE (à lancer en root, une seule fois) :
#   bash /var/www/adjame-smart/as-backend/deploy/install.sh
# Crée le .env (mots de passe générés, jamais affichés), la base (Docker, 127.0.0.1:5441),
# installe et démarre l'API (pm2 « as-api », port 3200), puis publie le back-office, la vitrine et l'espace boutique.
# Sans danger si relancé : un .env ou une base déjà présents sont conservés.
set -euo pipefail

ROOT=/var/www/adjame-smart
CPUSER="${CPUSER:-performx}"
cd "$ROOT/as-backend"

echo "== 1. Réglages (.env)"
if [ -f .env ]; then
  echo "  .env déjà présent : conservé"
else
  cp .env.example .env
  # Valeur écrite telle quelle (les caractères spéciaux des mots de passe ne posent pas de problème)
  set_env() { sed -i "/^$1=/d" .env; printf '%s=%s\n' "$1" "$2" >> .env; }
  set_env PORT 3200
  set_env DB_HOST 127.0.0.1
  set_env DB_PORT 5441
  set_env DB_USER adjame
  set_env DB_NAME adjame_smart
  set_env DB_PASSWORD "$(openssl rand -hex 24)"
  set_env JWT_SECRET "$(openssl rand -hex 48)"
  set_env CORS_ORIGIN "https://sa.vite.ci,https://boutique.vite.ci"
  echo "  Compte Super Admin du back-office (sa.vite.ci) :"
  read -r -p "    Nom : " sa_name
  read -r -p "    Téléphone (10 chiffres, ex. 0701020304) : " sa_phone
  while :; do
    read -r -s -p "    Mot de passe (8 caractères minimum) : " sa_pass; echo
    [ "${#sa_pass}" -ge 8 ] && break
    echo "    Trop court, recommencez."
  done
  set_env SUPER_ADMIN_NAME "${sa_name:-Super Admin}"
  set_env SUPER_ADMIN_PHONE "$sa_phone"
  set_env SUPER_ADMIN_PASSWORD "$sa_pass"
  chmod 600 .env
  echo "  .env créé (mots de passe de la base et des sessions générés automatiquement)"
fi

echo "== 2. Base de données (Docker)"
# Docker ne lit que les réglages de la base (les autres valeurs peuvent contenir des caractères spéciaux)
grep -E '^DB_' .env > deploy/.db.env && chmod 600 deploy/.db.env
docker compose --env-file deploy/.db.env -f deploy/docker-compose.prod.yml up -d
for i in $(seq 1 30); do
  docker compose --env-file deploy/.db.env -f deploy/docker-compose.prod.yml exec -T db pg_isready -q && break
  sleep 1
done
docker compose --env-file deploy/.db.env -f deploy/docker-compose.prod.yml exec -T db sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"'
echo "  ✓ base prête (recherche rapide activée)"

echo "== 3. API"
npm ci --no-audit --no-fund
npm run build
mkdir -p uploads
if pm2 describe as-api >/dev/null 2>&1; then pm2 reload as-api --update-env; else pm2 start deploy/ecosystem.config.cjs; fi
pm2 save >/dev/null
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3200/categories || true)
  [ "$code" = 200 ] && break
  sleep 1
done
[ "$code" = 200 ] && echo "  ✓ API démarrée sur le port 3200" || { echo "  ✗ L'API ne répond pas : pm2 logs as-api --lines 40"; exit 1; }

echo "== 4. Back-office, vitrine et espace boutique"
cd "$ROOT"
[ -d as-frontend ] || git clone https://github.com/joeldjebi/as-frontend.git
cd "$ROOT/as-backend"
CPUSER="$CPUSER" bash deploy/update.sh

echo
echo "Adjamé-Smart est en ligne :"
echo "  https://as.vite.ci        vitrine"
echo "  https://sa.vite.ci        back-office (Super Admin)"
echo "  https://api.as.vite.ci    API"
