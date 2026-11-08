const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createAuth } = require('./auth');
const { backupDatabase } = require('./db');

const rootDir = path.join(__dirname, '..');

/** Build the Express app. `db` and `config` are injected so tests can use a temp database. */
function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Railway sits behind a proxy; needed for correct client IPs (login rate limit)

  const auth = createAuth(config);
  const deps = { db, config, requireAdmin: auth.requireAdmin };

  // CORS: exact-origin allowlist. No wildcard, and no cookies/credentials are used (Bearer token auth).
  const corsOptions = {
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
    maxAge: 600
  };
  app.use(cors((req, callback) => {
    const origin = req.header('Origin');
    const clean = origin ? origin.replace(/\/+$/, '') : '';
    const sameOrigin = clean && clean === `${req.protocol}://${req.get('host')}`; // site served by this same host
    if (!origin || sameOrigin || config.corsOrigins.has(clean)) return callback(null, { ...corsOptions, origin: true });
    callback(Object.assign(new Error('Origine non autorisée par CORS.'), { status: 403 }));
  }));

  app.use(express.json({ limit: '100kb' }));

  // Every API response is fresh: a device must never be served another device's stale copy from a cache.
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // …except image bytes, which are immutable per id (routes below re-set Cache-Control for them).

  app.get('/api/health', (req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ ok: true, service: 'jci-oudhref', database: 'ok', persistentStorage: config.persistentStorage, time: new Date().toISOString() });
    } catch {
      res.status(503).json({ ok: false, service: 'jci-oudhref', database: 'error' });
    }
  });

  app.post('/api/admin/login', auth.login);
  app.get('/api/admin/check', auth.requireAdmin, (req, res) => res.json({ ok: true }));
  app.post('/api/admin/backup', auth.requireAdmin, async (req, res, next) => {
    try {
      res.status(201).json({ ok: true, ...(await backupDatabase(db, config.dataDir, 'manual')) });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/events', require('./routes/events')(deps));
  app.use('/api/site-stats', require('./routes/stats')(deps));
  app.use('/api/gallery', require('./routes/gallery')(deps));
  app.use('/api/partners', require('./routes/partners')(deps));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Route API introuvable.' }));

  // When the API host also serves the site (local dev / Railway domain), the page and API are same-origin.
  app.get('/js/runtime-config.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'no-store')
      .send('window.JCI_CONFIG = { apiBaseUrl: "", sameOrigin: true };\n');
  });
  app.use(express.static(path.join(rootDir, 'public')));
  app.get('/admin', (req, res) => res.sendFile(path.join(rootDir, 'public', 'admin.html')));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(rootDir, 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse.' });
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? `Image trop lourde (max ${Math.round(config.maxImageBytes / 1048576)} Mo).` : `Envoi invalide (${err.code}).` });
    }
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error('[api error]', req.method, req.originalUrl, err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  });

  return app;
}

module.exports = { createApp };
