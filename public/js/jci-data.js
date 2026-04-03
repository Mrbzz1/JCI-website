/**
 * Couche données : API SQLite (serveur) avec repli localStorage si pas de serveur.
 */
(function (global) {
  const LS = {
    agendaPublished: 'jciAgendaEvents',
    agendaDraft: 'jciAgendaEventsDraft',
    galleryPublished: 'jciGalleryImages',
    galleryDraft: 'jciGalleryImagesDraft',
    siteStatsPublished: 'jciSiteStats',
    siteStatsDraft: 'jciSiteStatsDraft',
    partnersPublished: 'jciPartners',
    partnersDraft: 'jciPartnersDraft'
  };

  let apiOk = null;

  async function checkApi() {
    if (apiOk !== null) return apiOk;
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      apiOk = r.ok;
    } catch {
      apiOk = false;
    }
    return apiOk;
  }

  function getAdminToken() {
    const token = sessionStorage.getItem('jciAdminToken') || '';
    console.log('[JciData] getAdminToken():', token ? token.substring(0, 8) + '...' : '(empty)');
    return token;
  }

  function adminHeaders(json) {
    const token = getAdminToken();
    console.log('[JciData] adminHeaders() - token being sent:', token ? token.substring(0, 8) + '...' : '(empty)');
    const h = { 'X-Admin-Token': token };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  /** Événements agenda (public / admin lecture) */
  async function getAgendaEvents() {
    if (await checkApi()) {
      const r = await fetch('/api/events');
      if (!r.ok) throw new Error('Impossible de charger l\'agenda.');
      return await r.json();
    }
    const raw = localStorage.getItem(LS.agendaPublished);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /** Brouillon admin agenda (localStorage uniquement) */
  function loadDraftEvents() {
    const raw = localStorage.getItem(LS.agendaDraft);
    if (!raw) {
      const pub = localStorage.getItem(LS.agendaPublished);
      if (!pub) return [];
      try {
        return JSON.parse(pub);
      } catch {
        return [];
      }
    }
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  function saveDraftEvents(events) {
    localStorage.setItem(LS.agendaDraft, JSON.stringify(events));
  }

  function publishAgendaLocal() {
    const draft = loadDraftEvents();
    localStorage.setItem(LS.agendaPublished, JSON.stringify(draft));
    localStorage.removeItem(LS.agendaDraft);
  }

  /** Admin : ajouter un événement */
  async function adminAddEvent(ev) {
    if (await checkApi()) {
      console.log('[JciData] adminAddEvent() - calling POST /api/events');
      const headers = adminHeaders(true);
      console.log('[JciData] adminAddEvent() - headers:', JSON.stringify(headers));
      const r = await fetch('/api/events', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(ev)
      });
      console.log('[JciData] adminAddEvent() - response status:', r.status);
      if (r.status === 401) {
        console.error('[JciData] adminAddEvent() - 401 Unauthorized');
        throw new Error('auth');
      }
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        console.error('[JciData] adminAddEvent() - error:', err);
        throw new Error(err.error || 'Erreur serveur');
      }
      return await r.json();
    }
    const events = loadDraftEvents();
    events.push(ev);
    saveDraftEvents(events);
    return ev;
  }

  /** Admin : supprimer un événement (id serveur ou index local) */
  async function adminDeleteEvent(idOrIndex) {
    if (await checkApi()) {
      const r = await fetch('/api/events/' + encodeURIComponent(idOrIndex), {
        method: 'DELETE',
        headers: adminHeaders(false)
      });
      if (r.status === 401) throw new Error('auth');
      if (!r.ok) throw new Error('Suppression impossible');
      return;
    }
    const events = loadDraftEvents();
    events.splice(Number(idOrIndex), 1);
    saveDraftEvents(events);
  }

  /** Liste pour l’admin (serveur ou brouillon local) */
  async function adminListEvents() {
    if (await checkApi()) {
      return await getAgendaEvents();
    }
    return loadDraftEvents();
  }

  /** Galerie : normalisée pour l’affichage { eventKey, eventTitle, src, dbId? } */
  async function getGalleryItems() {
    if (await checkApi()) {
      const r = await fetch('/api/gallery');
      if (!r.ok) return [];
      const rows = await r.json();
      return rows.map((row) => ({
        dbId: row.id,
        eventKey: row.event_key,
        eventTitle: row.event_title,
        name: row.original_name,
        src: '/api/gallery/' + row.id + '/image'
      }));
    }
    const raw = localStorage.getItem(LS.galleryPublished);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return arr.map((img) => ({
        eventKey: img.eventKey || 'autre',
        eventTitle: img.eventTitle || 'Autres actions',
        name: img.name,
        src: img.dataUrl,
        dataUrl: img.dataUrl
      }));
    } catch {
      return [];
    }
  }

  function loadDraftGallery() {
    const raw = localStorage.getItem(LS.galleryDraft);
    if (!raw) {
      const pub = localStorage.getItem(LS.galleryPublished);
      if (!pub) return [];
      try {
        return JSON.parse(pub);
      } catch {
        return [];
      }
    }
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  function saveDraftGallery(images) {
    localStorage.setItem(LS.galleryDraft, JSON.stringify(images));
  }

  function publishGalleryLocal() {
    const draft = loadDraftGallery();
    localStorage.setItem(LS.galleryPublished, JSON.stringify(draft));
    localStorage.removeItem(LS.galleryDraft);
  }

  async function adminGalleryListForUi() {
    if (await checkApi()) {
      return await getGalleryItems();
    }
    return loadDraftGallery().map((img, index) => ({
      localIndex: index,
      eventKey: img.eventKey || 'autre',
      eventTitle: img.eventTitle || 'Autre',
      name: img.name,
      src: img.dataUrl,
      dataUrl: img.dataUrl
    }));
  }

  async function adminAddGalleryImages({ eventKey, eventTitle, files }) {
    if (await checkApi()) {
      const fd = new FormData();
      fd.append('event_key', eventKey);
      fd.append('event_title', eventTitle);
      for (const f of files) {
        fd.append('images', f);
      }
      const r = await fetch('/api/gallery', {
        method: 'POST',
        headers: { 'X-Admin-Token': getAdminToken() },
        body: fd
      });
      if (r.status === 401) throw new Error('auth');
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Envoi impossible');
      }
      return await r.json();
    }
    const images = loadDraftGallery();
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Lecture fichier'));
        reader.readAsDataURL(file);
      });
      images.push({
        name: file.name,
        dataUrl,
        eventKey,
        eventTitle
      });
    }
    saveDraftGallery(images);
    return { ok: true };
  }

  async function adminDeleteGalleryImage(idOrLocalIndex) {
    if (await checkApi()) {
      const r = await fetch('/api/gallery/' + encodeURIComponent(idOrLocalIndex), {
        method: 'DELETE',
        headers: adminHeaders(false)
      });
      if (r.status === 401) throw new Error('auth');
      if (!r.ok) throw new Error('Suppression impossible');
      return;
    }
    const images = loadDraftGallery();
    images.splice(Number(idOrLocalIndex), 1);
    saveDraftGallery(images);
  }

  /** Chiffres du site */
  async function getSiteStats() {
    if (await checkApi()) {
      const r = await fetch('/api/site-stats', { cache: 'no-store' });
      if (!r.ok) throw new Error('stats');
      return await r.json();
    }
    const raw = localStorage.getItem(LS.siteStatsPublished);
    if (!raw) return { actions: 0, formations: 0, partenariats: 0 };
    try {
      return JSON.parse(raw);
    } catch {
      return { actions: 0, formations: 0, partenariats: 0 };
    }
  }

  function loadDraftSiteStats() {
    const raw = localStorage.getItem(LS.siteStatsDraft);
    if (!raw) {
      const pub = localStorage.getItem(LS.siteStatsPublished);
      if (!pub) return { actions: 0, formations: 0, partenariats: 0 };
      try {
        return JSON.parse(pub);
      } catch {
        return { actions: 0, formations: 0, partenariats: 0 };
      }
    }
    try {
      return JSON.parse(raw);
    } catch {
      return { actions: 0, formations: 0, partenariats: 0 };
    }
  }

  function saveDraftSiteStats(stats) {
    localStorage.setItem(LS.siteStatsDraft, JSON.stringify(stats || {}));
  }

  function publishSiteStatsLocal() {
    const draft = loadDraftSiteStats();
    localStorage.setItem(LS.siteStatsPublished, JSON.stringify(draft));
    localStorage.removeItem(LS.siteStatsDraft);
  }

  async function adminUpdateSiteStats(stats) {
    if (await checkApi()) {
      const r = await fetch('/api/site-stats', {
        method: 'PUT',
        headers: adminHeaders(true),
        body: JSON.stringify(stats || {})
      });
      if (r.status === 401) throw new Error('auth');
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Erreur serveur');
      }
      return await r.json();
    }
    saveDraftSiteStats(stats || {});
    return stats;
  }

  /** Partenaires / Sponsors */
  async function getPartners() {
    if (await checkApi()) {
      const r = await fetch('/api/partners', { cache: 'no-store' });
      if (!r.ok) return [];
      const rows = await r.json();
      return rows.map((row) => ({
        dbId: row.id,
        kind: row.kind,
        name: row.name,
        url: row.url || '',
        sortOrder: row.sort_order || 0,
        src: '/api/partners/' + row.id + '/logo'
      }));
    }
    const raw = localStorage.getItem(LS.partnersPublished);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return (arr || []).map((p) => ({
        kind: p.kind,
        name: p.name,
        url: p.url || '',
        sortOrder: p.sortOrder || 0,
        dataUrl: p.dataUrl,
        src: p.dataUrl
      }));
    } catch {
      return [];
    }
  }

  function loadDraftPartners() {
    const raw = localStorage.getItem(LS.partnersDraft);
    if (!raw) {
      const pub = localStorage.getItem(LS.partnersPublished);
      if (!pub) return [];
      try {
        return JSON.parse(pub);
      } catch {
        return [];
      }
    }
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  function saveDraftPartners(items) {
    localStorage.setItem(LS.partnersDraft, JSON.stringify(items || []));
  }

  function publishPartnersLocal() {
    const draft = loadDraftPartners();
    localStorage.setItem(LS.partnersPublished, JSON.stringify(draft));
    localStorage.removeItem(LS.partnersDraft);
  }

  async function adminPartnersListForUi() {
    if (await checkApi()) {
      return await getPartners();
    }
    return loadDraftPartners().map((p, index) => ({
      localIndex: index,
      kind: p.kind,
      name: p.name,
      url: p.url || '',
      sortOrder: p.sortOrder || 0,
      dataUrl: p.dataUrl,
      src: p.dataUrl
    }));
  }

  async function adminAddPartner({ kind, name, url, sortOrder, file }) {
    if (await checkApi()) {
      const fd = new FormData();
      fd.append('kind', String(kind || '').trim());
      fd.append('name', String(name || '').trim());
      fd.append('url', String(url || '').trim());
      fd.append('sort_order', String(sortOrder || 0));
      fd.append('logo', file);
      const r = await fetch('/api/partners', {
        method: 'POST',
        headers: { 'X-Admin-Token': getAdminToken() },
        body: fd
      });
      if (r.status === 401) throw new Error('auth');
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Envoi impossible');
      }
      return await r.json();
    }
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Lecture fichier'));
      reader.readAsDataURL(file);
    });
    const items = loadDraftPartners();
    items.push({
      kind: String(kind || 'partner'),
      name: String(name || '').trim(),
      url: String(url || '').trim(),
      sortOrder: Number(sortOrder || 0) || 0,
      dataUrl
    });
    saveDraftPartners(items);
    return { ok: true };
  }

  async function adminDeletePartner(idOrLocalIndex) {
    if (await checkApi()) {
      const r = await fetch('/api/partners/' + encodeURIComponent(idOrLocalIndex), {
        method: 'DELETE',
        headers: adminHeaders(false)
      });
      if (r.status === 401) throw new Error('auth');
      if (!r.ok) throw new Error('Suppression impossible');
      return;
    }
    const items = loadDraftPartners();
    items.splice(Number(idOrLocalIndex), 1);
    saveDraftPartners(items);
  }

  async function usesServer() {
    return await checkApi();
  }

  global.JciData = {
    checkApi,
    getAdminToken,
    setAdminToken: (t) => sessionStorage.setItem('jciAdminToken', t),
    clearAdminToken: () => sessionStorage.removeItem('jciAdminToken'),
    LS,
    getAgendaEvents,
    loadDraftEvents,
    saveDraftEvents,
    publishAgendaLocal,
    adminAddEvent,
    adminDeleteEvent,
    adminListEvents,
    getGalleryItems,
    loadDraftGallery,
    saveDraftGallery,
    publishGalleryLocal,
    adminGalleryListForUi,
    adminAddGalleryImages,
    adminDeleteGalleryImage,
    getSiteStats,
    loadDraftSiteStats,
    saveDraftSiteStats,
    publishSiteStatsLocal,
    adminUpdateSiteStats,
    getPartners,
    loadDraftPartners,
    saveDraftPartners,
    publishPartnersLocal,
    adminPartnersListForUi,
    adminAddPartner,
    adminDeletePartner,
    usesServer
  };
})(typeof window !== 'undefined' ? window : globalThis);
