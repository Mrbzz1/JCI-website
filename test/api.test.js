const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../server/config');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');

const VERCEL = 'https://jci-oudhref.vercel.app';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]);

const env = (dir, extra = {}) => ({ ADMIN_TOKEN: 'test-password', JWT_SECRET: 'test-secret-test-secret', DB_DIR: dir, NODE_ENV: 'production', ...extra });

/** Start the real server on an ephemeral port against `dir`. */
async function startServer(dir, extraEnv) {
  const config = loadConfig(env(dir, extraEnv));
  const { db } = openDatabase(config.dataDir);
  const server = await new Promise((resolve) => { const s = createApp({ db, config }).listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, config, db, stop: () => new Promise((r) => server.close(() => { db.close(); r(); })) };
}

/** A "device": its own origin header and its own login session — shares nothing with other devices but the server. */
function device(base, origin = VERCEL) {
  let token = '';
  const call = async (method, p, body, { raw } = {}) => {
    const headers = { Origin: origin };
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload = body;
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + p, { method, headers, body: payload });
    if (raw) return res;
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };
  return {
    call,
    async login(pw = 'test-password') { const r = await call('POST', '/api/admin/login', { password: pw }); if (r.body?.token) token = r.body.token; return r; }
  };
}

const imageForm = (fields, files) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  files.forEach(({ field, buf, name, type }) => fd.append(field, new Blob([buf], { type }), name));
  return fd;
};

