# Deployment — Vercel (frontend) + Railway (API + SQLite)

```
Browser (any device) ──► Vercel: static pages (public/)
        │
        └──────────────► Railway: Express API ──► SQLite file on a persistent Volume
```
The Railway API is the single source of truth. The frontend never uses Vercel's own `/api`.

## Root cause of the original bug
`public/js/runtime-config.js` only receives the API URL if `JCI_API_BASE_URL` is set **at Vercel build time**.
When it was missing, the frontend called `https://jci-oudhref.vercel.app/api/health` (404), then fell back to
per-browser localStorage ("Mode navigateur") — so each device saw only its own data.
Now: no localStorage fallback exists, and a production Vercel build **fails** if the variable is missing or points to Vercel.

## 1. Railway
**Volume** (Service > Volumes): attach one. Railway then injects `RAILWAY_VOLUME_MOUNT_PATH`, which the server uses
automatically. Keep the existing mount path (previously documented: `/app/server/data`) so the existing `jci.db` is reused.

**Variables:**
| Name | Value |
|---|---|
| `ADMIN_TOKEN` | admin password (already set in your current service — keep it) |
| `JWT_SECRET` | long random string (recommended; falls back to ADMIN_TOKEN with a warning) |
| `CORS_ORIGINS` | optional; only for extra origins (custom domain, previews). Default already allows `https://jci-oudhref.vercel.app` |

Start command: `npm start` (default). Optional health check path: `/api/health`.
**Redeploy Railway: YES** (the backend code changed: SQLite restored, PUT/PATCH, validation, backup endpoint).
The schema is unchanged and opened with `CREATE TABLE IF NOT EXISTS`, so existing data is preserved.
Check the deploy log shows `SQLite database: <volume path>/jci.db (volume persistant : oui)`.
If it says `NON`, the volume is not attached — data would be lost on redeploy; fix before using the admin.

## 2. Vercel
Settings > Environment Variables > **Production**: `JCI_API_BASE_URL = https://<your-railway-domain>.up.railway.app`
(no trailing path). **Redeploy Vercel: YES** — it is baked in at build time, so changing it requires a new build.
Do not put `ADMIN_TOKEN`/`JWT_SECRET` in Vercel.

## 3. Verify
1. `https://<railway-domain>/api/health` → 200 `{"ok":true,...,"persistentStorage":true}`
2. DevTools on the Vercel site: requests go to the Railway host, none to `jci-oudhref.vercel.app/api`.
3. Create an event in `/admin` on device A → open the site on device B → visible after refresh.
4. Railway > Restart/Redeploy → data still there.

## 4. Migrating data stored in a browser's localStorage
Only needed if one browser holds content published in the old "browser mode".
1. Open `/admin` **in that same browser**, log in, go to the **Site** tab. A "Migration" panel appears only if legacy data is found.
2. Click **1. Download local backup (JSON)** and keep the file.
3. Click **2. Migrate to the server**. It first creates a server snapshot (`<volume>/backups/`), then uploads only what is missing
   (no duplicates; existing server data and non-zero statistics are never overwritten), then verifies.
4. Only if verification says OK does **3. Erase** appear; erasing is optional and asks for confirmation.
Drafts are excluded unless you tick the checkbox. Manual snapshot any time: `npm run backup` (uses the same volume path) or `POST /api/admin/backup`.

## 5. Behaviour changes in the admin
- Every add/edit/delete is saved to the server immediately; the page updates only after the server confirms.
- "Publier …" buttons became "Actualiser …" (re-read from the server). "Annuler les brouillons" was removed: there are no drafts any more.
- Events can now be edited (Modifier). Renaming/re-dating an event keeps its gallery photos attached.

## API summary (all writes need `Authorization: Bearer <jwt from POST /api/admin/login>`)
`GET /api/health` · `POST /api/admin/login` · `GET /api/admin/check` · `POST /api/admin/backup`
`GET|POST /api/events`, `GET|PUT|PATCH|DELETE /api/events/:id` · `GET|PUT|PATCH /api/site-stats`
`GET|POST /api/gallery`, `GET /api/gallery/:id/image`, `DELETE /api/gallery/:id`
`GET|POST /api/partners`, `PUT|PATCH|DELETE /api/partners/:id`, `GET /api/partners/:id/logo`

## Local development
`ADMIN_TOKEN=dev JWT_SECRET=dev-secret-dev npm start` → http://localhost:3000 (site + admin + API, same origin). Tests: `npm test`.
