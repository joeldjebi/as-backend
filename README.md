# Adjamé-Smart — API

Marketplace des boutiques et grossistes d'Adjamé, livrée par VITE. NestJS + PostgreSQL.

## Développement

```bash
cp .env.example .env   # remplir DB_*, JWT_SECRET, SUPER_ADMIN_*
npm install
npm run start:dev      # http://127.0.0.1:3100
```

Le schéma de la base est créé au démarrage (`DB_SYNC=true`). Le premier Super Admin vient du `.env`. Les 12 catégories du lancement sont créées si la table est vide.

## Phase 1 (socle)

| Domaine | Routes |
| --- | --- |
| Comptes | `POST /auth/register`, `POST /auth/login` (app), `POST /auth/admin/login` (back-office), `GET/PATCH /auth/me`, adresses `POST/DELETE /auth/me/addresses`, statut revendeur `POST /auth/me/reseller` |
| Catégories | `GET /categories` (public), gestion `POST/PATCH/DELETE /categories` (équipe) |
| Boutiques | vendeur : `POST /shops`, `GET /shops/mine`, `PATCH /shops/mine/:id`, `POST /shops/mine/:id/submit` ; équipe : `GET /shops/admin`, `GET /shops/admin/:id`, `approve` / `reject` / `suspend` / `reactivate` ; public : `GET /shops`, `GET /shops/:slug`, `GET /shops/meta` |
| Équipe | `GET /admin/dashboard`, clients, revendeurs (`approve` / `reject`), équipe (`SUPER_ADMIN` seulement pour l'ajout) |
| Photos | `POST /uploads` (publiques), `POST /uploads/identity` (pièces, lien signé de 15 min pour l'équipe) |

Rôles : `CUSTOMER` (client ; vendeur s'il ouvre une boutique), `ADMIN` avec `staffRole` `SUPER_ADMIN`, `MODERATOR` ou `SUPPORT`.

## Production

Voir [DEPLOIEMENT.md](DEPLOIEMENT.md).
