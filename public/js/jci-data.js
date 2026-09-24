/**
 * Couche données : API SQLite du serveur de production.
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

  async function requireApi() {
    if (!(await checkApi())) {
      throw new Error('Serveur indisponible. La modification n’a pas été enregistrée.');
    }
  }

  function getAdminToken() {
    return sessionStorage.getItem('jciAdminToken') || '';
  }

  function adminHeaders(json) {
    const h = { 'X-Admin-Token': getAdminToken() };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function checkAdminToken(password) {
    if (!password || !(await checkApi())) return false;
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: String(password) }),
        cache: 'no-store'
      });
      if (!r.ok) return false;
      const data = await r.json();
      return data.token || false;
    } catch {
      return false;
    }
  }

  /** Événements agenda (public / admin lecture) */
  async function getAgendaEvents() {
    await requireApi();
    const r = await fetch('/api/events', { cache: 'no-store' });
    if (!r.ok) throw new Error('Impossible de charger l\'agenda.');
    return await r.json();
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
    await requireApi();
    const r = await fetch('/api/events', {
      method: 'POST',
      headers: adminHeaders(true),
      body: JSON.stringify(ev)
    });
    if (r.status === 401) throw new Error('auth');
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur serveur');
    }
    return await r.json();
  }

  /** Admin : supprimer un événement (id serveur ou index local) */
  async function adminDeleteEvent(idOrIndex) {
    await requireApi();
    const r = await fetch('/api/events/' + encodeURIComponent(idOrIndex), {
      method: 'DELETE',
      headers: adminHeaders(false)
    });
    if (r.status === 401) throw new Error('auth');
    if (!r.ok) throw new Error('Suppression impossible');
  }

  /** Liste pour l’admin (serveur ou brouillon local) */
  async function adminListEvents() {
    return await getAgendaEvents();
  }

  /** Galerie : normalisée pour l’affichage { eventKey, eventTitle, src, dbId? } */
  async function getGalleryItems() {
    await requireApi();
    const r = await fetch('/api/gallery', { cache: 'no-store' });
    if (!r.ok) throw new Error('Impossible de charger la galerie.');
    const rows = await r.json();
    return rows.map((row) => ({
      dbId: row.id,
      eventKey: row.event_key,
      eventTitle: row.event_title,
      name: row.original_name,
      src: '/api/gallery/' + row.id + '/image'
    }));
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
    return await getGalleryItems();
  }

  async function adminAddGalleryImages({ eventKey, eventTitle, files }) {
    await requireApi();
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

  async function adminDeleteGalleryImage(idOrLocalIndex) {
    await requireApi();
    const r = await fetch('/api/gallery/' + encodeURIComponent(idOrLocalIndex), {
      method: 'DELETE',
      headers: adminHeaders(false)
    });
    if (r.status === 401) throw new Error('auth');
    if (!r.ok) throw new Error('Suppression impossible');
  }

  /** Chiffres du site */
  async function getSiteStats() {
    await requireApi();
    const r = await fetch('/api/site-stats', { cache: 'no-store' });
    if (!r.ok) throw new Error('Impossible de charger les statistiques.');
    return await r.json();
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
    await requireApi();
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

  /** Partenaires / Sponsors */
  async function getPartners() {
    await requireApi();
    const r = await fetch('/api/partners', { cache: 'no-store' });
    if (!r.ok) throw new Error('Impossible de charger les partenaires.');
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
    return await getPartners();
  }

  async function adminAddPartner({ kind, name, url, sortOrder, file }) {
    await requireApi();
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

  async function adminDeletePartner(idOrLocalIndex) {
    await requireApi();
    const r = await fetch('/api/partners/' + encodeURIComponent(idOrLocalIndex), {
      method: 'DELETE',
      headers: adminHeaders(false)
    });
    if (r.status === 401) throw new Error('auth');
    if (!r.ok) throw new Error('Suppression impossible');
  }

  async function usesServer() {
    return await checkApi();
  }

  global.JciData = {
    checkApi,
    checkAdminToken,
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