test('cross-device sync flow + persistence across restart', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jci-'));
  let srv = await startServer(dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const adminA = device(srv.base, VERCEL); await adminA.login();
  const visitorB = device(srv.base, VERCEL);          // other device, not logged in
  const adminB = device(srv.base, VERCEL); await adminB.login();

  await t.test('health is 200 and reports DB ok', async () => {
    const r = await visitorB.call('GET', '/api/health');
    assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.database, 'ok'); assert.equal(r.body.persistentStorage, true);
  });

  let ev;
  await t.test('1-3. admin A creates event; stored in SQLite; device B sees it', async () => {
    const r = await adminA.call('POST', '/api/events', { date: '2026-12-01', title: 'Formation Leadership', type: 'Training', place: 'Oudhref', description: 'x' });
    assert.equal(r.status, 201); ev = r.body;
    const list = await visitorB.call('GET', '/api/events');
    assert.equal(list.body.length, 1); assert.equal(list.body[0].title, 'Formation Leadership');
    assert.equal(list.headers.get('cache-control'), 'no-store');
  });

  await t.test('4-5. admin B updates (PUT); device A sees the update', async () => {
    const r = await adminB.call('PUT', `/api/events/${ev.id}`, { title: 'Formation Leadership 2', date: '2026-12-02' });
    assert.equal(r.status, 200); assert.equal(r.body.place, 'Oudhref'); // untouched field kept
    const seenByA = await adminA.call('GET', `/api/events/${ev.id}`);
    assert.equal(seenByA.body.title, 'Formation Leadership 2'); assert.equal(seenByA.body.date, '2026-12-02');
  });

  let galleryIds;
  await t.test('7. gallery upload is visible/downloadable from another device; rekeyed when event renamed', async () => {
    const key = '2026-12-02__Formation Leadership 2';
    const up = await adminA.call('POST', '/api/gallery', imageForm({ event_key: key, event_title: '2026-12-02 — Formation Leadership 2' }, [
      { field: 'images', buf: PNG, name: 'a.png', type: 'image/png' }, { field: 'images', buf: JPG, name: 'b.jpg', type: 'image/jpeg' }]));
    assert.equal(up.status, 201); galleryIds = up.body.ids; assert.equal(galleryIds.length, 2);
    const list = await visitorB.call('GET', '/api/gallery');
    assert.equal(list.body.length, 2);
    const img = await visitorB.call('GET', `/api/gallery/${galleryIds[0]}/image`, null, { raw: true });
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
    // rename event → photos stay attached
    await adminB.call('PATCH', `/api/events/${ev.id}`, { title: 'Renamed' });
    const after = await visitorB.call('GET', '/api/gallery');
    assert.ok(after.body.every((g) => g.event_key === '2026-12-02__Renamed' && g.event_title === '2026-12-02 — Renamed'));
  });

  let partner;
  await t.test('8. partners + stats sync', async () => {
    const p = await adminA.call('POST', '/api/partners', imageForm({ kind: 'sponsor', name: 'ACME', url: 'https://acme.example', sort_order: '2' }, [{ field: 'logo', buf: PNG, name: 'logo.png', type: 'image/png' }]));
    assert.equal(p.status, 201); partner = p.body;
    const upd = await adminB.call('PUT', `/api/partners/${partner.id}`, { name: 'ACME Corp', sort_order: 1 });
    assert.equal(upd.status, 200); assert.equal(upd.body.name, 'ACME Corp'); assert.equal(upd.body.url, 'https://acme.example/');
    const listB = await visitorB.call('GET', '/api/partners');
    assert.equal(listB.body[0].name, 'ACME Corp');
    const logo = await visitorB.call('GET', `/api/partners/${partner.id}/logo`, null, { raw: true });
    assert.equal(logo.status, 200);
    const s = await adminA.call('PUT', '/api/site-stats', { actions: 12, formations: 3, partenariats: 5 });
    assert.equal(s.status, 200);
    assert.deepEqual((({ actions, formations, partenariats }) => ({ actions, formations, partenariats }))((await visitorB.call('GET', '/api/site-stats')).body), { actions: 12, formations: 3, partenariats: 5 });
  });

  await t.test('9. data survives a full backend restart (same DB dir)', async () => {
    await srv.stop();
    srv = await startServer(dir);
    const v = device(srv.base);
    assert.equal((await v.call('GET', '/api/events')).body[0].title, 'Renamed');
    assert.equal((await v.call('GET', '/api/gallery')).body.length, 2);
    assert.equal((await v.call('GET', '/api/partners')).body.length, 1);
    assert.equal((await v.call('GET', '/api/site-stats')).body.actions, 12);
    const img = await v.call('GET', `/api/gallery/${galleryIds[0]}/image`, null, { raw: true });
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
  });

  await t.test('6. deletions are reflected on other devices', async () => {
    const a = device(srv.base); await a.login();
    const b = device(srv.base);
    assert.equal((await a.call('DELETE', `/api/events/${ev.id}`)).status, 200);
    assert.equal((await b.call('GET', '/api/events')).body.length, 0);
    assert.equal((await a.call('DELETE', `/api/gallery/${galleryIds[0]}`)).status, 200);
    assert.equal((await b.call('GET', `/api/gallery/${galleryIds[0]}/image`, null, { raw: true })).status, 404);
    assert.equal((await a.call('DELETE', `/api/partners/${partner.id}`)).status, 200);
    assert.equal((await b.call('GET', '/api/partners')).body.length, 0);
    assert.equal((await a.call('DELETE', `/api/events/${ev.id}`)).status, 404); // already gone → clear 404
  });

  await srv.stop();
});

test('auth: writes require a valid admin token; login is rate-limited', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jci-'));
  const srv = await startServer(dir);
  t.after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const anon = device(srv.base);
  const ev = { date: '2026-12-01', title: 't', place: 'p' };
  assert.equal((await anon.call('POST', '/api/events', ev)).status, 401);
  assert.equal((await anon.call('PUT', '/api/events/1', ev)).status, 401);
  assert.equal((await anon.call('DELETE', '/api/events/1')).status, 401);
  assert.equal((await anon.call('PUT', '/api/site-stats', { actions: 1, formations: 1, partenariats: 1 })).status, 401);
  assert.equal((await anon.call('POST', '/api/gallery', imageForm({ event_key: 'k', event_title: 't' }, []))).status, 401);
  assert.equal((await anon.call('POST', '/api/partners', imageForm({}, []))).status, 401);
  assert.equal((await anon.call('POST', '/api/admin/backup')).status, 401);
  assert.equal((await anon.login('wrong')).status, 401);
  for (let i = 0; i < 12; i++) await anon.login('wrong');
  assert.equal((await anon.login('test-password')).status, 429); // locked out, even with the right password
});

