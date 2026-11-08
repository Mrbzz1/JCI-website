const express = require('express');
const { parseId, validateEvent } = require('../validate');

const COLUMNS = 'id, date, title, type, place, description, created_at';

module.exports = function eventsRouter({ db, requireAdmin }) {
  const router = express.Router();

  const getById = db.prepare(`SELECT ${COLUMNS} FROM agenda_events WHERE id = ?`);
  const insert = db.prepare('INSERT INTO agenda_events (date, title, type, place, description) VALUES (@date, @title, @type, @place, @description)');
  const update = db.prepare('UPDATE agenda_events SET date=@date, title=@title, type=@type, place=@place, description=@description WHERE id=@id');
  const remove = db.prepare('DELETE FROM agenda_events WHERE id = ?');
  const rekeyGallery = db.prepare('UPDATE gallery_images SET event_key = ?, event_title = ? WHERE event_key = ?');

  router.get('/', (req, res) => {
    res.json(db.prepare(`SELECT ${COLUMNS} FROM agenda_events ORDER BY date ASC, id ASC`).all());
  });

  router.get('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide' });
    const row = getById.get(id);
    if (!row) return res.status(404).json({ error: 'Événement introuvable' });
    res.json(row);
  });

  router.post('/', requireAdmin, (req, res) => {
    const { value, error } = validateEvent(req.body);
    if (error) return res.status(400).json({ error });
    const info = insert.run(value);
    res.status(201).json(getById.get(info.lastInsertRowid));
  });

  // PUT and PATCH both apply only the fields that are present (merge semantics).
  const updateHandler = (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide' });
    const existing = getById.get(id);
    if (!existing) return res.status(404).json({ error: 'Événement introuvable' });
    const { value, error } = validateEvent(req.body, { partial: true });
    if (error) return res.status(400).json({ error });

    const merged = { ...existing, ...value, id };
    db.transaction(() => {
      update.run(merged);
      // Gallery folders are keyed by "date__title": keep photos attached if the event is renamed/re-dated.
      const oldKey = `${existing.date}__${existing.title}`;
      const newKey = `${merged.date}__${merged.title}`;
      if (oldKey !== newKey) rekeyGallery.run(newKey, `${merged.date} — ${merged.title}`, oldKey);
    })();
    res.json(getById.get(id));
  };
  router.put('/:id', requireAdmin, updateHandler);
  router.patch('/:id', requireAdmin, updateHandler);

  router.delete('/:id', requireAdmin, (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID invalide' });
    const info = remove.run(id);
    if (info.changes === 0) return res.status(404).json({ error: 'Événement introuvable' });
    res.json({ ok: true });
  });

  return router;
};
