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
      return S.fetchJSON(S.base(a) + '/stream/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json', { ttl: 5 * 60 * 1000, timeout: 25000 })
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
  var LANG_RE = {
    fr: /\b(french|fran[cç]ais|vff|vfq|vfi|vf2?|truefrench|vostfr|multi)\b|🇫🇷/i,
    en: /\b(english|eng|vo)\b|🇬🇧|🇺🇸/i
  };
  S.streamInfo = function (s) {
    var name = (s.name || '').replace(/\n/g, ' ');
    var title = s.title || s.description || '';
    var all = name + ' ' + title + ' ' + ((s.behaviorHints && s.behaviorHints.filename) || '');
    var q = /2160p|\b4k\b|uhd/i.test(all) ? '4K' : /1080p/i.test(all) ? '1080p' : /720p/i.test(all) ? '720p' : /480p|\bsd\b/i.test(all) ? 'SD' : '';
    var badges = [];
    if (/\bhdr(10)?\+?\b/i.test(all)) badges.push('HDR');
    if (/\b(dv|dovi|dolby ?vision)\b/i.test(all)) badges.push('DV');
    if (/\b(atmos)\b/i.test(all)) badges.push('Atmos');
    if (/\b(hevc|x265|h\.?265)\b/i.test(all)) badges.push('HEVC');
    var size = (all.match(/(\d+(?:[.,]\d+)?)\s?(GB|MB|Go|Mo)\b/i) || [])[0] || '';
    var kind = s.url ? 'url' : s.infoHash ? 'torrent' : s.ytId ? 'youtube' : s.externalUrl ? 'external' : 'unknown';
    return {
      name: name || 'Source', title: title, quality: q, badges: badges, size: size, kind: kind,
      fr: LANG_RE.fr.test(all), en: LANG_RE.en.test(all), cached: /\[(RD|AD|PM|DL|TB|ED|OC)\+\]|⚡|cached/i.test(name)
    };
  };
  var QRANK = { '4K': 4, '1080p': 3, '720p': 2, 'SD': 1, '': 0 };
  S.sortStreams = function (items, lang) {
    // items: [{addon, stream, info, addonIndex, index}]
    return items.sort(function (a, b) {
      if (lang && lang !== 'all') {
        var la = a.info[lang] ? 1 : 0, lb = b.info[lang] ? 1 : 0;
        if (la !== lb) return lb - la;
      }
      if (a.addonIndex !== b.addonIndex) return a.addonIndex - b.addonIndex;
      return a.index - b.index;
    });
  };
  S.qualityRank = function (q) { return QRANK[q] || 0; };

  /* Transforme une source en URL lisible */
  S.resolve = function (stream, serverUrl) {
    if (stream.url) {
      var hints = stream.behaviorHints || {};
      var headers = (hints.proxyHeaders && hints.proxyHeaders.request) || null;
      return Promise.resolve({ url: stream.url, headers: headers });
    }
    if (stream.ytId) return Promise.resolve({ external: 'https://www.youtube.com/watch?v=' + stream.ytId });
    if (stream.externalUrl) return Promise.resolve({ external: stream.externalUrl });
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
