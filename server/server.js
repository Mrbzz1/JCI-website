const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { supabase, storageBuckets } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '');
const JWT_SECRET = String(process.env.JWT_SECRET || ADMIN_TOKEN);
const JWT_EXPIRES_IN = '8h';
const allowedOrigins = new Set(
  String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
);
const rootDir = path.join(__dirname, '..');
const imageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

if (!ADMIN_TOKEN || !JWT_SECRET) {
  throw new Error('ADMIN_TOKEN and JWT_SECRET must be configured.');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 40 },
  fileFilter: (req, file, callback) => {
    if (!imageMimeTypes.has(file.mimetype)) {
      return callback(new Error('Seules les images JPG, PNG, GIF et WEBP sont acceptées.'));
    }
    callback(null, true);
  }
});

app.use(express.json({ limit: '1mb' }));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.size === 0 || allowedOrigins.has(origin.replace(/\/$/, ''))) return callback(null, true);
    callback(new Error('Origine non autorisée par CORS.'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
}));

function getToken(req) {
  const headerToken = req.headers['x-admin-token'];
  if (headerToken) return String(headerToken);
  const auth = req.headers.authorization;
  return auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : '';
}

function requireAdmin(req, res, next) {
  try {
    req.admin = jwt.verify(getToken(req), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Non autorisé' });
  }
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function safeFileName(originalName) {
  const extension = path.extname(originalName || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  return `${crypto.randomUUID()}${extension}`;
}

async function uploadToStorage(bucket, file, prefix) {
  const storagePath = `${prefix}/${safeFileName(file.originalname)}`;
  const { error } = await supabase.storage.from(bucket).upload(storagePath, file.buffer, {
    contentType: file.mimetype,
    cacheControl: '31536000',
    upsert: false
  });
  if (error) throw error;
  return storagePath;
}

async function removeStorageObject(bucket, storagePath) {
  if (!storagePath) return;
  const { error } = await supabase.storage.from(bucket).remove([storagePath]);
  if (error) console.error('Storage cleanup failed:', error.message);
}

async function downloadStorageObject(bucket, storagePath) {
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'jci-oudhref' });
});

app.post('/api/admin/login', (req, res) => {
  const password = String((req.body || {}).password || '');
  if (!password || password !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  }
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  res.json({ token, expiresIn: JWT_EXPIRES_IN });
});

app.get('/api/admin/check', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

app.get('/api/site-stats', async (req, res, next) => {
  const { data, error } = await supabase
    .from('site_stats')
    .select('actions, formations, partenariats, updated_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) return next(error);
  res.json(data || { actions: 0, formations: 0, partenariats: 0 });
});

app.put('/api/site-stats', requireAdmin, async (req, res, next) => {
  const values = ['actions', 'formations', 'partenariats'].map((key) => Number(req.body?.[key]));
  if (!values.every((value) => Number.isFinite(value) && value >= 0 && Number.isInteger(value))) {
    return res.status(400).json({ error: 'Valeurs invalides.' });
  }
  const { data, error } = await supabase
    .from('site_stats')
    .update({ actions: values[0], formations: values[1], partenariats: values[2], updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('actions, formations, partenariats, updated_at')
    .single();
  if (error) return next(error);
  res.json(data);
});

app.get('/api/events', async (req, res, next) => {
  const { data, error } = await supabase
    .from('agenda_events')
    .select('id, date, title, type, place, description, created_at')
    .order('date', { ascending: true });
  if (error) return next(error);
  res.json(data || []);
});

app.post('/api/events', requireAdmin, async (req, res, next) => {
  const date = cleanText(req.body?.date, 10);
  const title = cleanText(req.body?.title, 200);
  const place = cleanText(req.body?.place, 200);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title || !place) {
    return res.status(400).json({ error: 'Date, titre et lieu sont obligatoires.' });
  }
  const { data, error } = await supabase
    .from('agenda_events')
    .insert({ date, title, type: cleanText(req.body?.type || 'Événement', 80), place, description: cleanText(req.body?.description, 2000) })
    .select('id, date, title, type, place, description, created_at')
    .single();
  if (error) return next(error);
  res.json(data);
});

app.delete('/api/events/:id', requireAdmin, async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID invalide' });
  const { error } = await supabase.from('agenda_events').delete().eq('id', id);
  if (error) return next(error);
  res.json({ ok: true });
});

app.get('/api/gallery', async (req, res, next) => {
  const { data, error } = await supabase
    .from('gallery_images')
    .select('id, event_key, event_title, original_name, mime, storage_path, created_at')
    .order('id', { ascending: false });
  if (error) return next(error);
  res.json(data || []);
});

app.get('/api/gallery/:id/image', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).end();
  const { data: row, error } = await supabase.from('gallery_images').select('storage_path, mime').eq('id', id).maybeSingle();
  if (error) return next(error);
  if (!row) return res.status(404).end();
  const buffer = await downloadStorageObject(storageBuckets.gallery, row.storage_path);
  if (!buffer) return res.status(404).end();
  res.set('Content-Type', row.mime || 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(buffer);
});

app.post('/api/gallery', requireAdmin, upload.array('images', 40), async (req, res, next) => {
  const eventKey = cleanText(req.body?.event_key, 120);
  const eventTitle = cleanText(req.body?.event_title, 200);
  const files = req.files || [];
  if (!eventKey || !eventTitle || files.length === 0) {
    return res.status(400).json({ error: 'Événement et au moins une image sont requis.' });
  }
  const uploaded = [];
  const ids = [];
  try {
    for (const file of files) {
      const storagePath = await uploadToStorage(storageBuckets.gallery, file, eventKey.replace(/[^a-zA-Z0-9_-]/g, '_'));
      uploaded.push(storagePath);
      const { data, error } = await supabase.from('gallery_images').insert({
        event_key: eventKey,
        event_title: eventTitle,
        original_name: cleanText(file.originalname, 255),
        mime: file.mimetype,
        storage_path: storagePath
      }).select('id').single();
      if (error) throw error;
      ids.push(Number(data.id));
    }
    res.json({ ids });
  } catch (error) {
    await Promise.all(uploaded.map((storagePath) => removeStorageObject(storageBuckets.gallery, storagePath)));
    if (ids.length) await supabase.from('gallery_images').delete().in('id', ids);
    next(error);
  }
});

app.delete('/api/gallery/:id', requireAdmin, async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID invalide' });
  const { data: row, error: findError } = await supabase.from('gallery_images').select('storage_path').eq('id', id).maybeSingle();
  if (findError) return next(findError);
  if (!row) return res.status(404).json({ error: 'Image introuvable' });
  const { error: storageError } = await supabase.storage.from(storageBuckets.gallery).remove([row.storage_path]);
  if (storageError) return next(storageError);
  const { error } = await supabase.from('gallery_images').delete().eq('id', id);
  if (error) return next(error);
  res.json({ ok: true });
});

