const express = require('express');
const { validateStats } = require('../validate');

module.exports = function statsRouter({ db, requireAdmin }) {
  const router = express.Router();
  const read = db.prepare('SELECT actions, formations, partenariats, updated_at FROM site_stats WHERE id = 1');
  const write = db.prepare("UPDATE site_stats SET actions=@actions, formations=@formations, partenariats=@partenariats, updated_at=datetime('now') WHERE id = 1");

  router.get('/', (req, res) => {
    res.json(read.get() || { actions: 0, formations: 0, partenariats: 0 });
  });

  const updateHandler = (req, res) => {
    const current = read.get() || { actions: 0, formations: 0, partenariats: 0 };
    const { value, error } = validateStats({ ...current, ...req.body });
    if (error) return res.status(400).json({ error });
    write.run(value);
    res.json(read.get());
  };
  router.put('/', requireAdmin, updateHandler);
  router.patch('/', requireAdmin, updateHandler);

  return router;
};
