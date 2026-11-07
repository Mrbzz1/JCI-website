# Vercel + Supabase deployment

## Supabase setup

1. Run `supabase-migration.sql` in the Supabase SQL Editor. It is additive and does not recreate or delete the existing tables or buckets.
2. Confirm the public buckets `jci-gallery` and `jci-partners` exist.
3. Keep the service-role key server-side only. It must never appear in `public/`, HTML, browser JavaScript, or a client environment variable.

## Vercel environment variables

Add these variables in Vercel Project Settings > Environment Variables for Preview and Production:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
ADMIN_TOKEN=YOUR_LONG_ADMIN_PASSWORD
JWT_SECRET=YOUR_LONG_RANDOM_JWT_SECRET
CORS_ORIGINS=https://YOUR_PROJECT.vercel.app,https://YOUR_CUSTOM_DOMAIN
```

Leave `CORS_ORIGINS` empty only when the API is used same-origin and no separate frontend origin is needed; the server then permits browser requests, while all writes still require JWT authentication. Set it to exact origins for a separate frontend/API deployment. `JCI_API_BASE_URL` is optional; leave it unset for the Vercel same-origin `/api` function.

## Deploy

From the repository root:

```text
npm install
npm run vercel-build
vercel --prod
```

Vercel discovers `api/index.js` as the serverless function. `vercel.json` rewrites `/api/*` to that function and `/admin` to `public/admin.html`. The exported Express app does not call `listen()` on Vercel. Local development still uses `npm start` after setting the server variables from `.env.example` in the shell or a local `.env` loader.

## Existing SQLite data

If `server/data/jci.db` is available, do not delete it. Install dependencies with Node 22 or newer, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then run:

```text
node scripts/migrate-sqlite-to-supabase.js server/data/jci.db
```

The script preserves IDs where possible, uploads BLOBs to the two Storage buckets, skips rows already present by ID, updates statistics, reports failures, and never removes the SQLite file. The script relies on Node's built-in `node:sqlite`; if the old database is unavailable, the data must be exported or restored before migration can succeed.

## Verification

After deployment, check:

```text
https://YOUR_DOMAIN/api/health
https://YOUR_DOMAIN/api/events
https://YOUR_DOMAIN/api/site-stats
https://YOUR_DOMAIN/
https://YOUR_DOMAIN/admin
```

Use the admin page to log in and test event, statistics, gallery, partner, and sponsor writes. Confirm an uploaded image loads through `/api/gallery/:id/image` or `/api/partners/:id/logo`, delete it, and verify both the row and Storage object are gone. Use an invalid Bearer token against each write route to confirm it returns `401`.