app.get('/api/partners', async (req, res, next) => {
  const { data, error } = await supabase
    .from('partners')
    .select('id, kind, name, url, original_name, mime, storage_path, sort_order, created_at')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) return next(error);
  res.json(data || []);
});

app.get('/api/partners/:id/logo', async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).end();
  const { data: row, error } = await supabase.from('partners').select('storage_path, mime').eq('id', id).maybeSingle();
  if (error) return next(error);
  if (!row) return res.status(404).end();
  const buffer = await downloadStorageObject(storageBuckets.partners, row.storage_path);
  if (!buffer) return res.status(404).end();
  res.set('Content-Type', row.mime || 'image/png');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(buffer);
});

app.post('/api/partners', requireAdmin, upload.single('logo'), async (req, res, next) => {
  const kind = cleanText(req.body?.kind, 20);
  const name = cleanText(req.body?.name, 200);
  const file = req.file;
  const sortOrder = Number(req.body?.sort_order || 0);
  if (!['partner', 'sponsor'].includes(kind)) return res.status(400).json({ error: 'Type invalide (partner/sponsor).' });
  if (!name || !file) return res.status(400).json({ error: 'Nom et logo sont requis.' });
  if (!Number.isInteger(sortOrder) || sortOrder < 0) return res.status(400).json({ error: 'Ordre invalide.' });
  let storagePath;
  try {
    storagePath = await uploadToStorage(storageBuckets.partners, file, kind);
    const { data, error } = await supabase.from('partners').insert({
      kind,
      name,
      url: cleanText(req.body?.url, 1000),
      original_name: cleanText(file.originalname, 255),
      mime: file.mimetype,
      storage_path: storagePath,
      sort_order: sortOrder
    }).select('id, kind, name, url, original_name, mime, sort_order, created_at').single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    await removeStorageObject(storageBuckets.partners, storagePath);
    next(error);
  }
});

app.delete('/api/partners/:id', requireAdmin, async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID invalide' });
  const { data: row, error: findError } = await supabase.from('partners').select('storage_path').eq('id', id).maybeSingle();
  if (findError) return next(findError);
  if (!row) return res.status(404).json({ error: 'Partenaire introuvable' });
  const { error: storageError } = await supabase.storage.from(storageBuckets.partners).remove([row.storage_path]);
  if (storageError) return next(storageError);
  const { error } = await supabase.from('partners').delete().eq('id', id);
  if (error) return next(error);
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.message === 'Origine non autorisée par CORS.') return res.status(403).json({ error: err.message });
  if (err instanceof multer.MulterError || err.message?.startsWith('Seules les images')) {
    return res.status(400).json({ error: err.message || 'Fichier invalide.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

app.use(express.static(path.join(rootDir, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(rootDir, 'public', 'admin.html')));
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(rootDir, 'public', 'index.html')));

if (require.main === module) {
  app.listen(PORT, () => console.log(`JCI Oudhref server running on port ${PORT}`));
}

module.exports = app;
