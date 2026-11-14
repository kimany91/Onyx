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

  /* Adresses d'addons connues pour ne plus renvoyer de sources → remplacées par celle qui marche */
  var FIX_URLS = {
    'https://cometfortheweebs.midnightignite.me/stremio/manifest.json': 'https://cometfortheweebs.midnightignite.me/manifest.json',
    'https://comet.elfhosted.com/manifest.json': 'https://cometfortheweebs.midnightignite.me/manifest.json'
  };
  function fixUrls(list) {
    var fixed = false;
    list.forEach(function (a) { if (a && FIX_URLS[a.transportUrl]) { a.transportUrl = FIX_URLS[a.transportUrl]; fixed = true; } });
    // pas de doublon après correction
    var seen = {};
    var out = list.filter(function (a) { if (!a || seen[a.transportUrl]) return false; seen[a.transportUrl] = 1; return true; });
    return { list: out, fixed: fixed || out.length !== list.length };
  }

  S.init = function () {
    var stored = S.persist ? load('addons', null) : null;
    if (stored && stored.length) {
      var fx = fixUrls(stored);
      S.addons = fx.list;
      if (fx.fixed) changed();
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
    if (FIX_URLS[url]) url = FIX_URLS[url];
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
    S.addons = fixUrls((list || []).filter(function (a) { return a && a.transportUrl && a.manifest; })).list;
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
        .then(function (j) {
          var all = (j && j.streams) || [];
          var r = { addon: a, streams: all.filter(function (st) { return !S.isDetailLink(st) && !S.isPlaceholder(st); }) };
          if (onAddon) onAddon(r); return r;
        })
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

  /* Une « source » qui renvoie vers une autre fiche (ex. Watch Next) n'est pas une vidéo */
  /* Fausse source d'avertissement (« configuration obsolète », « [❌] ») : jamais lue */
  S.isPlaceholder = function (st) {
    var t = [st && st.name, st && st.title, st && st.description].join(' ');
    return /\[❌\]|obsolete configuration|please re-?configure|configuration (obsol|invalide)/i.test(t);
  };
  S.isDetailLink = function (st) { return !!(st && st.externalUrl && /^stremio:\/\/\/detail\//i.test(st.externalUrl)); };

  /* Addons conseillés, en tête du catalogue */
  S.FEATURED = [
    { url: 'https://cometfortheweebs.midnightignite.me/manifest.json', note: 'Sources torrent très rapides (films, séries et animes), sans réglage. Pour ajouter un debrid ou filtrer les langues, configure-le sur cometfortheweebs.midnightignite.me/configure puis colle ton lien avec « Ajouter par URL ».' },
    { url: 'https://anime-kitsu.strem.fun/manifest.json', note: 'Catalogues et fiches d\'animes (Kitsu).' },
    { url: 'https://099757617587-watch-next.baby-beamup.club/manifest.json', note: 'Suggestions « À voir ensuite » sur la fiche de chaque film ou série.' }
  ];
  S.featuredAddons = function () {
    return Promise.all(S.FEATURED.map(function (f) {
      return S.fetchJSON(f.url, { ttl: 6 * 3600 * 1000, timeout: 12000 })
        .then(function (m) { return m && m.id ? { transportUrl: f.url, manifest: m, note: f.note } : null; })
        .catch(function () { return null; });
    })).then(function (l) { return l.filter(Boolean); });
  };

  /* Recommandations (addons du type Watch Next) : [{ id, type, name, poster, description }] */
  S.recommendations = function (type, id, videoId) {
    var list = S.addons.filter(function (a) {
      var m = a.manifest || {};
      return S.supports(a, 'stream', type, id) && /watch[ .-]?next/i.test((m.id || '') + ' ' + (m.name || ''));
    });
    if (!list.length) return Promise.resolve([]);
    var sid = type === 'series' ? (videoId || id + ':1:1') : id;
    return Promise.all(list.map(function (a) {
      return S.fetchJSON(S.base(a) + '/stream/' + encodeURIComponent(type) + '/' + encodeURIComponent(sid) + '.json', { ttl: 24 * 3600 * 1000, timeout: 15000 })
        .then(function (j) { return (j && j.streams) || []; }).catch(function () { return []; });
    })).then(function (all) {
      var seen = {}, out = [];
      [].concat.apply([], all).forEach(function (st) {
        var m = /^stremio:\/\/\/detail\/([^\/]+)\/([^\/?#]+)/i.exec(st.externalUrl || '');
        if (!m || seen[m[2]] || m[2] === id) return;
        seen[m[2]] = 1;
        var rid = decodeURIComponent(m[2]);
        out.push({ id: rid, type: m[1], name: st.name || st.title || rid, poster: /^tt\d+/.test(rid) ? 'https://images.metahub.space/poster/small/' + rid + '/img' : null, description: '' });
      });
      return out;
    });
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
    // image de disque (DVD/Blu-ray complet, ISO) : pas un fichier vidéo lisible tel quel
    var disc = /\b(dvdr|dvd-?[59]|dvd-?r|iso|bdmv|video_ts|bd-?25|bd-?50|complete[ .-]?(blu-?ray|bluray|dvd)|untouched[ .-]?(dvd|blu-?ray))\b/i.test(all) && !/\.(mkv|mp4|avi|m4v|ts)\b/i.test(((s.behaviorHints || {}).filename) || '');
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
    // langues audio annoncées par l'addon (ligne « 🌎/🇫🇷/🇬🇧 » de Comet) : plus fiables que le nom du fichier
    var flagLine = (String(s.description || s.title || '').split('\n').filter(function (l) { return l.indexOf('🌎') >= 0; })[0]) || '';
    var flags = null;
    if (flagLine) {
      flags = [];
      Object.keys(LANGS).forEach(function (k) { if (LANGS[k].re.test(flagLine)) flags.push(k); });
      if (/💃/.test(flagLine) && flags.indexOf('es') < 0) flags.push('es');
    }
    // « MULTi » sans précision : souvent VF + VO, mais pas toujours (vérifié avec les drapeaux quand il y en a)
    var multiFr = multi && (!flags || !flags.length ? null : flags.indexOf('fr') >= 0);
    if (flags && flags.length && langs.indexOf('fr') < 0 && flags.indexOf('fr') >= 0) langs.push('fr');
    // VF de France ou du Québec
    var vfq = /\bvfq\b/i.test(all) && !/\b(vff|vf2|vfi|truefrench)\b/i.test(all);
    var frSure = langs.indexOf('fr') >= 0 && !(vostfr && !/\b(vff|vfq|vfi|vf2|truefrench|french)\b/i.test(all));
    // codecs annoncés (pour le lecteur PC, qui ne lit pas tout)
    var vcodec = /\b(x265|h\.?265|hevc)\b/i.test(all) ? 'hevc' : /\bav1\b/i.test(all) ? 'av1' : /\b(x264|h\.?264|avc)\b/i.test(all) ? 'h264'
      : /\bvp9\b/i.test(all) ? 'vp9' : /\b(xvid|divx)\b/i.test(all) ? 'xvid' : '';
    var acodecs = [];
    if (/\baac\b/i.test(all)) acodecs.push('aac');
    if (/\bopus\b/i.test(all)) acodecs.push('opus');
    if (/\bmp3\b/i.test(all)) acodecs.push('mp3');
    if (/\bflac\b/i.test(all)) acodecs.push('flac');
    if (/\b(ddp|dd\+|e-?ac-?3|eac3|ddpa?\s?\d|dolby digital plus)\b/i.test(all)) acodecs.push('eac3');
    if (/\b(ac-?3|dd\s?5|dd2\.0|dolby digital)(?!\s*plus)\b/i.test(all)) acodecs.push('ac3');
    if (/\bdts(-?hd|-?x|-?ma)?\b/i.test(all)) acodecs.push('dts');
    if (/\btrue-?hd\b/i.test(all)) acodecs.push('truehd');
    var tenbit = /\b(10-?bits?|hi10p?)\b/i.test(all);
    var avi = /\.avi\b/i.test(all);
    var cam = /\b(cam|camrip|hdcam|ts|telesync|hdts|tc|telecine|screener|scr|tsscreener|dvdscr)\b/i.test(all);
    return { cam: cam, multiFr: multiFr, vfq: vfq, frSure: frSure, flags: flags, vcodec: vcodec, acodecs: acodecs, tenbit: tenbit, avi: avi, disc: disc, 
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
      if (a === 'fr' && info.langs.indexOf('fr') >= 0) {
        // français annoncé clairement ; VF du Québec un peu après la VF de France (sauf appareil québécois)
        var quebec = /^fr-ca/i.test(String(navigator.language || ''));
        sc += info.vfq && !quebec ? 90 : 100;
      }
      else if (info.langs.indexOf(a) >= 0) sc += 100;
      else if (info.multi) sc += a === 'fr' ? (info.multiFr === false ? 5 : 72) : (info.flags && info.flags.length && info.flags.indexOf(a) < 0 ? 5 : 50);
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
    if (S.html5Player()) sc += S.html5Fit(info);
    return sc;
  };
  /* ---------- Lecteur PC (navigateur / Windows) : ce qu'il sait vraiment lire ---------- */
  var caps = null;
  S.html5Player = function () {
    // même règle que player.js : TV Android et téléphone → lecteur natif (ExoPlayer), sinon lecteur HTML5
    if (window.OnyxPhone) return false;
    return !(Onyx.native && Onyx.native.isAndroid && Onyx.native.isAndroid());
  };
  S.html5Caps = function () {
    if (caps) return caps;
    var v = document.createElement('video');
    function can(t) { try { return !!(v.canPlayType(t) || (window.MediaSource && MediaSource.isTypeSupported(t))); } catch (e) { return false; } }
    var bad = {};
    try { bad = JSON.parse(localStorage.getItem('onyx.html5Bad') || '{}'); } catch (e) { }
    caps = {
      hevc: can('video/mp4; codecs="hvc1.1.6.L120.90"') && !bad.hevc,
      av1: can('video/mp4; codecs="av01.0.08M.08"') && !bad.av1,
      ac3: can('audio/mp4; codecs="ac-3"'), eac3: can('audio/mp4; codecs="ec-3"')
    };
    return caps;
  };
  /* Un fichier HEVC/AV1 a échoué alors que le PC le disait lisible : on s'en souviendra */
  S.html5Failed = function (info) {
    if (!info || (info.vcodec !== 'hevc' && info.vcodec !== 'av1')) return;
    var bad = {};
    try { bad = JSON.parse(localStorage.getItem('onyx.html5Bad') || '{}'); } catch (e) { }
    bad.fails = bad.fails || {};
    bad.fails[info.vcodec] = (bad.fails[info.vcodec] || 0) + 1;
    if (bad.fails[info.vcodec] >= 2) bad[info.vcodec] = true;
    try { localStorage.setItem('onyx.html5Bad', JSON.stringify(bad)); } catch (e) { }
    caps = null;
  };
  /* Bonus / malus selon ce que le PC sait lire (sinon : « source illisible » à répétition) */
  S.html5Fit = function (info) {
    var c = S.html5Caps(), sc = 0;
    // malus modérés : un fichier illisible tel quel est converti par le serveur Stremio,
    // la langue choisie (bonus de 150) passe donc toujours avant le format
    if (info.avi || info.vcodec === 'xvid') sc -= 70;
    else if (info.vcodec === 'hevc') sc += c.hevc ? -5 : -40;
    else if (info.vcodec === 'av1') sc += c.av1 ? 0 : -40;
    else if (info.vcodec === 'h264' && info.tenbit) sc -= 40;    // H.264 10 bits : jamais lu par le navigateur
    else if (info.vcodec === 'h264') sc += 15;
    var a = info.acodecs || [];
    var okAudio = a.some(function (x) { return x === 'aac' || x === 'opus' || x === 'mp3' || x === 'flac' || (x === 'eac3' && c.eac3) || (x === 'ac3' && c.ac3); });
    if (!okAudio && a.length) sc -= 25;      // AC3 / E-AC3 / DTS / TrueHD seuls : conversion nécessaire
    else if (!a.length) sc -= 10;
    return sc;
  };

  /* items: [{addon, stream, info, addonIndex, index}] → triés, meilleur en premier */
  /* Rang de langue (0 = la langue choisie, 1 = « MULTi » sans précision, 2 = autre langue).
     La langue choisie passe toujours avant tout le reste (qualité, nombre de partageurs…). */
  S.langTier = function (info, prefs) {
    var a = (prefs && prefs.audio) || S.deviceLang();
    if (a === 'vo') return 0;
    if (info.langs.indexOf(a) >= 0) return 0;
    if (info.multi && (a === 'fr' ? info.multiFr !== false : !(info.flags && info.flags.length))) return 1;
    return 2;
  };
  /* Message si la langue choisie n'a aucune source qui répond */
  S.langNotice = function (r, prefs) {
    var a = (prefs && prefs.audio) || S.deviceLang();
    if (!r || !r[0] || a === 'vo' || !r[0].tier) return null;
    var got = r[0].info.langs.length ? S.langLabel(r[0].info.langs[0]).toLowerCase() : r[0].info.multi ? 'multi-langues' : 'version d\'origine';
    return 'Aucune source en ' + S.langLabel(a).toLowerCase() + ' ne répond pour l\'instant : lecture en ' + got + '.';
  };
  S.rank = function (items, prefs) {
    items.forEach(function (it) {
      it.tier = S.langTier(it.info, prefs);
      it.score = S.score(it.info, prefs) - it.addonIndex * 0.6 - it.index * 0.08 - (it.info.disc ? 1000 : 0) - (it.info.cam ? 80 : 0);
    });
    return items.slice().sort(function (a, b) { return (a.tier - b.tier) || (b.score - a.score); });
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

  /* Source suivante après un échec : la première (dans l'ordre) qui a des partageurs, sinon la suivante */
  S.nextCandidate = function (ranked, from, failed) {
    failed = failed || {};
    var rest = [];
    for (var i = from; i < ranked.length; i++) {
      var x = ranked[i];
      if (!x || x.info.disc) continue;
      var k = torrentKey(x.stream) || x.stream.url;
      if (k && failed[k]) continue;
      rest.push(i);
    }
    if (!rest.length) return -1;
    var hashes = rest.map(function (i) { return torrentKey(ranked[i].stream); }).filter(Boolean);
    var hs = hashes.length ? S.health(hashes) : {};
    // d'abord une source de la même langue (rang le plus bas encore disponible), vivante si possible
    var best = Math.min.apply(null, rest.map(function (i) { return ranked[i].tier || 0; }));
    var same = rest.filter(function (i) { return (ranked[i].tier || 0) === best; });
    for (var r = 0; r < same.length; r++) {
      var x2 = ranked[same[r]], k2 = torrentKey(x2.stream);
      if (!k2 || alive(hs[k2])) return same[r]; // source directe ou torrent vivant
    }
    return same[0];
  };
  S.streamKey = function (st) { return torrentKey(st) || (st && st.url) || ''; };

  S.pickHealthy = function (ranked, onStatus) {
    var e = S.engine();
    if (!e || typeof e.torrentProbe !== 'function') return Promise.resolve(ranked);
    // seuls les torrents classés avant la première source directe comptent
    var firstUrl = ranked.findIndex(function (x) { return x.info.kind === 'url'; });
    var seen = {}, cands = [];
    var topTier = ranked.length ? (ranked[0].tier || 0) : 0;
    ranked.forEach(function (x, i) {
      var k = torrentKey(x.stream);
      if (!k || seen[k] || (firstUrl >= 0 && i > firstUrl)) return;
      // jusqu'à 8 sources de la langue choisie + 2 de secours dans une autre langue
      var top = (x.tier || 0) === topTier, nTop = cands.filter(function (c) { return (c.tier || 0) === topTier; }).length;
      if (top ? nTop >= 8 : cands.length - nTop >= 2) return;
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
        // aucune source vivante mais le réseau répond : les vieux torrents mettent jusqu'à ~30 s à trouver leurs partageurs
        var limit = dht ? 30000 : 14000;
        var frac = ok.length ? Math.min(1, el / 2500) : Math.min(1, el / limit);
        if (onStatus) onStatus('Vérification des sources', (ok.length ? ok.length + '/' + hashes.length + ' sources actives' : 'Recherche de partageurs (' + hashes.length + ' sources)') + (dht ? '' : ' · connexion au réseau') + ' · ' + Math.floor(el / 1000) + ' s', frac);
        // favori vivant → on y va ; sinon on laisse quelques secondes aux autres
        // on laisse ~1,5 s pour comparer le nombre de pairs (plus de pairs = téléchargement plus rapide)
        // une source vivante dans la langue choisie suffit ; une autre langue seulement si aucune ne répond
        var okTop = hashes.filter(function (h, i) { return alive(hs[h]) && (cands[i].tier || 0) === topTier; });
        var done = (okTop.length && alive(hs[hashes[0]]) && el > 1500) || (okTop.length && el > 2500) || (ok.length && el > limit * 0.6) || el > limit;
        if (!done) return setTimeout(poll, 500);
        var bonus = {};
        hashes.forEach(function (h) {
          var x = hs[h] || {};
          bonus[h] = alive(x) ? Math.min(60, Math.log((x.seeds || 0) + (x.peers || 0) + 1) / Math.LN2 * 7) : -300;
        });
        // tri : langue d'abord, puis note + partageurs ; une langue n'est dépassée que si elle n'a aucune source vivante
        var tierAlive = {};
        ranked.forEach(function (x) { var k = torrentKey(x.stream); if (!k || alive(hs[k])) tierAlive[x.tier || 0] = true; });
        var out = ranked.map(function (x) {
          var k = torrentKey(x.stream), t = x.tier || 0;
          return { x: x, t: tierAlive[t] ? t : t + 10, s: x.score + (k ? (k in bonus ? bonus[k] : -40) : 0) };
        }).sort(function (a, b) { return (a.t - b.t) || (b.s - a.s); }).map(function (o) { return o.x; });
        // on garde les 3 meilleurs torrents vivants (secours immédiats), on libère les autres
        // aucune vivante : on garde tout (les recherches de partageurs continuent pendant la lecture)
        var keep = ok.length ? out.map(function (x) { return torrentKey(x.stream); }).filter(function (k) { return k && alive(hs[k]); }).slice(0, 3) : hashes;
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
  /* Pack de saison sans numéro de fichier : on indique au moteur l'épisode à chercher (« *S01E01 ») */
  function episodeHint(stream, ep) {
    var hb = stream.behaviorHints || {};
    if (!ep || !ep.season && ep.season !== 0 || !ep.episode) return hb.filename || '';
    if (stream.fileIdx !== undefined && stream.fileIdx !== null) return hb.filename || '';
    var f = hb.filename || '', s = Number(ep.season), e = Number(ep.episode);
    var re = new RegExp('s0*' + s + '[ ._-]*e0*' + e + '(?!\\d)|\\b0*' + s + 'x0*' + e + '(?!\\d)', 'i');
    if (f && re.test(f) && /\.(mkv|mp4|avi|m4v|ts|webm)$/i.test(f)) return f;
    return '*S' + s + 'E' + e + (ep.abs && ep.abs !== e ? 'A' + ep.abs : '');
  }
  /* Épisode demandé pour un lecteur : saison, numéro et numéro absolu (packs à numérotation continue) */
  S.epOf = function (meta, video) {
    if (!video || video.season === undefined || video.season === null) return null;
    var s = Number(video.season), e = Number(video.episode || video.number);
    if (!e) return null;
    return { season: s, episode: e, abs: Onyx.match ? Onyx.match.absEpisode(meta, s, e) : e };
  };
  /* Sources qui correspondent vraiment au titre / à l'épisode choisi (voir match.js) */
  S.onlyMatching = function (items, meta, video) {
    if (!Onyx.match || !meta) return items;
    return items.filter(function (it) { return Onyx.match.fits(it.stream, meta, video); });
  };
  S.resolve = function (stream, serverUrl, ep) {
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
      var u = nt.torrentUrl(stream.infoHash, String(stream.fileIdx === undefined || stream.fileIdx === null ? -1 : stream.fileIdx), episodeHint(stream, ep), JSON.stringify(stream.sources || []));
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
        if (ep && Onyx.match) {
          // épisode d'une série : le bon fichier ou rien (sinon un autre épisode serait lancé)
          var files = ((r && r.files) || []).map(function (f) { return { path: f.path || f.name || '', size: f.length || 0 }; });
          var ei = Onyx.match.episodeFile(files, Number(ep.season), Number(ep.episode), ep.abs);
          if (ei < 0) throw new Error('épisode introuvable dans ce torrent');
          return { url: srv + '/' + ih + '/' + ei, torrent: true };
        }
        var idx = r && r.guessedFileIdx;
        if (idx === undefined || idx === null) {
          var best = -1, size = -1;
          ((r && r.files) || []).forEach(function (f, i) { if (f.length > size) { size = f.length; best = i; } });
          idx = best;
        }
        if (idx < 0) throw new Error('Fichier introuvable dans le torrent');
        return { url: srv + '/' + ih + '/' + idx, torrent: true };
      }).catch(function (err) {
        if (err && /introuvable/.test(err.message)) throw err;
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