test('validation and meaningful errors', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jci-'));
  const srv = await startServer(dir);
  t.after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const a = device(srv.base); await a.login();

  assert.equal((await a.call('POST', '/api/events', { date: '2026-02-31', title: 't', place: 'p' })).status, 400); // impossible date
  assert.equal((await a.call('POST', '/api/events', { date: '2026-12-01', title: '  ', place: 'p' })).status, 400);
  assert.equal((await a.call('PUT', '/api/events/abc', { title: 'x' })).status, 400);
  assert.equal((await a.call('PUT', '/api/events/999', { title: 'x' })).status, 404);
  assert.equal((await a.call('PUT', '/api/site-stats', { actions: -1, formations: 0, partenariats: 0 })).status, 400);
  assert.equal((await a.call('PUT', '/api/site-stats', { actions: 1.5, formations: 0, partenariats: 0 })).status, 400);
  const bad = await a.call('POST', '/api/events', { date: '2026-12-01', title: 't', place: 'p', type: 'Event', description: "'); DROP TABLE agenda_events;--" });
  assert.equal(bad.status, 201); // SQL injection attempt stored as inert text (parameterized queries)
  assert.equal((await a.call('GET', '/api/events')).body.length, 1);
  const unknown = await a.call('GET', '/api/nope'); assert.equal(unknown.status, 404); assert.ok(unknown.body.error);

  // images: fake extension/declared mime but HTML content → rejected by magic-byte check
  const fake = await a.call('POST', '/api/gallery', imageForm({ event_key: 'k', event_title: 't' }, [{ field: 'images', buf: Buffer.from('<script>alert(1)</script>'.padEnd(40)), name: 'x.png', type: 'image/png' }]));
  assert.equal(fake.status, 400);
  const svg = await a.call('POST', '/api/gallery', imageForm({ event_key: 'k', event_title: 't' }, [{ field: 'images', buf: Buffer.from('<svg/>'), name: 'x.svg', type: 'image/svg+xml' }]));
  assert.equal(svg.status, 400);
  const big = await a.call('POST', '/api/gallery', imageForm({ event_key: 'k', event_title: 't' }, [{ field: 'images', buf: Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]), name: 'big.png', type: 'image/png' }]));
  assert.equal(big.status, 413);
  assert.equal((await a.call('GET', '/api/gallery')).body.length, 0); // nothing half-saved
  // partner URL must be http(s) (blocks javascript: links on the public page)
  const js = await a.call('POST', '/api/partners', imageForm({ kind: 'partner', name: 'X', url: 'javascript:alert(1)' }, [{ field: 'logo', buf: PNG, name: 'l.png', type: 'image/png' }]));
  assert.equal(js.status, 400);
  assert.equal((await a.call('POST', '/api/partners', imageForm({ kind: 'weird', name: 'X' }, [{ field: 'logo', buf: PNG, name: 'l.png', type: 'image/png' }]))).status, 400);

  // malformed JSON body → 400, not 500
  const res = await fetch(srv.base + '/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' }, body: '{oops' });
  assert.equal(res.status, 400);
});

test('CORS: exact allowlist, no wildcard, preflight works', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jci-'));
  const srv = await startServer(dir, { CORS_ORIGINS: 'https://custom.example/,*' });
  t.after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  const get = (origin) => fetch(srv.base + '/api/events', { headers: origin ? { Origin: origin } : {} });
  const ok = await get(VERCEL);
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('access-control-allow-origin'), VERCEL);
  assert.equal((await get('https://custom.example')).status, 200);       // trailing slash in env normalised
  assert.equal((await get('https://evil.example')).status, 403);          // not allowed
  assert.equal((await get(null)).status, 200);                            // curl / server-to-server
  assert.notEqual(ok.headers.get('access-control-allow-origin'), '*');
  assert.equal(ok.headers.get('access-control-allow-credentials'), null);
  assert.ok(srv.config.warnings.some((w) => w.includes('"*"')));          // wildcard was ignored with a warning

  const pre = await fetch(srv.base + '/api/events/1', { method: 'OPTIONS', headers: { Origin: VERCEL, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-methods'), /PUT/); assert.match(pre.headers.get('access-control-allow-methods'), /DELETE/);
  const preEvil = await fetch(srv.base + '/api/events/1', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'DELETE' } });
  assert.equal(preEvil.status, 403);
});

