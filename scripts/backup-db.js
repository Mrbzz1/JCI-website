// Usage: DB_DIR=/data npm run backup   → writes a consistent snapshot to <DB_DIR>/backups/
const { openDatabase, backupDatabase } = require('../server/db');
const path = require('path');

const dir = process.env.DB_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'server', 'data');
const { db } = openDatabase(path.resolve(dir));
backupDatabase(db, path.resolve(dir), 'cli')
  .then((r) => { console.log(`Backup created: ${path.join(dir, 'backups', r.file)} (${r.size} bytes)`); db.close(); })
  .catch((e) => { console.error('Backup failed:', e.message); process.exit(1); });
