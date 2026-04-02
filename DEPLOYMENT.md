# Project Restructuring for Railway Deployment

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
- `ADMIN_TOKEN` - Set to your desired admin token (defaults to 'jci2026')

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
JCI Oudref server running on port 3000
API health check: http://localhost:3000/api/health
```

## Next Steps (Optional Cleanup)
You can remove the original files from the root directory after verifying everything works:
- `Global.css` (original in root)
- `jci.png`, `bureauexecutif.jpg`, `facebook.png`, `instagram.png`, `linkedin.png`

These are now in `public/` and can be safely deleted from the root.
