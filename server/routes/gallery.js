const express = require('express');
const multer = require('multer');
const { parseId, text } = require('../validate');
const { ALLOWED_MIME, validateImage } = require('../images');

module.exports = function galleryRouter({ db, requireAdmin, config }) {
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxImageBytes, files: 40 },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_MIME.has(file.mimetype)) {
        return cb(Object.assign(new Error('Format non pris en charge (JPG, PNG, GIF ou WEBP uniquement).'), { status: 400 }));
      }
      cb(null, true);
    }
  });

  const insert = db.prepare('INSERT INTO gallery_images (event_key, event_title, original_name, mime, image_blob) VALUES (?, ?, ?, ?, ?)');

  router.get('/', (req, res) => {
    const eventKey = text(req.query.event_key, 120);
    const sql = 'SELECT id, event_key, event_title, original_name, mime, created_at FROM gallery_images' +
      (eventKey ? ' WHERE event_key = ?' : '') + ' ORDER BY id DESC';
    res.json(eventKey ? db.prepare(sql).all(eventKey) : db.prepare(sql).all());
  });

  router.get('/:id/image', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).end();
    const row = db.prepare('SELECT mime, image_blob FROM gallery_images WHERE id = ?').get(id);
    if (!row) return res.status(404).end();
    res.set({ 'Content-Type': row.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=86400' });
    res.send(row.image_blob);
  });

  router.post('/', requireAdmin, upload.array('images', 40), (req, res) => {
    const eventKey = text(req.body?.event_key, 120);
    const eventTitle = text(req.body?.event_title, 200);
    const files = req.files || [];
    if (!eventKey || !eventTitle || files.length === 0) {
      return res.status(400).json({ error: 'Événement et au moins une image sont requis.' });
    }
    // Validate everything first so a bad file never leaves a half-uploaded batch.
    const checked = [];
    for (const file of files) {
      const result = validateImage(file, config.maxImageBytes);
      if (result.error) return res.status(400).json({ error: `${file.originalname || 'fichier'} : ${result.error}` });
      checked.push({ file, mime: result.mime });
    }
    const ids = db.transaction(() => checked.map(({ file, mime }) =>
      Number(insert.run(eventKey, eventTitle, text(file.originalname, 255) || 'image', mime, file.buffer).lastInsertRowid)
    ))();
    res.status(201).json({ ids });
  });

  router.delete('/:id', requireAdmin, (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide' });
    const info = db.prepare('DELETE FROM gallery_images WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ error: 'Image introuvable' });
    res.json({ ok: true });
  });

  return router;
};
