const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

/**
 * Schema is IDENTICAL to the one already in production (CREATE ... IF NOT EXISTS),
 * so opening an existing database never alters or resets its data.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS agenda_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'Événement',
    place TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS site_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    actions INTEGER NOT NULL DEFAULT 0,
    formations INTEGER NOT NULL DEFAULT 0,
    partenariats INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO site_stats (id, actions, formations, partenariats) VALUES (1, 0, 0, 0);

  CREATE TABLE IF NOT EXISTS gallery_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_key TEXT NOT NULL,
    event_title TEXT NOT NULL,
    original_name TEXT,
    mime TEXT NOT NULL,
    image_blob BLOB NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('partner', 'sponsor')),
    name TEXT NOT NULL,
    url TEXT DEFAULT '',
    original_name TEXT,
    mime TEXT NOT NULL,
    logo_blob BLOB NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_agenda_date ON agenda_events(date);
  CREATE INDEX IF NOT EXISTS idx_gallery_event_key ON gallery_images(event_key);
  CREATE INDEX IF NOT EXISTS idx_partners_kind ON partners(kind);
`;

/** Open (and if needed create) the SQLite database inside `dataDir`. Safe to call repeatedly. */
function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'jci.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return { db, dbPath };
}

const BACKUP_KEEP = 10;

/** Consistent online snapshot (safe while the app is serving requests). Keeps the newest BACKUP_KEEP files. */
async function backupDatabase(db, dataDir, label = 'manual') {
  const backupDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = String(label).replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'manual';
  const file = path.join(backupDir, `jci-${stamp}-${safeLabel}.db`);
  await db.backup(file);
  const old = fs.readdirSync(backupDir).filter((f) => /^jci-.*\.db$/.test(f)).sort();
  old.slice(0, Math.max(0, old.length - BACKUP_KEEP)).forEach((f) => fs.rmSync(path.join(backupDir, f), { force: true }));
  return { file: path.basename(file), size: fs.statSync(file).size };
}

module.exports = { openDatabase, backupDatabase };
