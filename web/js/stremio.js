/* Onyx — mini client Stremio (protocole des addons + compte Stremio)
 * Partagé entre l'app TV et la télécommande téléphone. */
(function () {
  'use strict';
  var Onyx = window.Onyx = window.Onyx || {};

  var DEFAULT_ADDONS = [
    'https://v3-cinemeta.strem.io/manifest.json',
    'https://opensubtitles-v3.strem.io/manifest.json'
  ];
  var API = 'https://api.strem.io/api/';

  var S = Onyx.Stremio = {
    addons: [],          // [{transportUrl, manifest}]
    persist: true,       // false pour la télécommande (la liste vient de la TV)
    listeners: []
  };

  function load(k, d) { try { var v = localStorage.getItem('onyx.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem('onyx.' + k, JSON.stringify(v)); } catch (e) { } }

  /* ---------- Réseau ---------- */
  var cache = {};
  S.fetchJSON = function (url, opts) {
    opts = opts || {};
    var ttl = opts.ttl === undefined ? 10 * 60 * 1000 : opts.ttl;
    var c = cache[url];
    if (!opts.body && c && Date.now() - c.t < ttl) return c.p;
    var p = new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, opts.timeout || 15000);
      var init = opts.body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts.body) } : {};
      fetch(url, init).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) { if (!done) { done = true; clearTimeout(timer); resolve(j); } })
        .catch(function (e) { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    });
    if (!opts.body) {
      cache[url] = { t: Date.now(), p: p };
      p.catch(function () { delete cache[url]; });
    }
    return p;
  };

  /* ---------- Gestion des addons ---------- */
  S.normalizeUrl = function (u) {
    u = String(u || '').trim();
    if (!u) return u;
    u = u.replace(/^stremio:\/\//i, 'https://');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    if (!/manifest\.json(\?.*)?$/i.test(u)) u = u.replace(/\/+$/, '') + '/manifest.json';
    return u;
  };
  S.base = function (addon) {
    var u = typeof addon === 'string' ? addon : addon.transportUrl;
    return u.replace(/\/manifest\.json(\?.*)?$/i, '');
  };

  S.onChange = function (fn) { S.listeners.push(fn); };
  function changed() {
    if (S.persist) save('addons', S.addons);
    S.listeners.forEach(function (f) { try { f(S.addons); } catch (e) { } });
  }

  S.init = function () {
    var stored = S.persist ? load('addons', null) : null;
    if (stored && stored.length) {
      S.addons = stored;
      // rafraîchit les manifests en arrière-plan
      S.addons.forEach(function (a) {
        S.fetchJSON(a.transportUrl, { ttl: 0, timeout: 10000 }).then(function (m) {
          if (m && m.id) { a.manifest = m; changed(); }
        }).catch(function () { });
      });
      return Promise.resolve(S.addons);
    }
    return Promise.all(DEFAULT_ADDONS.map(function (u) {
      return S.fetchJSON(u).then(function (m) { return { transportUrl: u, manifest: m }; }).catch(function () { return null; });
    })).then(function (list) {
      S.addons = list.filter(Boolean);
      if (S.addons.length) changed();
      return S.addons;
    });
  };

  S.install = function (url) {
    url = S.normalizeUrl(url);
    return S.fetchJSON(url, { ttl: 0 }).then(function (m) {
      if (!m || !m.id) throw new Error('Manifest invalide');
      var existing = S.addons.filter(function (a) { return a.transportUrl === url || a.manifest.id === m.id; })[0];
      if (existing) { existing.transportUrl = url; existing.manifest = m; }
      else S.addons.push({ transportUrl: url, manifest: m });
      changed();
      return m;
    });
  };
  S.remove = function (url) {
    S.addons = S.addons.filter(function (a) { return a.transportUrl !== url; });
    changed();
  };
  S.move = function (url, delta) {
    var i = S.addons.findIndex(function (a) { return a.transportUrl === url; });
    var j = i + delta;
    if (i < 0 || j < 0 || j >= S.addons.length) return;
    var t = S.addons[i]; S.addons[i] = S.addons[j]; S.addons[j] = t;
    changed();
  };
  S.setAddons = function (list) {
    S.addons = (list || []).filter(function (a) { return a && a.transportUrl && a.manifest; });
    changed();
  };
  S.isInstalled = function (url) {
    return S.addons.some(function (a) { return a.transportUrl === url; });
  };

  /* ---------- Capacités ---------- */
  function resource(m, name) {
    var r = (m.resources || []).filter(function (x) { return (typeof x === 'string' ? x : x.name) === name; })[0];
    if (!r) return null;
    return typeof r === 'string' ? {} : r;
  }
  S.supports = function (addon, name, type, id) {
    var m = addon.manifest || {};
    var r = resource(m, name);
    if (!r) return false;
    var types = r.types || m.types;
    if (type && types && types.length && types.indexOf(type) < 0) return false;
    var pref = r.idPrefixes || m.idPrefixes;
    if (id && pref && pref.length && !pref.some(function (p) { return id.indexOf(p) === 0; })) return false;
    return true;
  };

  function extraDefs(cat) {
    var defs = (cat.extra || []).slice();
    (cat.extraRequired || []).forEach(function (n) { defs.push({ name: n, isRequired: true }); });
    (cat.extraSupported || []).forEach(function (n) { if (!defs.some(function (d) { return d.name === n; })) defs.push({ name: n }); });
    return defs;
  }
  S.catalogSupports = function (cat, extraName) {
    return extraDefs(cat).some(function (d) { return d.name === extraName; });
  };
  S.genresOf = function (cat) {
    var g = extraDefs(cat).filter(function (d) { return d.name === 'genre'; })[0];
    return (g && g.options) || cat.genres || [];
  };
  function needsExtra(cat) {
    return extraDefs(cat).some(function (d) { return d.isRequired; });
  }

  /* Catalogues affichables sur l'accueil (sans paramètre obligatoire) */
  S.homeCatalogs = function (type) {
    var out = [];
    S.addons.forEach(function (a) {
      if (!resource(a.manifest, 'catalog')) return;
      (a.manifest.catalogs || []).forEach(function (c) {
        if (needsExtra(c)) return;
        if (type && c.type !== type) return;
        out.push({ addon: a, type: c.type, id: c.id, name: c.name || c.id, def: c });
      });
    });
    return out;
  };
  S.searchCatalogs = function () {
    var out = [];
    S.addons.forEach(function (a) {
      (a.manifest.catalogs || []).forEach(function (c) {
        if (S.catalogSupports(c, 'search')) out.push({ addon: a, type: c.type, id: c.id, name: c.name || c.id, def: c });
      });
    });
    return out;
  };

  function extraPath(extra) {
    if (!extra) return '';
    var keys = Object.keys(extra).filter(function (k) { return extra[k] !== undefined && extra[k] !== null && extra[k] !== ''; });
    if (!keys.length) return '';
    return '/' + keys.map(function (k) { return k + '=' + encodeURIComponent(extra[k]); }).join('&');
  }

  S.catalog = function (addon, type, id, extra) {
    var url = S.base(addon) + '/catalog/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + extraPath(extra) + '.json';
    return S.fetchJSON(url).then(function (j) { return (j && j.metas) || []; });
  };

  S.search = function (query) {
    var cats = S.searchCatalogs();
    return Promise.all(cats.map(function (c) {
      return S.catalog(c.addon, c.type, c.id, { search: query })
        .then(function (metas) { return { cat: c, metas: metas }; })
        .catch(function () { return { cat: c, metas: [] }; });
    })).then(function (res) { return res.filter(function (r) { return r.metas.length; }); });
  };

  S.meta = function (type, id) {
    var list = S.addons.filter(function (a) { return S.supports(a, 'meta', type, id); });
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.reject(new Error('Aucune fiche trouvée'));
      var a = list[i++];
      return S.fetchJSON(S.base(a) + '/meta/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json')
        .then(function (j) { if (j && j.meta) return j.meta; return next(); })
        .catch(next);
    }
    return next();
  };

  /* Sources : appelle onAddon({addon, streams, error}) au fur et à mesure */
  S.streamAddons = function (type, id) {
    return S.addons.filter(function (a) { return S.supports(a, 'stream', type, id); });
  };
  S.streams = function (type, id, onAddon) {
    var list = S.streamAddons(type, id);
    return Promise.all(list.map(function (a) {
      return S.fetchJSON(S.base(a) + '/stream/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json', { ttl: 10 * 60 * 1000, timeout: 45000 })
        .then(function (j) { var r = { addon: a, streams: (j && j.streams) || [] }; if (onAddon) onAddon(r); return r; })
        .catch(function (e) { var r = { addon: a, streams: [], error: e.message }; if (onAddon) onAddon(r); return r; });
    }));
  };

  S.subtitles = function (type, id, extra) {
    var list = S.addons.filter(function (a) { return S.supports(a, 'subtitles', type, id); });
    return Promise.all(list.map(function (a) {
      return S.fetchJSON(S.base(a) + '/subtitles/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + extraPath(extra) + '.json', { timeout: 8000 })
        .then(function (j) { return (j && j.subtitles) || []; }).catch(function () { return []; });
    })).then(function (all) { return [].concat.apply([], all); });
  };

  S.addonCatalog = function (which) {
    var src = S.addons.filter(function (a) { return resource(a.manifest, 'addon_catalog'); });
    if (!src.length) src = [{ transportUrl: DEFAULT_ADDONS[0] }];
    return S.fetchJSON(S.base(src[0]) + '/addon_catalog/all/' + (which || 'community') + '.json')
      .then(function (j) { return (j && j.addons) || []; });
  };

  /* ---------- Analyse des sources ---------- */
  var LANGS = {
    fr: { label: 'Français', re: /\b(vff|vfq|vfi|vf2|vf|truefrench|french|fran[cç]ais|fre|fra)\b|🇫🇷/i, subs: ['fr', 'fre', 'fra', 'fr-fr', 'french'] },
    en: { label: 'Anglais', re: /\b(english|eng)\b|🇬🇧|🇺🇸/i, subs: ['en', 'eng', 'en-us', 'en-gb', 'english'] },
    es: { label: 'Espagnol', re: /\b(spanish|castellano|latino|esp|spa)\b|🇪🇸|🇲🇽/i, subs: ['es', 'spa', 'spanish'] },
    de: { label: 'Allemand', re: /\b(german|deutsch|ger|deu)\b|🇩🇪/i, subs: ['de', 'ger', 'deu', 'german'] },
    it: { label: 'Italien', re: /\b(italian|ita)\b|🇮🇹/i, subs: ['it', 'ita', 'italian'] },
    pt: { label: 'Portugais', re: /\b(portuguese|por|pt-br)\b|🇵🇹|🇧🇷/i, subs: ['pt', 'por', 'pob', 'pt-br', 'portuguese'] },
    ar: { label: 'Arabe', re: /\b(arabic|ara)\b|🇸🇦/i, subs: ['ar', 'ara', 'arabic'] }
  };
  S.LANGS = LANGS;
  S.deviceLang = function () {
    var l = String((navigator.languages && navigator.languages[0]) || navigator.language || 'fr').slice(0, 2).toLowerCase();
    return LANGS[l] ? l : 'fr';
  };
  S.langLabel = function (code) {
    if (code === 'vo') return 'Version originale (VO)';
    if (code === 'off') return 'Désactivés';
    return (LANGS[code] && LANGS[code].label) || code;
  };
  S.subLangMatch = function (lang, code) {
    lang = String(lang || '').toLowerCase();
    var L = LANGS[code];
    return L ? L.subs.indexOf(lang) >= 0 : lang === code;
  };

  S.QUALITIES = [
    { value: 'auto', label: 'Automatique (la meilleure)' }, { value: 2160, label: '4K (2160p)' }, { value: 1440, label: '1440p' },
    { value: 1080, label: 'Full HD (1080p)' }, { value: 720, label: 'HD (720p)' }, { value: 480, label: 'SD (480p)' }
  ];
  S.qualityLabel = function (v) {
    if (v === 'auto' || !v) return 'Auto';
    return v >= 2160 ? '4K' : v + 'p';
  };

  function streamText(s) {
    return (s.name || '').replace(/\n/g, ' ') + ' ' + (s.title || s.description || '') + ' ' + ((s.behaviorHints && s.behaviorHints.filename) || '');
  }
  S.streamInfo = function (s) {
    var name = (s.name || '').replace(/\n/g, ' ');
    var title = s.title || s.description || '';
    var all = streamText(s);
    var res = /2160p|\b4k\b|\buhd\b/i.test(all) ? 2160 : /1440p|\b2k\b|\bqhd\b/i.test(all) ? 1440 : /1080p|\bfhd\b/i.test(all) ? 1080
      : /720p/i.test(all) ? 720 : /576p|480p|\bsd\b|dvdrip/i.test(all) ? 480 : 0;
    var badges = [];
    if (/\bhdr(10)?\+?\b/i.test(all)) badges.push('HDR');
    if (/\b(dv|dovi|dolby ?vision)\b/i.test(all)) badges.push('DV');
    if (/\b(atmos)\b/i.test(all)) badges.push('Atmos');
    if (/\b(hevc|x265|h\.?265)\b/i.test(all)) badges.push('HEVC');
    var sm = all.match(/(\d+(?:[.,]\d+)?)\s?(TB|GB|MB|To|Go|Mo)\b/i);
    var size = sm ? sm[0] : '';
    var sizeBytes = 0;
    if (sm) { var u = sm[2].toUpperCase(); sizeBytes = parseFloat(sm[1].replace(',', '.')) * (u[0] === 'T' ? 1e12 : u[0] === 'G' ? 1e9 : 1e6); }
    if (!sizeBytes && s.behaviorHints && s.behaviorHints.videoSize) sizeBytes = s.behaviorHints.videoSize;
    var seeds = Number((all.match(/👤\s*(\d+)/) || [])[1] || 0);
    var kind = s.url ? 'url' : s.infoHash ? 'torrent' : s.ytId ? 'youtube' : s.externalUrl ? 'external' : 'unknown';
    var multi = /\bmulti\b/i.test(all);
    var vostfr = /\bvost(fr)?\b|\bsubfrench\b/i.test(all);
    var langs = Object.keys(LANGS).filter(function (k) { return LANGS[k].re.test(all); });
    if (vostfr && !multi && !/\b(vff|vfq|truefrench|vf2?)\b/i.test(all)) langs = langs.filter(function (l) { return l !== 'fr'; });
    return {
      name: name || 'Source', title: title, res: res, quality: res ? S.qualityLabel(res) : '', badges: badges, size: size, kind: kind,
      multi: multi, vostfr: vostfr, langs: langs, fr: multi || langs.indexOf('fr') >= 0,
      cached: /\[(RD|AD|PM|DL|TB|ED|OC|DB|EN|PK)\+\]|⚡|cached/i.test(name),
      uncached: /⬇️|⬇|\[(RD|AD|PM|DL|TB|ED|OC|DB|EN|PK) download\]|uncached/i.test(name),
      sizeBytes: sizeBytes, seeds: seeds
    };
  };
  /* Libellé humain : « Français · 1080p · HDR » */
  S.describe = function (info) {
    var lang = info.multi ? 'Multi-langues' : info.vostfr ? 'VOSTFR' : info.langs.length ? info.langs.map(S.langLabel).join(', ') : 'VO';
    return [lang, info.quality || 'Qualité inconnue'].concat(info.badges.filter(function (b) { return b !== 'HEVC'; })).join(' · ');
  };

  /* Préférences de lecture (globales + mémorisées par série/film comme Netflix) */
  S.prefs = {
    global: function () {
      var d = S.deviceLang();
      var g = load('playPrefs', null) || {};
      return { audio: g.audio || d, subs: g.subs || 'off', quality: g.quality || 'auto' };
    },
    setGlobal: function (p) { var g = S.prefs.global(); Object.keys(p).forEach(function (k) { g[k] = p[k]; }); save('playPrefs', g); },
    forShow: function (id) {
      var g = S.prefs.global(), all = load('showPrefs', {}), o = (id && all[id]) || {};
      return { audio: o.audio || g.audio, subs: o.subs || g.subs, quality: o.quality || g.quality };
    },
    setShow: function (id, p) {
      if (!id) return;
      var all = load('showPrefs', {}), o = all[id] || {};
      Object.keys(p).forEach(function (k) { o[k] = p[k]; });
      all[id] = o;
      save('showPrefs', all);
    }
  };

  /* Note une source selon les préférences : la langue d'abord, puis la qualité */
  S.score = function (info, prefs) {
    var dev = S.deviceLang(), a = prefs.audio || dev, sc = 0;
    var tagged = info.langs.length > 0;
    if (a === 'vo') {
      if (info.multi) sc += 100;
      else if (info.vostfr) sc += 95;
      else if (!tagged) sc += 85;
      else if (info.langs.length === 1 && info.langs[0] === dev) sc += 0;
      else sc += 70;
    } else {
      if (info.langs.indexOf(a) >= 0) sc += 100;
      else if (info.multi) sc += (a === 'fr' ? 95 : 55);
      else if (!tagged && a === 'en') sc += 75;
      else if (info.vostfr && a !== 'fr') sc += 5;
      else sc += 0;
    }
    sc *= 1.5;
    var r = info.res || 700, q = prefs.quality;
    // en torrent, « Auto » vise le 1080p : démarrage bien plus rapide qu'un 4K de 15 Go
    if ((q === 'auto' || !q) && info.kind === 'torrent') q = 1080;
    if (q === 'auto' || !q) sc += Math.min(r, 2160) / 2160 * 60;
    else {
      q = Number(q);
      if (r === q) sc += 60;
      else if (r < q) sc += 60 - (q - r) / 360 * 15;
      else sc += 45 - (r - q) / 360 * 10;
    }
    // démarrage instantané d'abord : debrid en cache > lien direct > torrent
    if (info.kind === 'url') sc += info.cached ? 70 : info.uncached ? -40 : 35;
    else if (info.kind === 'torrent') {
      sc += S.hasTorrentEngine() ? 0 : -120;
      if (info.seeds) sc += Math.min(25, Math.log(info.seeds + 1) / Math.LN2 * 3.5);
      var gb = info.sizeBytes / 1e9;
      if (gb > 20) sc -= 30; else if (gb > 10) sc -= 15; else if (gb > 6) sc -= 5;
      var free = S.freeSpace();
      if (free > 0 && info.sizeBytes && info.sizeBytes > free - 5e8) sc -= 400;
    }
    else sc -= 200;
    if (info.badges.indexOf('DV') >= 0 && info.badges.indexOf('HDR') < 0) sc -= 8;
    return sc;
  };
  /* items: [{addon, stream, info, addonIndex, index}] → triés, meilleur en premier */
  S.rank = function (items, prefs) {
    items.forEach(function (it) { it.score = S.score(it.info, prefs) - it.addonIndex * 0.6 - it.index * 0.08; });
    return items.slice().sort(function (a, b) { return b.score - a.score; });
  };
  S.sortStreams = function (items, lang) {
    return S.rank(items, { audio: lang && lang !== 'all' ? lang : S.deviceLang(), quality: 'auto' });
  };
  S.sameStream = function (a, b) {
    if (!a || !b) return false;
    if (a.url && b.url) return a.url === b.url;
    if (a.infoHash && b.infoHash) return a.infoHash === b.infoHash && (a.fileIdx || 0) === (b.fileIdx || 0);
    return false;
  };

  /* Récupère les sources de tous les addons : rend la main dès que c'est suffisant.
     Certains addons (Comet…) mettent 15-30 s à chercher : tant qu'on n'a rien, on les attend. */
  /* onProgress(nFichiers, addonsRépondus, addonsTotal, msÉcoulées, { frac, pending })
     frac : avancement réel vers la fin de la recherche (réponses reçues et délai maximal connu) */
  S.collect = function (type, id, onProgress) {
    return new Promise(function (resolve) {
      var items = [], done = false, settleT = null, firstAt = 0;
      var addons = S.streamAddons(type, id);
      if (!addons.length) return resolve(items);
      var left = addons.length, t0 = Date.now(), answered = [];
      function finish() { if (!done) { done = true; clearTimeout(settleT); clearInterval(tick); resolve(items); } }
      function report() {
        if (!onProgress || done) return;
        var el = Date.now() - t0, n = addons.length - left;
        // tant que rien n'est arrivé, on avance vers la limite de 45 s (courbe douce : plus rapide au début)
        var byTime = items.length ? el / Math.min(12000, firstAt + 2500) : Math.sqrt(el / 45000);
        var frac = Math.min(0.99, Math.max(n / addons.length, byTime));
        var pending = addons.filter(function (a) { return answered.indexOf(a) < 0; }).map(function (a) { return (a.manifest && a.manifest.name) || 'addon'; });
        onProgress(items.length, n, addons.length, el, { frac: frac, pending: pending });
      }
      var tick = setInterval(function () {
        var el = Date.now() - t0;
        if (el > 45000 || (items.length && el > 12000)) finish();
        else report();
      }, 500);
      S.streams(type, id, function (res) {
        var idx = addons.indexOf(res.addon);
        res.streams.forEach(function (s, i) { items.push({ addon: res.addon, stream: s, info: S.streamInfo(s), addonIndex: idx, index: i }); });
        answered.push(res.addon);
        left--;
        if (items.length && !firstAt) firstAt = Date.now() - t0;
        report();
        if (!left) return finish();
        if (items.length && !settleT) settleT = setTimeout(finish, 2500);
      });
    });
  };
  /* Texte de l'étape « Recherche des sources » */
  S.collectText = function (n, done, total, el, x) {
    var pend = (x && x.pending) || [];
    var parts = [];
    if (pend.length && done < total) parts.push('En attente de ' + pend.slice(0, 2).join(', ') + (pend.length > 2 ? '…' : ''));
    else parts.push(done + '/' + total + ' addons');
    parts.push(n + (n > 1 ? ' fichiers trouvés' : ' fichier trouvé'));
    parts.push(Math.floor(el / 1000) + ' s');
    return parts.join(' · ');
  };

  /* ---------- Torrents vivants ----------
     Comet & co listent beaucoup de torrents morts (0 pair). On en sonde plusieurs en parallèle
     (presque sans débit) et on lance le mieux classé qui a vraiment des sources. */
  function torrentKey(st) { return st && st.infoHash ? st.infoHash.toLowerCase() : null; }
  function probeDesc(it) {
    var st = it.stream, hb = st.behaviorHints || {};
    return { hash: torrentKey(st), fileIdx: st.fileIdx === undefined || st.fileIdx === null ? -1 : Number(st.fileIdx), filename: hb.filename || '', sources: st.sources || [] };
  }
  S.health = function (hashes) {
    var e = S.engine();
    if (!e || typeof e.torrentHealth !== 'function' || !hashes.length) return {};
    try { return JSON.parse(e.torrentHealth(JSON.stringify(hashes))) || {}; } catch (x) { return {}; }
  };
  function alive(h) { return h && h.state !== 'error' && h.state !== 'none' && ((h.seeds || 0) > 0 || (h.peers || 0) > 0 || h.metadata); }

  S.pickHealthy = function (ranked, onStatus) {
    var e = S.engine();
    if (!e || typeof e.torrentProbe !== 'function') return Promise.resolve(ranked);
    // seuls les torrents classés avant la première source directe comptent
    var firstUrl = ranked.findIndex(function (x) { return x.info.kind === 'url'; });
    var seen = {}, cands = [];
    ranked.forEach(function (x, i) {
      var k = torrentKey(x.stream);
      if (!k || seen[k] || cands.length >= 8 || (firstUrl >= 0 && i > firstUrl)) return;
      seen[k] = 1; cands.push(x);
    });
    if (!cands.length) return Promise.resolve(ranked);
    try { e.torrentProbe(JSON.stringify(cands.map(probeDesc))); } catch (x) { }
    var hashes = cands.map(function (x) { return torrentKey(x.stream); });
    var t0 = Date.now();
    return new Promise(function (resolve) {
      (function poll() {
        var hs = S.health(hashes), el = Date.now() - t0;
        var ok = hashes.filter(function (h) { return alive(hs[h]); });
        var dht = 0; hashes.forEach(function (h) { dht = Math.max(dht, (hs[h] && hs[h].dht) || 0); });
        // avancement réel : vers 2,5 s dès qu'une source répond, sinon vers la limite de 14 s
        var frac = ok.length ? Math.min(1, el / 2500) : Math.min(1, el / 14000);
        if (onStatus) onStatus('Vérification des sources', ok.length + '/' + hashes.length + ' sources actives' + (dht ? '' : ' · connexion au réseau') + ' · ' + Math.floor(el / 1000) + ' s', frac);
        // favori vivant → on y va ; sinon on laisse quelques secondes aux autres
        // on laisse ~1,5 s pour comparer le nombre de pairs (plus de pairs = téléchargement plus rapide)
        var done = (ok.length && alive(hs[hashes[0]]) && el > 1500) || (ok.length && el > 2500) || el > 14000;
        if (!done) return setTimeout(poll, 500);
        var bonus = {};
        hashes.forEach(function (h) {
          var x = hs[h] || {};
          bonus[h] = alive(x) ? Math.min(60, Math.log((x.seeds || 0) + (x.peers || 0) + 1) / Math.LN2 * 7) : -300;
        });
        var out = ranked.map(function (x) {
          var k = torrentKey(x.stream);
          return { x: x, s: x.score + (k ? (k in bonus ? bonus[k] : -40) : 0) };
        }).sort(function (a, b) { return b.s - a.s; }).map(function (o) { return o.x; });
        // on garde les 3 meilleurs torrents vivants (secours immédiats), on libère les autres
        var keep = out.map(function (x) { return torrentKey(x.stream); }).filter(function (k) { return k && alive(hs[k]); }).slice(0, 3);
        try { if (typeof e.torrentKeep === 'function') e.torrentKeep(JSON.stringify(keep)); } catch (x) { }
        resolve(out);
      })();
    });
  };

  /* Options proposées dans le menu « Langue & qualité » */
  S.menuOptions = function (items, prefs) {
    var dev = S.deviceLang();
    var audio = [dev, 'vo'];
    (items || []).forEach(function (it) { it.info.langs.forEach(function (l) { if (audio.indexOf(l) < 0) audio.push(l); }); });
    if (prefs && audio.indexOf(prefs.audio) < 0) audio.push(prefs.audio);
    var subs = ['off', dev];
    ['en', 'es', 'de', 'it', 'pt'].forEach(function (l) { if (subs.indexOf(l) < 0) subs.push(l); });
    var qs = ['auto'];
    var found = {};
    (items || []).forEach(function (it) { if (it.info.res) found[it.info.res] = 1; });
    [2160, 1440, 1080, 720, 480].forEach(function (q) { if (found[q] || !items || !items.length) qs.push(q); });
    if (prefs && prefs.quality !== 'auto' && qs.indexOf(Number(prefs.quality)) < 0) qs.push(Number(prefs.quality));
    return {
      audio: audio.map(function (c) { return { code: c, label: c === dev ? S.langLabel(c) + ' (appareil)' : S.langLabel(c) }; }),
      subs: subs.map(function (c) { return { code: c, label: S.langLabel(c) }; }),
      quality: qs.map(function (q) { return { code: String(q), label: q === 'auto' ? 'Automatique' : S.qualityLabel(q) }; })
    };
  };

  /* Sous-titres utiles : langue choisie + appareil + anglais */
  S.pickSubtitles = function (subs, prefs) {
    var want = [];
    [prefs.subs, S.deviceLang(), 'en'].forEach(function (l) { if (l && l !== 'off' && want.indexOf(l) < 0) want.push(l); });
    var out = [];
    want.forEach(function (code) {
      var n = 0;
      (subs || []).forEach(function (x) {
        if (x && x.url && n < 3 && S.subLangMatch(x.lang, code)) { n++; out.push({ url: x.url, lang: code, label: S.langLabel(code) + (n > 1 ? ' ' + n : '') }); }
      });
    });
    return out;
  };

  /* Moteur torrent intégré (apps Android TV et téléphone) */
  S.engine = function () {
    if (window.OnyxNative && typeof window.OnyxNative.torrentUrl === 'function') return window.OnyxNative;
    if (window.OnyxPhone && typeof window.OnyxPhone.torrentUrl === 'function') return window.OnyxPhone;
    return null;
  };
  S.hasTorrentEngine = function () { return !!S.engine(); };
  var freeCache = { t: 0, v: -1 };
  S.freeSpace = function () {
    var e = S.engine();
    if (!e || typeof e.freeSpace !== 'function') return -1;
    if (Date.now() - freeCache.t > 60000) { freeCache = { t: Date.now(), v: Number(e.freeSpace()) || -1 }; }
    return freeCache.v;
  };
  /* Préchargement : métadonnées + début/fin du fichier, pour un démarrage quasi instantané */
  S.prepare = function (stream) {
    var e = S.engine();
    if (!e || !stream || !stream.infoHash || typeof e.torrentPrepare !== 'function') return;
    var hb = stream.behaviorHints || {};
    try { e.torrentPrepare(stream.infoHash, String(stream.fileIdx === undefined || stream.fileIdx === null ? -1 : stream.fileIdx), hb.filename || '', JSON.stringify(stream.sources || [])); } catch (x) { }
  };

  /* Transforme une source en URL lisible */
  S.resolve = function (stream, serverUrl) {
    if (stream.url) {
      var hints = stream.behaviorHints || {};
      var headers = (hints.proxyHeaders && hints.proxyHeaders.request) || null;
      return Promise.resolve({ url: stream.url, headers: headers });
    }
    if (stream.ytId) return Promise.resolve({ external: 'https://www.youtube.com/watch?v=' + stream.ytId });
    if (stream.externalUrl) return Promise.resolve({ external: stream.externalUrl });
    if (stream.infoHash && S.hasTorrentEngine()) {
      var nt = S.engine();
      var hb = stream.behaviorHints || {};
      var u = nt.torrentUrl(stream.infoHash, String(stream.fileIdx === undefined || stream.fileIdx === null ? -1 : stream.fileIdx), hb.filename || '', JSON.stringify(stream.sources || []));
      return Promise.resolve({ url: u, torrent: true });
    }
    if (stream.infoHash) {
      var srv = (serverUrl || 'http://127.0.0.1:11470').replace(/\/+$/, '');
      var ih = stream.infoHash.toLowerCase();
      if (stream.fileIdx !== undefined && stream.fileIdx !== null) {
        return Promise.resolve({ url: srv + '/' + ih + '/' + stream.fileIdx, torrent: true });
      }
      var sources = (stream.sources || []).filter(function (x) { return /^tracker:|^dht:/.test(x); });
      return S.fetchJSON(srv + '/' + ih + '/create', {
        body: { torrent: { infoHash: ih }, peerSearch: { sources: sources.length ? sources : ['dht:' + ih], min: 40, max: 200 }, guessFileIdx: {} },
        timeout: 20000
      }).then(function (r) {
        var idx = r && r.guessedFileIdx;
        if (idx === undefined || idx === null) {
          var best = -1, size = -1;
          ((r && r.files) || []).forEach(function (f, i) { if (f.length > size) { size = f.length; best = i; } });
          idx = best;
        }
        if (idx < 0) throw new Error('Fichier introuvable dans le torrent');
        return { url: srv + '/' + ih + '/' + idx, torrent: true };
      }).catch(function () {
        throw new Error('Source torrent : le serveur de streaming Stremio est injoignable (' + srv + ')');
      });
    }
    return Promise.reject(new Error('Source non prise en charge'));
  };

  /* ---------- Compte Stremio ---------- */
  S.account = {
    get: function () { return load('stremioAuth', null); },
    login: function (email, password) {
      return S.fetchJSON(API + 'login', { body: { type: 'Login', email: email, password: password, facebook: false } })
        .then(function (j) {
          if (j.error || !j.result) throw new Error((j.error && j.error.message) || 'Connexion refusée');
          var auth = { authKey: j.result.authKey, email: (j.result.user && j.result.user.email) || email };
          save('stremioAuth', auth);
          return auth;
        });
    },
    logout: function () {
      var a = S.account.get();
      try { localStorage.removeItem('onyx.stremioAuth'); } catch (e) { }
      if (a) S.fetchJSON(API + 'logout', { body: { type: 'Logout', authKey: a.authKey } }).catch(function () { });
    },
    pullAddons: function () {
      var a = S.account.get();
      if (!a) return Promise.reject(new Error('Non connecté'));
      return S.fetchJSON(API + 'addonCollectionGet', { body: { type: 'AddonCollectionGet', authKey: a.authKey, update: true } })
        .then(function (j) {
          if (j.error || !j.result) throw new Error((j.error && j.error.message) || 'Erreur de synchronisation');
          var list = (j.result.addons || []).filter(function (x) { return x.transportUrl && x.manifest; })
            .map(function (x) { return { transportUrl: x.transportUrl, manifest: x.manifest }; });
          if (list.length) S.setAddons(list);
          return list;
        });
    },
    /* Envoie la position de lecture au compte Stremio (« Continuer à regarder » partout) */
    pushProgress: function (e) {
      var a = S.account.get();
      if (!a || !e || !e.meta || !e.meta.id) return Promise.resolve();
      var id = e.meta.id;
      return S.fetchJSON(API + 'datastoreGet', { body: { type: 'DatastoreGet', authKey: a.authKey, collection: 'libraryItem', ids: [id], all: false } })
        .then(function (j) {
          var now = new Date().toISOString();
          var item = (j && j.result && j.result[0]) || {
            _id: id, name: e.meta.name || '', type: e.meta.type || e.type || 'movie', poster: e.meta.poster || null, posterShape: 'poster',
            removed: true, temp: true, _ctime: now, _mtime: now,
            state: { lastWatched: now, timeWatched: 0, timeOffset: 0, overallTimeWatched: 0, timesWatched: 0, flaggedWatched: 0, duration: 0, video_id: null, watched: null, noNotif: false },
            behaviorHints: { defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: false }
          };
          var st = item.state = item.state || {};
          st.timeOffset = e.watched ? 0 : Math.round((e.position || 0) * 1000);
          st.duration = Math.round((e.duration || 0) * 1000);
          st.video_id = e.videoId || id;
          st.lastWatched = now;
          if (e.watched) st.timesWatched = (st.timesWatched || 0) + 1;
          item._mtime = now;
          return S.fetchJSON(API + 'datastorePut', { body: { type: 'DatastorePut', authKey: a.authKey, collection: 'libraryItem', changes: [item] } });
        }).catch(function () { });
    },
    /* Récupère les positions de lecture du compte (format des entrées de progression Onyx) */
    pullProgress: function () {
      var a = S.account.get();
      if (!a) return Promise.resolve([]);
      return S.fetchJSON(API + 'datastoreGet', { body: { type: 'DatastoreGet', authKey: a.authKey, collection: 'libraryItem', all: true, ids: [] } })
        .then(function (j) {
          return ((j && j.result) || []).filter(function (x) {
            return x.state && x.state.video_id && x.state.timeOffset > 0 && (x.type === 'movie' || x.type === 'series');
          }).map(function (x) {
            var parts = String(x.state.video_id).split(':');
            var video = parts.length >= 3 ? { season: Number(parts[parts.length - 2]), episode: Number(parts[parts.length - 1]) } : null;
            return {
              videoId: x.state.video_id, type: x.type, meta: { id: x._id, type: x.type, name: x.name, poster: x.poster || null },
              video: video, position: x.state.timeOffset / 1000, duration: (x.state.duration || 0) / 1000,
              updated: Date.parse(x.state.lastWatched || x._mtime) || 0
            };
          });
        }).catch(function () { return []; });
    },
    pullLibrary: function () {
      var a = S.account.get();
      if (!a) return Promise.reject(new Error('Non connecté'));
      return S.fetchJSON(API + 'datastoreGet', { body: { type: 'DatastoreGet', authKey: a.authKey, collection: 'libraryItem', all: true, ids: [] } })
        .then(function (j) {
          return ((j && j.result) || []).filter(function (x) { return !x.removed && !x.temp && (x.type === 'movie' || x.type === 'series'); });
        });
    }
  };
})();