test('database init is safe & repeatable; backup works; config guards', async (t) => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jci-')), 'does', 'not', 'exist', 'yet'); // dir is created when missing
  t.after(() => fs.rmSync(path.resolve(dir, '..', '..', '..', '..'), { recursive: true, force: true }));
  let srv = await startServer(dir);
  const a = device(srv.base); await a.login();
  await a.call('POST', '/api/events', { date: '2026-12-01', title: 'keep me', place: 'p' });
  await a.call('PUT', '/api/site-stats', { actions: 7, formations: 7, partenariats: 7 });
  const bk = await a.call('POST', '/api/admin/backup');
  assert.equal(bk.status, 201); assert.ok(fs.existsSync(path.join(dir, 'backups', bk.body.file)));
  await srv.stop();
  for (let i = 0; i < 3; i++) { srv = await startServer(dir); await srv.stop(); } // re-opening never resets data
  srv = await startServer(dir);
  const v = device(srv.base);
  assert.equal((await v.call('GET', '/api/events')).body[0].title, 'keep me');
  assert.equal((await v.call('GET', '/api/site-stats')).body.actions, 7);
  await srv.stop();

  assert.throws(() => loadConfig({}), /ADMIN_TOKEN/);
  const noVolume = loadConfig({ ADMIN_TOKEN: 'x', JWT_SECRET: 'y', NODE_ENV: 'production' });
  assert.equal(noVolume.persistentStorage, false);
  assert.ok(noVolume.warnings.some((w) => /volume/i.test(w)));
  assert.equal(loadConfig({ ADMIN_TOKEN: 'x', JWT_SECRET: 'y', RAILWAY_VOLUME_MOUNT_PATH: '/data' }).dataDir, path.resolve('/data'));
  assert.ok(!loadConfig({ ADMIN_TOKEN: 'x', JWT_SECRET: 'y', NODE_ENV: 'production' }).corsOrigins.has('http://localhost:3000')); // dev origins not allowed in prod
});

test('existing production SQLite file (old schema + data) opens unchanged', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jci-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Simulate the pre-existing Railway DB created by the previous server version
  const Database = require('better-sqlite3');
  const old = new Database(path.join(dir, 'jci.db'));
  old.exec(`CREATE TABLE agenda_events (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'Événement', place TEXT NOT NULL, description TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE site_stats (id INTEGER PRIMARY KEY CHECK (id = 1), actions INTEGER NOT NULL DEFAULT 0, formations INTEGER NOT NULL DEFAULT 0, partenariats INTEGER NOT NULL DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')));
    INSERT INTO site_stats (id, actions, formations, partenariats) VALUES (1, 40, 8, 15);
    INSERT INTO agenda_events (date, title, type, place, description) VALUES ('2026-05-01', 'Ancien événement', 'Event', 'Oudhref', '');
    CREATE TABLE gallery_images (id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL, event_title TEXT NOT NULL, original_name TEXT, mime TEXT NOT NULL, image_blob BLOB NOT NULL, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE partners (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK (kind IN ('partner', 'sponsor')), name TEXT NOT NULL, url TEXT DEFAULT '', original_name TEXT, mime TEXT NOT NULL, logo_blob BLOB NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));`);
  old.prepare('INSERT INTO gallery_images (event_key, event_title, original_name, mime, image_blob) VALUES (?,?,?,?,?)').run('2026-05-01__Ancien événement', 'x', 'old.png', 'image/png', PNG);
  old.close();
  const srv = await startServer(dir);
  t.after(() => srv.stop());
  const v = device(srv.base);
  assert.equal((await v.call('GET', '/api/events')).body[0].title, 'Ancien événement');
  assert.equal((await v.call('GET', '/api/site-stats')).body.actions, 40);   // existing stats NOT reset to 0
  const img = await v.call('GET', '/api/gallery/1/image', null, { raw: true });
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
});
