const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'jci2026';

const rootDir = path.join(__dirname, '..');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

app.use(express.json({ limit: '1mb' }));

function getToken(req) {
  const h = req.headers['x-admin-token'];
  if (h) return String(h);
  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return '';
}

function requireAdmin(req, res, next) {
  if (getToken(req) !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'jci-oudref' });
});

app.get('/api/site-stats', (req, res) => {
  try {
    const row = db.prepare('SELECT actions, formations, partenariats, updated_at FROM site_stats WHERE id = 1').get();
    res.json(row || { actions: 0, formations: 0, partenariats: 0 });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.put('/api/site-stats', requireAdmin, (req, res) => {
  const body = req.body || {};
  const actions = Number(body.actions);
  const formations = Number(body.formations);
  const partenariats = Number(body.partenariats);
  if (![actions, formations, partenariats].every((n) => Number.isFinite(n) && n >= 0)) {
    return res.status(400).json({ error: 'Valeurs invalides.' });
  }
  try {
    db.prepare(
      "UPDATE site_stats SET actions = ?, formations = ?, partenariats = ?, updated_at = datetime('now') WHERE id = 1"
    ).run(actions, formations, partenariats);
    const row = db.prepare('SELECT actions, formations, partenariats, updated_at FROM site_stats WHERE id = 1').get();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/api/events', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, date, title, type, place, description, created_at FROM agenda_events ORDER BY date ASC').all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.post('/api/events', requireAdmin, (req, res) => {
  const { date, title, type, place, description } = req.body || {};
  if (!date || !String(title || '').trim() || !String(place || '').trim()) {
    return res.status(400).json({ error: 'Date, titre et lieu sont obligatoires.' });
  }
  const info = db
    .prepare(
      'INSERT INTO agenda_events (date, title, type, place, description) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      date,
      String(title).trim(),
      String(type || 'Événement').trim(),
      String(place).trim(),
      String(description || '').trim()
    );
  const row = db.prepare('SELECT * FROM agenda_events WHERE id = ?').get(info.lastInsertRowid);
  res.json(row);
});

app.delete('/api/events/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID invalide' });
  db.prepare('DELETE FROM agenda_events WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/gallery', (req, res) => {
  try {
    const rows = db
      .prepare(
        'SELECT id, event_key, event_title, original_name, mime, created_at FROM gallery_images ORDER BY id DESC'
      )
      .all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/api/gallery/:id/image', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT image_blob, mime FROM gallery_images WHERE id = ?').get(id);
  if (!row) return res.status(404).end();
  res.set('Content-Type', row.mime || 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(row.image_blob);
});

app.post('/api/gallery', requireAdmin, upload.array('images', 40), (req, res) => {
  const event_key = req.body.event_key;
  const event_title = req.body.event_title;
  const files = req.files || [];
  if (!event_key || !String(event_title || '').trim() || files.length === 0) {
    return res.status(400).json({ error: 'Événement et au moins une image sont requis.' });
  }
  const insert = db.prepare(
    'INSERT INTO gallery_images (event_key, event_title, original_name, mime, image_blob) VALUES (?, ?, ?, ?, ?)'
  );
  const ids = [];
  const run = db.transaction((rows) => {
    for (const file of rows) {
      const info = insert.run(
        String(event_key),
        String(event_title).trim(),
        file.originalname || 'image',
        file.mimetype || 'application/octet-stream',
        file.buffer
      );
      ids.push(Number(info.lastInsertRowid));
    }
  });
  run(files);
  res.json({ ids });
});

app.delete('/api/gallery/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID invalide' });
  db.prepare('DELETE FROM gallery_images WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/partners', (req, res) => {
  try {
    const rows = db
      .prepare(
        'SELECT id, kind, name, url, original_name, mime, sort_order, created_at FROM partners ORDER BY sort_order ASC, id ASC'
      )
      .all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/api/partners/:id/logo', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT logo_blob, mime FROM partners WHERE id = ?').get(id);
  if (!row) return res.status(404).end();
  res.set('Content-Type', row.mime || 'image/png');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(row.logo_blob);
});

app.post('/api/partners', requireAdmin, upload.single('logo'), (req, res) => {
  const { kind, name, url, sort_order } = req.body || {};
  const file = req.file;
  const k = String(kind || '').trim();
  if (!(k === 'partner' || k === 'sponsor')) {
    return res.status(400).json({ error: 'Type invalide (partner/sponsor).' });
  }
  if (!String(name || '').trim() || !file) {
    return res.status(400).json({ error: 'Nom et logo sont requis.' });
  }
  const order = Number(sort_order || 0);
  if (!Number.isFinite(order)) return res.status(400).json({ error: 'Ordre invalide.' });
  try {
    const info = db
      .prepare(
        'INSERT INTO partners (kind, name, url, original_name, mime, logo_blob, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        k,
        String(name).trim(),
        String(url || '').trim(),
        file.originalname || 'logo',
        file.mimetype || 'application/octet-stream',
        file.buffer,
        order
      );
    const row = db
      .prepare('SELECT id, kind, name, url, original_name, mime, sort_order, created_at FROM partners WHERE id = ?')
      .get(info.lastInsertRowid);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.delete('/api/partners/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID invalide' });
  db.prepare('DELETE FROM partners WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.use(express.static(rootDir, { index: 'index.html' }));

app.listen(PORT, () => {
  console.log(`JCI Oudref — https://jci-website-orcin.vercel.app:${PORT}`);
  console.log(`API santé : https://jci-website-orcin.vercel.app:${PORT}/api/health`);
});
