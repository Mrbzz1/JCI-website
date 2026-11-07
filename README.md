# JCI Oudhref

Site public de la Jeune Chambre Internationale d’Oudhref, avec une interface d’administration pour gérer l’agenda, la galerie, les statistiques et les partenaires.

## Prérequis

- Node.js 22 ou plus récent (required for the optional SQLite migration script)
- npm

## Installation

```bash
npm install
```

## Lancement local

Le serveur exige un token d’administration explicite :

```powershell
$env:SUPABASE_URL = "https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "YOUR_SERVICE_ROLE_KEY"
$env:ADMIN_TOKEN = "un-token-local-fort"
$env:JWT_SECRET = "un-secret-jwt-long-et-aleatoire"
npm start
```

Le site est ensuite disponible sur `http://localhost:3000` et l’administration sur `http://localhost:3000/admin`.

## Fonctionnement

- Express sert les fichiers de `public/` en local et est exporté comme fonction serverless via `api/index.js` sur Vercel.
- Supabase PostgreSQL stocke les données et Supabase Storage stocke les images dans `jci-gallery` et `jci-partners`.
- Les routes publiques commencent par `/api/` : agenda, galerie, statistiques et partenaires. En production Vercel, elles utilisent le même domaine ; `JCI_API_BASE_URL` est seulement nécessaire pour une API hébergée séparément.
- Les routes d’écriture exigent `Authorization: Bearer <token>`.
- Les uploads sont limités à 8 Mo par fichier et protégés par JWT.

## Variables d’environnement

- `PORT` : port HTTP, `3000` par défaut.
- `SUPABASE_URL` : URL du projet Supabase.
- `SUPABASE_SERVICE_ROLE_KEY` : clé secrète, uniquement côté serveur.
- `ADMIN_TOKEN` : mot de passe d’administration.
- `JWT_SECRET` : secret de signature JWT.
- `CORS_ORIGINS` : origines frontend autorisées, séparées par des virgules.
- `JCI_API_BASE_URL` : URL d’une API séparée, généralement vide sur Vercel.

## Déploiement Vercel

Le script de build et la fonction API sont déjà configurés :

```bash
npm run vercel-build
```

Ajoute les variables serveur dans Vercel Project Settings > Environment Variables. Utilise HTTPS et des secrets longs et aléatoires. Voir `DEPLOYMENT.md` pour la migration SQLite facultative et les tests.

## Vérification rapide

```bash
curl http://localhost:3000/api/health
```

La réponse attendue contient `"ok": true`.
