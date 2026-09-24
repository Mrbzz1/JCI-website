# Railway Deployment

## Production architecture

Deploy the complete project as one Railway service. Express serves both the public site and the admin page:

- Public site: `/`
- Admin: `/admin`
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
```

`PORT` is provided by Railway automatically. `DB_DIR` is optional; leave it unset when using the volume path above. The startup logs print the exact SQLite path, so verify it in Railway deployment logs.

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

The frontend and API share the same origin, so CORS configuration is not required.

## Repository layout

## Changes Made

### 1. **Moved Static Assets to `public/` Directory**
   - `Global.css` → `public/Global.css`
   - `jci.png` → `public/jci.png`
   - `bureauexecutif.jpg` → `public/bureauexecutif.jpg`
   - `facebook.png` → `public/facebook.png`
   - `instagram.png` → `public/instagram.png`
   - `linkedin.png` → `public/linkedin.png`
   - `js/` → `public/js/`

### 2. **Updated Server Configuration (`server/server.js`)**
   - Changed static file serving to specifically serve from the `public/` directory
   - Updated from: `app.use(express.static(rootDir, { index: 'index.html' }))`
   - Updated to: `app.use(express.static(path.join(rootDir, 'public')))`
   - Added proper SPA routing to serve `index.html` for all non-API routes
   - Fixed console output for better clarity

### 3. **Project Structure**
```
jci web/
├── public/                    # All static assets served by Express
│   ├── index.html             # Entry point
│   ├── Global.css
│   ├── jci.png
│   ├── bureauexecutif.jpg
│   ├── facebook.png
│   ├── instagram.png
│   ├── linkedin.png
│   └── js/
│       └── jci-data.js
├── server/
│   ├── server.js              # Express server configuration
│   └── db.js                  # Database initialization
├── admin/
│   └── admin.html
├── package.json               # Root package.json with start script
└── Global.css                 # (Original - can be removed after verification)
```

## Railway Deployment

### Environment Variables
Make sure these are set in Railway:
- `PORT` - Automatically set by Railway (defaults to 3000 locally)
- `ADMIN_TOKEN` - Set to a strong, unique admin token. The server refuses to start if it is missing.

### Start Command
The `package.json` is configured to run:
```bash
npm start
# Which executes: node server/server.js
```

### How It Works
1. Express serves static files (CSS, images, JS) from the `public/` directory
2. API routes (`/api/*`) are handled by the server
3. All other routes return `public/index.html` for SPA support
4. CSS and assets are properly linked and will be accessible at their relative paths

## Verification
The server successfully starts and logs:
```
JCI Oudhref server running on port 3000
API health check: http://localhost:3000/api/health
```
## Next Steps (Optional Cleanup)
You can remove the original files from the root directory after verifying everything works:
- `Global.css` (original in root)
- `jci.png`, `bureauexecutif.jpg`, `facebook.png`, `instagram.png`, `linkedin.png`

These are now in `public/` and can be safely deleted from the root.
