/** Input validation helpers. Each returns { value } or { error }. */

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** `partial` = PATCH/PUT semantics: only validate fields that are present. */
function validateEvent(body = {}, { partial = false } = {}) {
  const out = {};
  const has = (k) => body[k] !== undefined;

  if (!partial || has('date')) {
    out.date = text(body.date, 10);
    if (!isRealDate(out.date)) return { error: 'Date invalide (format AAAA-MM-JJ).' };
  }
  if (!partial || has('title')) {
    out.title = text(body.title, 200);
    if (!out.title) return { error: 'Le titre est obligatoire.' };
  }
  if (!partial || has('place')) {
    out.place = text(body.place, 200);
    if (!out.place) return { error: 'Le lieu est obligatoire.' };
  }
  if (!partial || has('type')) out.type = text(body.type || 'Événement', 80) || 'Événement';
  if (!partial || has('description')) out.description = text(body.description, 2000);
  return { value: out };
}

function validateStats(body = {}) {
  const out = {};
  for (const key of ['actions', 'formations', 'partenariats']) {
    const n = Number(body[key]);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000_000) {
      return { error: `Valeur invalide pour « ${key} » (entier positif attendu).` };
    }
    out[key] = n;
  }
  return { value: out };
}

function validateUrl(value) {
  const url = text(value, 1000);
  if (!url) return { value: '' };
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
    return { value: u.toString() };
  } catch {
    return { error: 'URL invalide (http:// ou https:// requis).' };
  }
}

function validatePartner(body = {}, { partial = false } = {}) {
  const out = {};
  const has = (k) => body[k] !== undefined;

  if (!partial || has('kind')) {
    out.kind = text(body.kind, 20);
    if (!['partner', 'sponsor'].includes(out.kind)) return { error: 'Type invalide (partner/sponsor).' };
  }
  if (!partial || has('name')) {
    out.name = text(body.name, 200);
    if (!out.name) return { error: 'Le nom est obligatoire.' };
  }
  if (!partial || has('url')) {
    const u = validateUrl(body.url);
    if (u.error) return { error: u.error };
    out.url = u.value;
  }
  if (!partial || has('sort_order')) {
    const n = Number(body.sort_order ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > 9999) return { error: 'Ordre invalide (0 à 9999).' };
    out.sort_order = n;
  }
  return { value: out };
}

module.exports = { text, parseId, isRealDate, validateEvent, validateStats, validatePartner };
