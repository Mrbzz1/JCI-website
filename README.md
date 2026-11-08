# JCI Oudhref

Site de la Jeune Chambre Internationale d’Oudhref : agenda, galerie, chiffres, partenaires, et administration.

- **Frontend** : pages statiques dans `public/` (Vercel).
- **Backend** : Express + SQLite dans `server/` (Railway, base sur un Volume persistant). Source unique des données.
- Les appareils lisent tous la même API ; aucun contenu partagé n’est stocké dans le navigateur.

Démarrage local : `ADMIN_TOKEN=dev JWT_SECRET=dev-secret-dev npm start` puis http://localhost:3000 et /admin.
Tests : `npm test`. Sauvegarde de la base : `npm run backup`.
Déploiement, variables d’environnement et migration : voir **DEPLOYMENT.md**.
