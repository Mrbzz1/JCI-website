# JCI Oudhref

Site public de la Jeune Chambre Internationale d’Oudhref, avec une interface d’administration pour gérer l’agenda, la galerie, les statistiques et les partenaires.

## Prérequis

- Node.js 18 ou plus récent
- npm

## Installation

```bash
npm install
```

## Lancement local

Le serveur exige un token d’administration explicite :

```powershell
$env:ADMIN_TOKEN = "un-token-local-fort"
npm start
```

Le site est ensuite disponible sur `http://localhost:3000` et l’administration sur `http://localhost:3000/admin`.

## Fonctionnement

- Express sert les fichiers de `public/`.
- SQLite est initialisée dans `server/data/jci.db`.
- Les routes publiques commencent par `/api/` : agenda, galerie, statistiques et partenaires.
- Les routes d’écriture exigent `X-Admin-Token` ou `Authorization: Bearer <token>`.
- Les images sont stockées dans SQLite, avec une limite de 8 Mo par fichier.

## Variables d’environnement

- `PORT` : port HTTP, `3000` par défaut.
- `ADMIN_TOKEN` : token obligatoire pour l’administration. Il doit être défini dans Railway ou dans l’environnement local.

## Déploiement Railway

Le script de démarrage est déjà configuré dans `package.json` :

```bash
npm start
```

Dans Railway, configure au minimum `ADMIN_TOKEN`. Utilise HTTPS et un token long, aléatoire et différent de celui du développement local.

## Vérification rapide

```bash
curl http://localhost:3000/api/health
```

La réponse attendue contient `"ok": true`.
