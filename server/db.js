const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'jci.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
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
`);

module.exports = db;
