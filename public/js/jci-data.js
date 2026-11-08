/**
 * Couche données centralisée — TOUTES les données partagées viennent de l'API Railway.
 *
 *  - L'URL de l'API vient de window.JCI_CONFIG.apiBaseUrl (js/runtime-config.js, généré au build Vercel
 *    depuis JCI_API_BASE_URL). Aucun appel n'est jamais fait vers le /api de Vercel.
 *  - Aucun repli silencieux sur localStorage : en cas d'échec, une JciError explicite est levée.
 *  - localStorage n'est utilisé que pour des préférences d'interface (langue…), jamais pour le contenu.
 *  - sessionStorage contient uniquement le jeton JWT de la session admin (pas le mot de passe).
 */
(function (global) {
  const cfg = global.JCI_CONFIG || {};
  const API_BASE = String(cfg.apiBaseUrl || '').trim().replace(/\/+$/, '');
  const CONFIG_OK = Boolean(API_BASE) || cfg.sameOrigin === true;
  const TOKEN_KEY = 'jciAdminToken';
  const READ_TIMEOUT_MS = 20000;   // Railway peut mettre quelques secondes à se réveiller
  const WRITE_TIMEOUT_MS = 30000;
  const UPLOAD_TIMEOUT_MS = 120000;

  /** Erreur typée : code = config | network | timeout | auth | rate | http */
  class JciError extends Error {
    constructor(code, message, status) {
      super(message);
      this.name = 'JciError';
      this.code = code;
      this.status = status || 0;
    }
  }

  const MESSAGES = {
    config: 'Configuration manquante : l’URL de l’API (JCI_API_BASE_URL) n’est pas définie. Aucune donnée ne peut être chargée.',
    network: 'Serveur injoignable. Vérifiez votre connexion ou réessayez dans un instant. Rien n’a été enregistré.',
    timeout: 'Le serveur met trop de temps à répondre. Réessayez dans un instant.',
    auth: 'Session expirée ou non autorisée. Reconnectez-vous.',
    rate: 'Trop de tentatives. Réessayez dans quelques minutes.'
  };

  function apiUrl(path) {
    return API_BASE + path;
  }

  // ---------- Indicateur de chargement (barre fine en haut de page, sans toucher au design) ----------
  let pending = 0;
  function setBusy(delta) {
    pending = Math.max(0, pending + delta);
    if (typeof document === 'undefined' || !document.body) return;
    let bar = document.getElementById('jci-progress');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'jci-progress';
      bar.className = 'jci-progress';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', 'Chargement');
      document.body.appendChild(bar);
    }
    bar.classList.toggle('is-active', pending > 0);
    document.documentElement.setAttribute('aria-busy', pending > 0 ? 'true' : 'false');
  }

  // ---------- Jeton admin (session uniquement) ----------
  const getAdminToken = () => sessionStorage.getItem(TOKEN_KEY) || '';
  const setAdminToken = (t) => sessionStorage.setItem(TOKEN_KEY, t);
  const clearAdminToken = () => sessionStorage.removeItem(TOKEN_KEY);

  /**
   * Requête unique vers l'API. Lève JciError — ne renvoie jamais de fausses données.
   * opts: { method, json, form, auth, timeout, raw }
   */
  async function request(path, opts) {
    const o = opts || {};
    if (!CONFIG_OK) throw new JciError('config', MESSAGES.config);

    const headers = {};
    let body;
    if (o.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(o.json);
    } else if (o.form) {
      body = o.form; // FormData : le navigateur fixe le Content-Type multipart
    }
    if (o.auth) headers.Authorization = 'Bearer ' + getAdminToken();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), o.timeout || READ_TIMEOUT_MS);
    setBusy(1);
    let res;
    try {
      res = await fetch(apiUrl(path), {
        method: o.method || 'GET',
        headers,
        body,
        cache: 'no-store',
        signal: controller.signal
      });
    } catch (err) {
      throw err && err.name === 'AbortError'
        ? new JciError('timeout', MESSAGES.timeout)
        : new JciError('network', MESSAGES.network);
    } finally {
      clearTimeout(timer);
      setBusy(-1);
    }

    if (res.status === 401 && o.auth) {
      clearAdminToken();
      throw new JciError('auth', MESSAGES.auth, 401);
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error || ''; } catch (e) { /* corps non JSON */ }
      if (res.status === 429) throw new JciError('rate', detail || MESSAGES.rate, 429);
      throw new JciError('http', detail || 'Erreur serveur (' + res.status + ').', res.status);
    }
    return o.raw ? res : res.json();
  }

  // ---------- Santé / authentification ----------
  /** true si l'API répond 200 sur /api/health (jamais mis en cache). */
  async function checkApi() {
    try {
      await request('/api/health', { timeout: 10000 });
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Connexion admin. Lève JciError : 'auth' = mauvais mot de passe, 'network'/'timeout'/'config' = serveur. */
  async function adminLogin(password) {
    try {
      const data = await request('/api/admin/login', { method: 'POST', json: { password: String(password || '') } });
      if (!data.token) throw new JciError('http', 'Réponse de connexion invalide.');
      setAdminToken(data.token);
      return true;
    } catch (e) {
      if (e.code === 'http' && e.status === 401) throw new JciError('auth', 'Mot de passe incorrect.', 401);
      throw e;
    }
  }

  // ---------- Agenda ----------
  const getAgendaEvents = () => request('/api/events');
  const adminAddEvent = (ev) => request('/api/events', { method: 'POST', json: ev, auth: true, timeout: WRITE_TIMEOUT_MS });
  const adminUpdateEvent = (id, ev) =>
    request('/api/events/' + encodeURIComponent(id), { method: 'PUT', json: ev, auth: true, timeout: WRITE_TIMEOUT_MS });
  const adminDeleteEvent = (id) =>
    request('/api/events/' + encodeURIComponent(id), { method: 'DELETE', auth: true, timeout: WRITE_TIMEOUT_MS });

  // ---------- Galerie ----------
  /** Normalisée pour l'affichage : { dbId, eventKey, eventTitle, name, src } */
  async function getGalleryItems() {
    const rows = await request('/api/gallery');
    return rows.map((row) => ({
      dbId: row.id,
      eventKey: row.event_key,
      eventTitle: row.event_title,
      name: row.original_name,
      src: apiUrl('/api/gallery/' + row.id + '/image')
    }));
  }

  function adminAddGalleryImages({ eventKey, eventTitle, files }) {
    const fd = new FormData();
    fd.append('event_key', eventKey);
    fd.append('event_title', eventTitle);
    for (const f of files) fd.append('images', f);
    return request('/api/gallery', { method: 'POST', form: fd, auth: true, timeout: UPLOAD_TIMEOUT_MS });
  }

  const adminDeleteGalleryImage = (id) =>
    request('/api/gallery/' + encodeURIComponent(id), { method: 'DELETE', auth: true, timeout: WRITE_TIMEOUT_MS });

  // ---------- Chiffres du site ----------
  const getSiteStats = () => request('/api/site-stats');
  const adminUpdateSiteStats = (stats) =>
    request('/api/site-stats', { method: 'PUT', json: stats || {}, auth: true, timeout: WRITE_TIMEOUT_MS });

  // ---------- Partenaires / sponsors ----------
  async function getPartners() {
    const rows = await request('/api/partners');
    return rows.map((row) => ({
      dbId: row.id,
      kind: row.kind,
      name: row.name,
      url: row.url || '',
      sortOrder: row.sort_order || 0,
      src: apiUrl('/api/partners/' + row.id + '/logo')
    }));
  }

  function adminAddPartner({ kind, name, url, sortOrder, file }) {
    const fd = new FormData();
    fd.append('kind', String(kind || '').trim());
    fd.append('name', String(name || '').trim());
    fd.append('url', String(url || '').trim());
    fd.append('sort_order', String(sortOrder || 0));
    fd.append('logo', file);
    return request('/api/partners', { method: 'POST', form: fd, auth: true, timeout: UPLOAD_TIMEOUT_MS });
  }

  const adminUpdatePartner = (id, fields) =>
    request('/api/partners/' + encodeURIComponent(id), { method: 'PUT', json: fields, auth: true, timeout: WRITE_TIMEOUT_MS });

  const adminDeletePartner = (id) =>
    request('/api/partners/' + encodeURIComponent(id), { method: 'DELETE', auth: true, timeout: WRITE_TIMEOUT_MS });

  // ---------- Sauvegarde serveur (snapshot SQLite sur le volume) ----------
  const adminBackup = () => request('/api/admin/backup', { method: 'POST', auth: true, timeout: WRITE_TIMEOUT_MS });

  global.JciData = {
    JciError,
    apiBase: API_BASE,
    configOk: CONFIG_OK,
    checkApi,
    adminLogin,
    getAdminToken,
    setAdminToken,
    clearAdminToken,
    getAgendaEvents,
    adminListEvents: getAgendaEvents,
    adminAddEvent,
    adminUpdateEvent,
    adminDeleteEvent,
    getGalleryItems,
    adminAddGalleryImages,
    adminDeleteGalleryImage,
    getSiteStats,
    adminUpdateSiteStats,
    getPartners,
    adminAddPartner,
    adminUpdatePartner,
    adminDeletePartner,
    adminBackup
  };
})(typeof window !== 'undefined' ? window : globalThis);
