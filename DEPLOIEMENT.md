# Déploiement d'Adjamé-Smart (serveur VITE)

Sur le même serveur que VITE, à côté : base séparée, process pm2 `as-api`, port 3200 (3100 et 3110 sont déjà pris sur le serveur).

## 1. Base de données (une fois)

```bash
sudo -u postgres psql -c "CREATE USER adjame WITH PASSWORD '<mot de passe>';"
sudo -u postgres psql -c "CREATE DATABASE adjame_smart OWNER adjame;"
```

## 2. Code (une fois)

```bash
mkdir -p /var/www/adjame-smart && cd /var/www/adjame-smart
git clone https://github.com/joeldjebi/as-backend.git
git clone https://github.com/joeldjebi/as-frontend.git
cd as-backend && cp .env.example .env   # remplir : DB_*, JWT_SECRET (long et aléatoire), SUPER_ADMIN_*, CORS_ORIGIN, Wasabi
npm ci && npm run build && pm2 start deploy/ecosystem.config.cjs && pm2 save
```

## 3. Domaines (cPanel)

- `api.as.vite.ci` → relais vers `http://127.0.0.1:3200` (script `deploy/cpanel/setup-vite-ci.sh` du dépôt leto-backend).
- `sa.vite.ci` → back-office ; `as.vite.ci` → vitrine ; `boutique.vite.ci` → espace boutique (dossiers `/home/performx/public_html/<domaine>`).
- Certificats SSL (AutoSSL).

## 4. Mises à jour

```bash
cd /var/www/adjame-smart/as-backend && git pull --ff-only && bash deploy/update.sh
```
