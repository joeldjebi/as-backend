# Déploiement d'Adjamé-Smart (serveur LETO)

Sur le même serveur que LETO, à côté : base séparée, process pm2 `as-api`, port 3100.

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

- `api.as.performx.online` → proxy vers `http://127.0.0.1:3100` (même configuration Apache que l'API LETO).
- `admin.as.performx.online` → dossier `/home/performx/public_html/admin.as.performx.online` (back-office).
- Certificats SSL (AutoSSL) pour les deux.

## 4. Mises à jour

```bash
cd /var/www/adjame-smart/as-backend && git pull --ff-only && bash deploy/update.sh
```
