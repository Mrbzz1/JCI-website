const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { loadConfig } = require('../server/config');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_URL = 'data:image/png;base64,' + PNG_B64;
const PNG2_URL = 'data:image/png;base64,' + Buffer.concat([Buffer.from(PNG_B64, 'base64'), Buffer.alloc(8, 7)]).toString('base64');
const plain = (o) => JSON.parse(JSON.stringify(o)); // objects made inside the vm sandbox have a foreign prototype
const publicDir = path.join(__dirname, '..', 'public', 'js');

async function startServer(dir) {
  const config = loadConfig({ ADMIN_TOKEN: 'pw', JWT_SECRET: 'secret-secret-secret', DB_DIR: dir, NODE_ENV: 'production' });
  const { db } = openDatabase(config.dataDir);
  const server = await new Promise((r) => { const s = createApp({ db, config }).listen(0, () => r(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, dir, stop: () => new Promise((r) => server.close(() => { db.close(); r(); })) };
}

/** Run the real browser scripts in a sandbox that mimics window + storage + fetch (recording every URL). */
function loadClient(config, { withMigrate = false } = {}) {
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
  const fetchedUrls = [];
  const barState = { active: false, everActive: false };
  const bar = { id: '', className: '', setAttribute() {}, classList: { toggle: (_c, on) => { barState.active = on; if (on) barState.everActive = true; } } };
  const ctx = {
    JCI_CONFIG: config, localStorage: store(), sessionStorage: store(), FormData, File, Blob, AbortController, setTimeout, clearTimeout, console,
    location: { origin: 'https://jci-oudhref.vercel.app', host: 'jci-oudhref.vercel.app' },
    fetch: (url, opts) => { fetchedUrls.push(String(url)); return fetch(url, opts); },
    document: { body: { appendChild() {} }, getElementById: () => bar, createElement: () => bar, documentElement: { setAttribute() {} } }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(publicDir, 'jci-data.js'), 'utf8'), ctx);
  if (withMigrate) vm.runInContext(fs.readFileSync(path.join(publicDir, 'jci-migrate.js'), 'utf8'), ctx);
  return { ctx, J: ctx.JciData, M: ctx.JciMigrate, fetchedUrls, barState };
}

test('missing API config: explicit error, ZERO network calls (never falls back to Vercel /api)', async () => {
  const c = loadClient({ apiBaseUrl: '', sameOrigin: false });
  assert.equal(c.J.configOk, false);
  for (const call of [() => c.J.getAgendaEvents(), () => c.J.getGalleryItems(), () => c.J.getSiteStats(), () => c.J.getPartners(), () => c.J.adminLogin('x')]) {
    await assert.rejects(call, (e) => e.code === 'config');
  }
  assert.equal(await c.J.checkApi(), false);
  assert.deepEqual(c.fetchedUrls, []);
});

test('unreachable backend: clear error, stale localStorage data is NOT shown', async () => {
  const c = loadClient({ apiBaseUrl: 'http://127.0.0.1:9', sameOrigin: false }); // nothing listens on :9
  c.ctx.localStorage.setItem('jciAgendaEvents', JSON.stringify([{ date: '2026-01-01', title: 'STALE LOCAL EVENT', place: 'x' }]));
  await assert.rejects(c.J.getAgendaEvents(), (e) => e.code === 'network' && /injoignable/.test(e.message));
  await assert.rejects(c.J.getGalleryItems(), (e) => e.code === 'network');
  await assert.rejects(c.J.adminLogin('pw'), (e) => e.code === 'network'); // server down is NOT reported as "wrong password"
  assert.equal(await c.J.checkApi(), false);
  assert.ok(c.fetchedUrls.every((u) => u.startsWith('http://127.0.0.1:9/')));
});

test('full client flow against the real API: login, CRUD, auth errors, loading indicator', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jci-'));
  const srv = await startServer(dir);
  t.after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  const a = loadClient({ apiBaseUrl: srv.base, sameOrigin: false });
  const b = loadClient({ apiBaseUrl: srv.base + '/', sameOrigin: false }); // trailing slash normalised
  assert.equal(await a.J.checkApi(), true);

  await assert.rejects(a.J.adminLogin('wrong'), (e) => e.code === 'auth' && e.message === 'Mot de passe incorrect.');
  await assert.rejects(a.J.adminAddEvent({ date: '2026-12-01', title: 't', place: 'p' }), (e) => e.code === 'auth'); // no token yet

  assert.equal(await a.J.adminLogin('pw'), true);
  assert.ok(a.ctx.sessionStorage.getItem('jciAdminToken'));            // JWT only (session scope)
  assert.equal(a.ctx.localStorage._m.size, 0);                          // nothing shared is put in localStorage

  const ev = await a.J.adminAddEvent({ date: '2026-12-01', title: 'Formation', type: 'Formation', place: 'Oudhref', description: '' });
  assert.equal((await b.J.getAgendaEvents())[0].title, 'Formation');   // other "device" sees it
  await a.J.adminUpdateEvent(ev.id, { title: 'Formation v2' });
  assert.equal((await b.J.getAgendaEvents())[0].title, 'Formation v2');
  await a.J.adminDeleteEvent(ev.id);
  assert.equal((await b.J.getAgendaEvents()).length, 0);
  await assert.rejects(a.J.adminDeleteEvent(ev.id), (e) => e.code === 'http' && e.status === 404);

  const stats = await a.J.adminUpdateSiteStats({ actions: 3, formations: 2, partenariats: 1 });
  assert.equal((await b.J.getSiteStats()).actions, stats.actions);
  await assert.rejects(a.J.adminUpdateSiteStats({ actions: -5, formations: 0, partenariats: 0 }), (e) => e.code === 'http' && e.status === 400 && /invalide/i.test(e.message));

  // expired / forged token → 'auth' and token is dropped so the UI returns to the login screen
  a.ctx.sessionStorage.setItem('jciAdminToken', 'forged');
  await assert.rejects(a.J.adminDeleteEvent(1), (e) => e.code === 'auth');
  assert.equal(a.ctx.sessionStorage.getItem('jciAdminToken'), null);

  // image URLs point at the API host, never at the page's own origin
  await a.J.adminLogin('pw');
  const file = new File([Buffer.from(PNG_B64, 'base64')], 'p.png', { type: 'image/png' });
  const p = await a.J.adminAddPartner({ kind: 'sponsor', name: 'ACME', url: '', sortOrder: 1, file });
  const partners = await b.J.getPartners();
  assert.equal(partners[0].src, `${srv.base}/api/partners/${p.id}/logo`);

  assert.equal(a.barState.everActive, true);   // loading indicator was shown…
  assert.equal(a.barState.active, false);      // …and cleared when requests finished
  assert.ok(a.fetchedUrls.every((u) => u.startsWith(srv.base)));
});

test('migration of legacy localStorage data: backup first, no duplicates, no overwrite, verified before clear', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jci-'));
  const srv = await startServer(dir);
  t.after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  const c = loadClient({ apiBaseUrl: srv.base, sameOrigin: false }, { withMigrate: true });
  const ls = c.ctx.localStorage;
  ls.setItem('jciAgendaEvents', JSON.stringify([
    { date: '2026-03-01', title: 'Ancien A', type: 'Formation', place: 'Oudhref', description: 'd' },
    { date: '2026-04-01', title: 'Ancien B', type: 'Réunion', place: 'Tunis', description: '' }]));
  ls.setItem('jciAgendaEventsDraft', JSON.stringify([{ date: '2026-09-09', title: 'Brouillon', place: 'x' }]));
  ls.setItem('jciGalleryImages', JSON.stringify([
    { name: 'same.png', dataUrl: PNG_URL, eventKey: '2026-03-01__Ancien A', eventTitle: '2026-03-01 — Ancien A' },
    { name: 'same.png', dataUrl: PNG2_URL, eventKey: '2026-03-01__Ancien A', eventTitle: '2026-03-01 — Ancien A' }]));
  ls.setItem('jciPartners', JSON.stringify([{ kind: 'partner', name: 'Old Partner', url: 'https://old.example', sortOrder: 2, dataUrl: PNG_URL }]));
  ls.setItem('jciSiteStats', JSON.stringify({ actions: 50, formations: 10, partenariats: 5 }));

  const d = c.M.detect(false);
  assert.deepEqual(plain(d.counts), { events: 2, gallery: 2, partners: 1, stats: 1 });  // 2 different photos with same name stay distinct; draft excluded
  assert.equal(c.M.detect(true).counts.events, 3);
  assert.ok(JSON.parse(c.M.exportBackup()).keys.jciAgendaEventsDraft);           // raw backup includes drafts
  assert.throws(() => c.M.clearLocal(), /non vérifiée/);                         // refuses to delete before a verified run

  await c.J.adminLogin('pw');
  const r1 = await c.M.run({});
  assert.ok(r1.backup && fs.existsSync(path.join(dir, 'backups', r1.backup)));   // server backup taken first
  assert.deepEqual(plain(r1.created), { events: 2, gallery: 2, partners: 1, stats: 1 });
  assert.equal(r1.verified, true); assert.deepEqual(plain(r1.failed), []);
  assert.equal((await c.J.getAgendaEvents()).length, 2);                          // draft NOT migrated by default
  assert.equal((await c.J.getGalleryItems()).length, 2);
  assert.equal((await c.J.getSiteStats()).actions, 50);

  const r2 = await c.M.run({});                                                   // second run: idempotent
  assert.deepEqual(plain(r2.created), { events: 0, gallery: 0, partners: 0, stats: 0 });
  assert.equal((await c.J.getAgendaEvents()).length, 2);
  assert.equal((await c.J.getGalleryItems()).length, 2);
  assert.equal((await c.J.getPartners()).length, 1);

  // server stats already hold real numbers → local stats must NOT overwrite them
  await c.J.adminUpdateSiteStats({ actions: 99, formations: 99, partenariats: 99 });
  const r3 = await c.M.run({});
  assert.equal(r3.skipped.stats, 1); assert.equal((await c.J.getSiteStats()).actions, 99);

  assert.ok(ls.getItem('jciAgendaEvents') !== null);                              // local data untouched so far
  c.M.clearLocal();                                                               // allowed only after verified run
  assert.equal(ls.getItem('jciAgendaEvents'), null);
});

test('migration aborts before writing anything if the server backup fails', async () => {
  const c = loadClient({ apiBaseUrl: 'http://127.0.0.1:9', sameOrigin: false }, { withMigrate: true });
  c.ctx.localStorage.setItem('jciAgendaEvents', JSON.stringify([{ date: '2026-03-01', title: 'A', place: 'p' }]));
  await assert.rejects(c.M.run({}), (e) => e.code === 'network');
  assert.ok(c.ctx.localStorage.getItem('jciAgendaEvents'));                       // local data still there
});
