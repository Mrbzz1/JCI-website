/**
 * Migration ponctuelle : ancien contenu stocké dans localStorage (mode « navigateur ») → serveur Railway.
 *
 * Garanties :
 *  - une sauvegarde serveur (snapshot SQLite) est créée AVANT toute écriture ; échec = arrêt ;
 *  - aucune donnée serveur n'est jamais écrasée ni dupliquée (éléments déjà présents = ignorés) ;
 *  - les chiffres du site ne sont importés que si ceux du serveur sont encore tous à zéro ;
 *  - les données locales ne sont supprimées que sur demande explicite, après une vérification réussie.
 */
(function (global) {
  const KEYS = {
    events: ['jciAgendaEvents', 'jciAgendaEventsDraft'],
    gallery: ['jciGalleryImages', 'jciGalleryImagesDraft'],
    stats: ['jciSiteStats', 'jciSiteStatsDraft'],
    partners: ['jciPartners', 'jciPartnersDraft']
  };
  const ALL_KEYS = [].concat(KEYS.events, KEYS.gallery, KEYS.stats, KEYS.partners);

  let lastRunVerified = false;

  function readJson(key) {
    try {
      const raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  const evKey = (e) => [e.date, e.title, e.place].map((v) => String(v || '').trim().toLowerCase()).join('|');
  const partnerKey = (p) => [p.kind, p.name].map((v) => String(v || '').trim().toLowerCase()).join('|');
  const galleryKey = (g) => [g.eventKey || g.event_key, g.name || g.original_name].map((v) => String(v || '').trim()).join('|');

  function uniqueBy(list, keyFn) {
    const seen = new Set();
    return list.filter((item) => {
      const k = keyFn(item);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** Lit le contenu local. includeDrafts=false : seules les données « publiées » (visibles à l'époque). */
  function detect(includeDrafts) {
    const pick = (keys) => (includeDrafts ? keys : [keys[0]]);
    const arrays = (keys) => [].concat(...pick(keys).map((k) => (Array.isArray(readJson(k)) ? readJson(k) : [])));
    const events = uniqueBy(arrays(KEYS.events).filter((e) => e && e.date && e.title), evKey);
    // Images locales : dédoublonnées sur le contenu exact (deux photos différentes de même nom restent distinctes).
    const gallery = uniqueBy(arrays(KEYS.gallery).filter((g) => g && g.dataUrl), (g) => g.dataUrl);
    const partners = uniqueBy(arrays(KEYS.partners).filter((p) => p && p.dataUrl && p.name), partnerKey);
    let stats = null;
    for (const k of pick(KEYS.stats).slice().reverse()) {
      const s = readJson(k);
      if (s && typeof s === 'object' && !Array.isArray(s)) { stats = s; break; }
    }
    const hasStats = !!stats && ['actions', 'formations', 'partenariats'].some((k) => Number(stats[k]) > 0);
    return {
      events, gallery, partners, stats: hasStats ? stats : null,
      counts: { events: events.length, gallery: gallery.length, partners: partners.length, stats: hasStats ? 1 : 0 },
      draftKeysPresent: ALL_KEYS.filter((k) => /Draft$/.test(k) && global.localStorage.getItem(k) !== null)
    };
  }

  const hasLocalData = (d) => d.counts.events + d.counts.gallery + d.counts.partners + d.counts.stats > 0;

  /** JSON complet (brut) de toutes les clés locales — à télécharger avant de migrer. */
  function exportBackup() {
    const dump = { exportedAt: new Date().toISOString(), origin: global.location ? global.location.origin : '', keys: {} };
    ALL_KEYS.forEach((k) => {
      const v = readJson(k);
      if (v !== null) dump.keys[k] = v;
    });
    return JSON.stringify(dump, null, 2);
  }

  async function dataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return res.blob();
  }

  async function run({ includeDrafts = false, onProgress = () => {} } = {}) {
    lastRunVerified = false;
    const local = detect(includeDrafts);
    const report = { created: { events: 0, gallery: 0, partners: 0, stats: 0 }, skipped: { events: 0, gallery: 0, partners: 0, stats: 0 }, failed: [], backup: null, verified: false };
    if (!hasLocalData(local)) return report;

    onProgress('Sauvegarde du serveur…');
    report.backup = (await JciData.adminBackup()).file; // lève une erreur → migration annulée avant toute écriture

    onProgress('Lecture des données du serveur…');
    const [srvEvents, srvGallery, srvPartners, srvStats] = await Promise.all([
      JciData.getAgendaEvents(), JciData.getGalleryItems(), JciData.getPartners(), JciData.getSiteStats()
    ]);
    const evSeen = new Set(srvEvents.map(evKey));
    const galSeen = new Set(srvGallery.map(galleryKey));
    const partSeen = new Set(srvPartners.map(partnerKey));

    for (const e of local.events) {
      if (evSeen.has(evKey(e))) { report.skipped.events++; continue; }
      onProgress('Événement : ' + e.title);
      try {
        await JciData.adminAddEvent({ date: e.date, title: e.title, type: e.type || 'Événement', place: e.place || '', description: e.description || '' });
        report.created.events++;
      } catch (err) { report.failed.push('Événement « ' + e.title + ' » : ' + err.message); }
    }

    const serverStatsEmpty = ['actions', 'formations', 'partenariats'].every((k) => Number(srvStats[k]) === 0);
    if (local.stats) {
      if (serverStatsEmpty) {
        try {
          await JciData.adminUpdateSiteStats({ actions: Number(local.stats.actions) || 0, formations: Number(local.stats.formations) || 0, partenariats: Number(local.stats.partenariats) || 0 });
          report.created.stats++;
        } catch (err) { report.failed.push('Chiffres : ' + err.message); }
      } else {
        report.skipped.stats++; // le serveur a déjà des chiffres : jamais écrasés
      }
    }

    for (const p of local.partners) {
      if (partSeen.has(partnerKey(p))) { report.skipped.partners++; continue; }
      onProgress('Partenaire : ' + p.name);
      try {
        const blob = await dataUrlToBlob(p.dataUrl);
        await JciData.adminAddPartner({ kind: p.kind, name: p.name, url: p.url || '', sortOrder: p.sortOrder || 0, file: new File([blob], (p.name || 'logo') + '.' + (blob.type.split('/')[1] || 'png'), { type: blob.type }) });
        report.created.partners++;
      } catch (err) { report.failed.push('Partenaire « ' + p.name + ' » : ' + err.message); }
    }

    let n = 0;
    for (const g of local.gallery) {
      n++;
      if (galSeen.has(galleryKey(g))) { report.skipped.gallery++; continue; }
      onProgress('Image ' + n + '/' + local.gallery.length);
      try {
        const blob = await dataUrlToBlob(g.dataUrl);
        const file = new File([blob], g.name || 'image', { type: blob.type });
        await JciData.adminAddGalleryImages({ eventKey: g.eventKey, eventTitle: g.eventTitle || g.eventKey, files: [file] });
        report.created.gallery++;
      } catch (err) { report.failed.push('Image « ' + (g.name || n) + ' » : ' + err.message); }
    }

    // Vérification : tout ce qui est local doit maintenant exister sur le serveur.
    onProgress('Vérification…');
    const [vEvents, vGallery, vPartners] = await Promise.all([JciData.getAgendaEvents(), JciData.getGalleryItems(), JciData.getPartners()]);
    const vEv = new Set(vEvents.map(evKey)); const vGal = new Set(vGallery.map(galleryKey)); const vPart = new Set(vPartners.map(partnerKey));
    const missing = []
      .concat(local.events.filter((e) => !vEv.has(evKey(e))).map((e) => 'Événement « ' + e.title + ' »'))
      .concat(local.partners.filter((p) => !vPart.has(partnerKey(p))).map((p) => 'Partenaire « ' + p.name + ' »'))
      .concat(local.gallery.filter((g) => !vGal.has(galleryKey(g))).map((g) => 'Image « ' + (g.name || '?') + ' »'));
    report.missing = missing;
    report.verified = missing.length === 0 && report.failed.length === 0;
    lastRunVerified = report.verified;
    return report;
  }

  /** Supprime les clés locales migrées. Refuse tant qu'une migration vérifiée n'a pas eu lieu. */
  function clearLocal() {
    if (!lastRunVerified) throw new Error('Migration non vérifiée : les données locales sont conservées.');
    ALL_KEYS.forEach((k) => global.localStorage.removeItem(k));
    lastRunVerified = false;
  }

  global.JciMigrate = { detect, hasLocalData, exportBackup, run, clearLocal, ALL_KEYS };
})(typeof window !== 'undefined' ? window : globalThis);
