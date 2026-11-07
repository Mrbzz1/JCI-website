const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { createClient } = require('@supabase/supabase-js');

const databasePath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server', 'data', 'jci.db'));
const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const buckets = { gallery: 'jci-gallery', partners: 'jci-partners' };

if (!fs.existsSync(databasePath)) {
  console.error(`SQLite database not found: ${databasePath}`);
  process.exitCode = 1;
} else if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exitCode = 1;
} else {
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const sqlite = new DatabaseSync(databasePath, { readOnly: true });

  function storageName(id, originalName) {
    const extension = path.extname(originalName || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
    return `migration/${id}${extension}`;
  }

  async function exists(table, id) {
    const { data, error } = await supabase.from(table).select('id').eq('id', id).maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }

  async function upload(bucket, storagePath, buffer, mime) {
    const { error } = await supabase.storage.from(bucket).upload(storagePath, buffer, { contentType: mime, upsert: true });
    if (error) throw error;
  }

  async function migrateTable(table, rows, mapper) {
    let migrated = 0;
    for (const row of rows) {
      if (await exists(table, row.id)) continue;
      const record = await mapper(row);
      const { error } = await supabase.from(table).insert(record);
      if (error) throw error;
      migrated += 1;
    }
    console.log(`${table}: migrated ${migrated}, skipped existing ${rows.length - migrated}`);
  }

  async function migrate() {
    await migrateTable('agenda_events', sqlite.prepare('SELECT id, date, title, type, place, description, created_at FROM agenda_events').all(), async (row) => row);

    const stats = sqlite.prepare('SELECT actions, formations, partenariats FROM site_stats WHERE id = 1').get();
    if (stats) {
      const { error } = await supabase.from('site_stats').update(stats).eq('id', 1);
      if (error) throw error;
      console.log('site_stats: updated row 1');
    }

    await migrateTable('gallery_images', sqlite.prepare('SELECT id, event_key, event_title, original_name, mime, image_blob, created_at FROM gallery_images').all(), async (row) => {
      const storagePath = storageName(row.id, row.original_name);
      await upload(buckets.gallery, storagePath, row.image_blob, row.mime);
      return { id: row.id, event_key: row.event_key, event_title: row.event_title, original_name: row.original_name, mime: row.mime, storage_path: storagePath, created_at: row.created_at };
    });

    await migrateTable('partners', sqlite.prepare('SELECT id, kind, name, url, original_name, mime, logo_blob, sort_order, created_at FROM partners').all(), async (row) => {
      const storagePath = storageName(row.id, row.original_name);
      await upload(buckets.partners, storagePath, row.logo_blob, row.mime);
      return { id: row.id, kind: row.kind, name: row.name, url: row.url, original_name: row.original_name, mime: row.mime, storage_path: storagePath, sort_order: row.sort_order, created_at: row.created_at };
    });
  }

  migrate()
    .catch((error) => {
      console.error('Migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => sqlite.close());
}
