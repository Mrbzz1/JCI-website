# Railway Deployment

## Production architecture

Deploy the frontend on Vercel and the existing Express backend on Railway. Railway continues to own the API and SQLite database:

- Public site: Vercel `/`
- Admin: Vercel `/admin`
- API: `/api/*`
- SQLite database: `/app/server/data/jci.db`

## Railway configuration

Create a Railway Volume attached to the service with this mount path:

```text
/app/server/data
```

Set these service variables:

```text
ADMIN_TOKEN=<strong-admin-password>
JWT_SECRET=<long-random-secret>
CORS_ORIGINS=https://YOUR-PROJECT.vercel.app,https://YOUR-CUSTOM-DOMAIN.example
```

`PORT` is provided by Railway automatically. `DB_DIR` is optional; leave it unset when using the volume path above. The startup logs print the exact SQLite path, so verify it in Railway deployment logs.

## Vercel configuration

This repository is a plain static HTML project, not Vite or Next.js. Set this Vercel environment variable for the Production environment:

```text
JCI_API_BASE_URL=https://YOUR-RAILWAY-DOMAIN.up.railway.app
```

The Vercel build writes that value into `public/js/runtime-config.js`. Do not put `ADMIN_TOKEN` or `JWT_SECRET` in Vercel; they belong only in Railway.

Use the generated Railway domain for both public and admin access. Do not manage production data through `localhost`.

## Verification after deployment

Open these URLs using the same Railway domain:

```text
https://YOUR_DOMAIN/api/health
https://YOUR_DOMAIN/api/events
https://YOUR_DOMAIN/
https://YOUR_DOMAIN/admin
```

After creating an event from `/admin`, refresh `/api/events` and `/` to confirm that the data is shared globally. A restart must not delete the event; if it does, the volume mount path is wrong.

The frontend is on Vercel and the API is on Railway, so CORS is required. `CORS_ORIGINS` must contain the exact Vercel production origin(s), including `https://` and without a trailing slash. Do not use `*`.

