const express = require('express');
const multer = require('multer');
const { parseId, validatePartner } = require('../validate');
const { ALLOWED_MIME, validateImage } = require('../images');

const COLUMNS = 'id, kind, name, url, original_name, mime, sort_order, created_at';

module.exports = function partnersRouter({ db, requireAdmin, config }) {
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxImageBytes, files: 1 },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_MIME.has(file.mimetype)) {
        return cb(Object.assign(new Error('Format non pris en charge (JPG, PNG, GIF ou WEBP uniquement).'), { status: 400 }));
      }
      cb(null, true);
    }
  });

  const getById = db.prepare(`SELECT ${COLUMNS} FROM partners WHERE id = ?`);

  router.get('/', (req, res) => {
    res.json(db.prepare(`SELECT ${COLUMNS} FROM partners ORDER BY sort_order ASC, id ASC`).all());
  });

  router.get('/:id/logo', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).end();
    const row = db.prepare('SELECT mime, logo_blob FROM partners WHERE id = ?').get(id);
    if (!row) return res.status(404).end();
    res.set({ 'Content-Type': row.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=86400' });
    res.send(row.logo_blob);
  });

  router.post('/', requireAdmin, upload.single('logo'), (req, res) => {
    const { value, error } = validatePartner(req.body);
    if (error) return res.status(400).json({ error });
    if (!req.file) return res.status(400).json({ error: 'Le logo est requis.' });
    const img = validateImage(req.file, config.maxImageBytes);
    if (img.error) return res.status(400).json({ error: img.error });

    const info = db.prepare(
      'INSERT INTO partners (kind, name, url, original_name, mime, logo_blob, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(value.kind, value.name, value.url, String(req.file.originalname || 'logo').slice(0, 255), img.mime, req.file.buffer, value.sort_order);
    res.status(201).json(getById.get(info.lastInsertRowid));
  });

  // Metadata update (name / url / kind / order). The logo itself is immutable: delete + re-add to change it.
  const updateHandler = (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide' });
    const existing = getById.get(id);
    if (!existing) return res.status(404).json({ error: 'Partenaire introuvable' });
    const { value, error } = validatePartner(req.body, { partial: true });
    if (error) return res.status(400).json({ error });
    const merged = { ...existing, ...value, id };
    db.prepare('UPDATE partners SET kind=@kind, name=@name, url=@url, sort_order=@sort_order WHERE id=@id').run(merged);
    res.json(getById.get(id));
  };
  router.put('/:id', requireAdmin, updateHandler);
  router.patch('/:id', requireAdmin, updateHandler);

  router.delete('/:id', requireAdmin, (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide' });
    const info = db.prepare('DELETE FROM partners WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ error: 'Partenaire introuvable' });
    res.json({ ok: true });
  });

  return router;
};
