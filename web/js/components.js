/* Onyx — composants d'interface partagés */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h;

  /* ---------- Fond d'écran (fondu enchaîné) ---------- */
  var bd = { idx: 0, url: null };
  Onyx.backdrop = {
    set: function (url, mode) {
      var root = Onyx.$('#backdrop');
      if (!root) return;
      root.className = mode || '';
      if (mode === 'plain' && Onyx.ambient) Onyx.ambient.meta(null);
      if (url === bd.url) return;
      bd.url = url;
      var layers = Onyx.$$('.bd-layer', root);
      var next = layers[bd.idx = 1 - bd.idx], prev = layers[1 - bd.idx];
      if (!url) { next.classList.remove('show'); prev.classList.remove('show'); return; }
      var img = new Image();
      // même mode de chargement que l'ambiance (couleurs du film) : une seule requête, partagée par le cache
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        if (bd.url !== url) return;
        next.style.backgroundImage = 'url("' + url + '")';
        next.classList.add('show');
        prev.classList.remove('show');
      };
      img.onerror = function () {
        if (img.crossOrigin) { img.crossOrigin = null; img.removeAttribute('crossorigin'); img.src = url; }
      };
      img.src = url;
    }
  };
  Onyx.bgOf = function (meta) {
    if (!meta) return null;
    if (meta.background) return meta.background;
    if (/^tt\d+/.test(meta.id || '')) return 'https://images.metahub.space/background/medium/' + meta.id.split(':')[0] + '/img';
    return meta.poster || null;
  };
  Onyx.logoOf = function (meta) {
    if (!meta) return null;
    if (meta.logo) return meta.logo;
    if (/^tt\d+/.test(meta.id || '')) return 'https://images.metahub.space/logo/medium/' + meta.id.split(':')[0] + '/img';
    return null;
  };
  Onyx.posterOf = function (meta) {
    if (!meta) return null;
    if (meta.poster) return meta.poster;
    if (/^tt\d+/.test(meta.id || '')) return 'https://images.metahub.space/poster/small/' + meta.id.split(':')[0] + '/img';
    return null;
  };
  Onyx.preview = function (m) {
    return { id: m.id, type: m.type, name: m.name, poster: Onyx.posterOf(m), background: m.background || null, logo: m.logo || null, releaseInfo: m.releaseInfo || m.year || '', imdbRating: m.imdbRating || '', description: m.description || '', genres: m.genres || m.genre || [] };
  };

  /* ---------- Titre (logo image ou texte) ---------- */
  Onyx.titleEl = function (meta, cls) {
    var box = h('div.title-art' + (cls ? '.' + cls : ''));
    var txt = h('h1.title-text', { text: meta.name || '' });
    box.appendChild(txt);
    var logo = Onyx.logoOf(meta);
    if (logo) {
      var img = new Image();
      img.className = 'title-logo';
      img.onload = function () { if (img.naturalWidth > 10) { box.innerHTML = ''; box.appendChild(img); } };
      img.src = logo;
    }
    return box;
  };

  Onyx.metaLine = function (meta) {
    var bits = [];
    if (meta.imdbRating) bits.push(h('span.rating', { html: Onyx.icons.star + ' ' + Onyx.esc(meta.imdbRating) }));
    var year = meta.releaseInfo || meta.year;
    if (year) bits.push(h('span', { text: year }));
    if (meta.runtime) bits.push(h('span', { text: meta.runtime }));
    if (meta.type) bits.push(h('span.pill', { text: meta.type === 'movie' ? 'Film' : meta.type === 'series' ? 'Série' : meta.type }));
    var g = meta.genres || meta.genre || [];
    if (g.length) bits.push(h('span.genres', { text: g.slice(0, 3).join(' · ') }));
    return h('div.meta-line', bits);
  };

  /* ---------- Cartes ---------- */
  Onyx.card = function (meta, opts) {
    opts = opts || {};
    var land = opts.landscape;
    var c = h('div.card.f' + (land ? '.land' : ''), { data: { id: meta.id } });
    var src = land ? (opts.image || Onyx.bgOf(meta)) : Onyx.posterOf(meta);
    var fallback = h('div.card-fallback', [h('span', { text: meta.name || '' })]);
    c.appendChild(fallback);
    if (src) {
      var img = h('img', { src: src, loading: 'lazy', alt: '' });
      img.onerror = function () { img.remove(); };
      img.onload = function () { fallback.classList.add('hide'); };
      c.appendChild(img);
    }
    if (opts.label) c.appendChild(h('div.card-label', { text: opts.label }));
    if (opts.progress) c.appendChild(h('div.card-progress', [h('i', { style: { width: Math.round(opts.progress * 100) + '%' } })]));
    if (opts.badge) c.appendChild(h('div.card-badge', { text: opts.badge }));
    c._meta = meta;
    c.addEventListener('click', function () { (opts.onSelect || Onyx.openMeta)(meta, c); });
    if (opts.onFocus) c.addEventListener('focus', function () { opts.onFocus(meta, c); });
    // l'ambiance de l'écran s'adapte au film sélectionné
    c.addEventListener('focus', function () { if (Onyx.ambient) Onyx.ambient.meta(meta); });
    return c;
  };

  Onyx.openMeta = function (meta) {
    Onyx.app.go('detail', { type: meta.type, id: meta.id, preview: meta });
  };

  /* Rangée horizontale (titre + rail) */
  Onyx.row = function (title, opts) {
    opts = opts || {};
    var track = h('div.track-h', { 'data-hmode': opts.hmode || 'start' });
    var row = h('section.row' + (opts.cls ? '.' + opts.cls : ''), { 'data-remember': '' }, [
      h('h2.row-title', { text: title }),
      h('div.row-viewport', [track])
    ]);
    row.track = track;
    return row;
  };
  Onyx.skeletonRow = function (n, land) {
    var arr = [];
    for (var i = 0; i < (n || 8); i++) arr.push(h('div.card.skeleton' + (land ? '.land' : '')));
    return arr;
  };

  /* ---------- Boutons ---------- */
  Onyx.btn = function (label, icon, onClick, cls) {
    var b = h('button.btn.f' + (cls ? '.' + cls : ''), { type: 'button' });
    b.innerHTML = (icon ? Onyx.icons[icon] || '' : '') + '<span>' + Onyx.esc(label) + '</span>';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  };

  /* ---------- Fenêtres modales ---------- */
  Onyx.modal = function (content, opts) {
    opts = opts || {};
    var prevFocus = Onyx.focus.cur;
    var m = h('div.modal' + (opts.cls ? '.' + opts.cls : ''), [h('div.modal-scrim'), h('div.modal-box', [content])]);
    Onyx.$('#modals').appendChild(m);
    requestAnimationFrame(function () { m.classList.add('open'); });
    var api = {
      el: m,
      close: function (silent) {
        if (!m.isConnected) return;
        m.classList.remove('open');
        m.remove();
        if (opts.onClose && !silent) opts.onClose();
        if (prevFocus && prevFocus.isConnected) Onyx.focus.set(prevFocus);
        else Onyx.focus.restore(Onyx.focus.scopeRoot() || Onyx.$('#view > .view.active'));
      }
    };
    m._api = api;
    m._onBack = opts.onBack;
    setTimeout(function () { if (!Onyx.focus.restore(m)) { /* rien */ } }, 0);
    return api;
  };
  Onyx.closeTopModal = function () {
    var ms = Onyx.$$('#modals > .modal');
    if (!ms.length) return false;
    var top = ms[ms.length - 1];
    if (top._onBack && top._onBack() === false) return true;
    top._api.close();
    return true;
  };

  Onyx.confirm = function (title, text, okLabel) {
    return new Promise(function (resolve) {
      var api;
      var box = h('div.dialog', [
        h('h2', { text: title }),
        text ? h('p', { text: text }) : null,
        h('div.dialog-actions', [
          Onyx.btn(okLabel || 'Confirmer', null, function () { api.close(true); resolve(true); }, 'primary default'),
          Onyx.btn('Annuler', null, function () { api.close(true); resolve(false); })
        ])
      ]);
      api = Onyx.modal(box, { onClose: function () { resolve(false); } });
    });
  };

  /* Liste de choix */
  Onyx.choose = function (title, options, current) {
    return new Promise(function (resolve) {
      var api;
      var list = h('div.choice-list.track-v');
      options.forEach(function (o) {
        var b = h('button.choice.f' + (o.value === current ? '.default.selected' : ''), { type: 'button' }, [
          h('span', { text: o.label }), o.value === current ? h('span.choice-check', { html: Onyx.icons.check }) : null
        ]);
        b.addEventListener('click', function () { api.close(true); resolve(o.value); });
        list.appendChild(b);
      });
      api = Onyx.modal(h('div.dialog.choice', [h('h2', { text: title }), h('div.choice-viewport', [list])]), { onClose: function () { resolve(undefined); } });
    });
  };

  /* ---------- Progression & Ma liste ---------- */
  Onyx.progress = {
    all: function () { return Onyx.store.get('progress', {}); },
    get: function (videoId) { return this.all()[videoId] || null; },
    update: function (entry) {
      if (!entry || !entry.videoId) return;
      var all = this.all();
      var dur = entry.duration || 0, pos = entry.position || 0;
      var prev = all[entry.videoId] || {};
      var e = Object.assign({}, prev, entry, { updated: Date.now() });
      e.watched = dur > 0 && pos / dur > 0.92 || !!entry.ended;
      all[entry.videoId] = e;
      // limite la taille
      var keys = Object.keys(all);
      if (keys.length > 300) {
        keys.sort(function (a, b) { return all[a].updated - all[b].updated; }).slice(0, keys.length - 300).forEach(function (k) { delete all[k]; });
      }
      Onyx.store.set('progress', all);
      Onyx.bus.emit('progress', e);
    },
    remove: function (videoId) { var all = this.all(); delete all[videoId]; Onyx.store.set('progress', all); },
    /* Fusionne des entrées venant d'un autre appareil : la plus récente gagne.
       Renvoie les entrées locales plus récentes que celles reçues (à renvoyer à l'autre appareil). */
    mergeAll: function (incoming) {
      var all = this.all(), changed = false, newer = {};
      var inc = incoming || {};
      if (Array.isArray(inc)) { var o = {}; inc.forEach(function (e) { if (e && e.videoId) o[e.videoId] = e; }); inc = o; }
      Object.keys(inc).forEach(function (k) {
        var e = inc[k];
        if (!e || !e.videoId) return;
        var l = all[k];
        if (!l || (e.updated || 0) > (l.updated || 0)) {
          var m = Object.assign({}, l || {}, e);
          if (!e.meta && l) m.meta = l.meta;
          if (!e.stream && l && l.stream) m.stream = l.stream;
          m.watched = !!e.watched || (m.duration > 0 && m.position / m.duration > 0.92);
          all[k] = m; changed = true;
        }
      });
      Object.keys(all).forEach(function (k) { var l = all[k]; if (!inc[k] || (l.updated || 0) > (inc[k].updated || 0)) newer[k] = l; });
      if (changed) { Onyx.store.set('progress', all); Onyx.bus.emit('progress', null); }
      return newer;
    },
    continueList: function () {
      var all = this.all(), seen = {}, out = [];
      Object.keys(all).map(function (k) { return all[k]; })
        .sort(function (a, b) { return b.updated - a.updated; })
        .forEach(function (e) {
          if (!e.meta || seen[e.meta.id]) return;
          var pct = e.duration ? e.position / e.duration : 0;
          if (e.watched || pct < 0.02) return;
          seen[e.meta.id] = 1;
          out.push(e);
        });
      return out.slice(0, 20);
    },
    lastForMeta: function (metaId) {
      var all = this.all(), best = null;
      Object.keys(all).forEach(function (k) {
        var e = all[k];
        if (e.meta && e.meta.id === metaId && (!best || e.updated > best.updated)) best = e;
      });
      return best;
    }
  };

  Onyx.library = {
    all: function () { return Onyx.store.get('library', []); },
    has: function (id) { return this.all().some(function (m) { return m.id === id; }); },
    toggle: function (meta) {
      var l = this.all(), i = l.findIndex(function (m) { return m.id === meta.id; });
      if (i >= 0) l.splice(i, 1); else l.unshift(Onyx.preview(meta));
      Onyx.store.set('library', l);
      Onyx.bus.emit('library', l);
      return i < 0;
    },
    addMany: function (metas) {
      var l = this.all();
      metas.forEach(function (m) { if (!l.some(function (x) { return x.id === m.id; })) l.push(Onyx.preview(m)); });
      Onyx.store.set('library', l);
      Onyx.bus.emit('library', l);
    }
  };

  Onyx.spinner = function () { return h('div.spinner', [h('i'), h('i'), h('i')]); };
  Onyx.empty = function (title, text, actions) {
    return h('div.empty', [h('div.empty-gem', { html: Onyx.gemSvg('gem-empty') }), h('h2', { text: title }), text ? h('p', { text: text }) : null, actions ? h('div.empty-actions', actions) : null]);
  };
})();

/* ---------- Écran de chargement cinématique (avancement réel) ---------- */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h;
  var STEPS = ['Sources', 'Vérification', 'Connexion', 'Mise en mémoire'];

  /* Images « cinéma » du titre : image de l'épisode, autres épisodes de la saison, fond, affiche */
  Onyx.cinematicImages = function (meta, video) {
    var out = [], id = String(meta.id || '').split(':')[0];
    if (video && video.thumbnail) out.push(video.thumbnail);
    if (/^tt\d+/.test(id)) out.push('https://images.metahub.space/background/large/' + id + '/img');
    if (meta.background) out.push(meta.background);
    var vids = (meta.videos || []).filter(function (v) { return v.thumbnail && (!video || v.season === video.season) && (!video || v.id !== video.id); });
    // quelques images d'épisodes autour de celui-ci
    var at = video ? (meta.videos || []).findIndex(function (v) { return v.id === video.id; }) : 0;
    vids.sort(function (a, b) { return Math.abs((meta.videos || []).indexOf(a) - at) - Math.abs((meta.videos || []).indexOf(b) - at); });
    vids.slice(0, 5).forEach(function (v) { out.push(v.thumbnail); });
    if (/^tt\d+/.test(id)) out.push('https://images.metahub.space/background/medium/' + id + '/img');
    if (meta.poster) out.push(meta.poster);
    var seen = {};
    return out.filter(function (u) { if (!u || seen[u]) return false; seen[u] = 1; return true; });
  };

  function bridge() {
    if (window.OnyxNative && typeof window.OnyxNative.playerPrepare === 'function' && Onyx.native && Onyx.native.isAndroid()) return window.OnyxNative;
    if (window.OnyxPhone && typeof window.OnyxPhone.playerPrepare === 'function') return window.OnyxPhone;
    return null;
  }

  /* opts : {meta, video, label (S1:E2 · titre), videoId}
     api.stage(étape 0-3, texte, détail, % global) · api.handoff() quand la vidéo est lancée
     api.close(raison) pour abandonner · api.cancelled si l'utilisateur a fermé */
  Onyx.loader = function (opts) {
    var meta = opts.meta || {}, nb = bridge();
    var api = { cancelled: false, native: !!nb };
    var images = Onyx.cinematicImages(meta, opts.video);
    var logo = Onyx.logoOf ? Onyx.logoOf(meta) : (meta.logo || '');
    var last = { st: -1, pct: 0 };

    function onPlayer(e) {
      var d = e.detail; try { d = JSON.parse(d); } catch (x) { }
      if (d && d.closed && d.cancelled && (!d.videoId || d.videoId === opts.videoId)) { api.cancelled = true; cleanup(); }
    }
    function cleanup() { window.removeEventListener('onyx-player', onPlayer); }

    // animation de lancement (le chargement, lui, a déjà commencé en parallèle)
    var launched = false, onLaunched = [];
    // pas d'animation pour un changement de langue / l'épisode suivant (on enchaîne directement)
    var fx = Onyx.launchFx && !opts.quick ? Onyx.launchFx.play(meta, function () { launched = true; onLaunched.forEach(function (f) { f(); }); onLaunched = []; }) : null;
    if (!Onyx.launchFx || opts.quick) launched = true;
    function afterLaunch(f) { if (launched) f(); else onLaunched.push(f); }

    if (nb) {
      window.addEventListener('onyx-player', onPlayer);
      var opened = false, queued = null, handed = false;
      var send = function (o) { nb.playerProgress(JSON.stringify(o)); };
      afterLaunch(function () {
        if (api.cancelled || handed) return;
        opened = true;
        nb.playerPrepare(JSON.stringify({ prepare: true, title: meta.name || '', subtitle: opts.label || '', logo: logo || '', images: images, videoId: opts.videoId || '' }));
        if (queued) send(queued);
      });
      api.stage = function (st, label, detail, pct) {
        if (api.cancelled) return;
        if (st < last.st || pct < last.pct) return;
        last = { st: st, pct: pct };
        var o = { stage: st, label: label, detail: detail || '', pct: pct };
        if (opened) send(o); else queued = o;
      };
      api.status = function (t) { api.stage(Math.max(0, last.st), '', t, last.pct); };
      // le lecteur s'ouvre directement : l'écran de préparation n'est plus nécessaire
      api.handoff = function () { handed = true; cleanup(); };
      api.close = function (reason) {
        cleanup();
        if (!opened && fx) fx.cancel();
        if (!api.cancelled && opened && typeof nb.closePlayer === 'function') nb.closePlayer(reason || '');
        api.cancelled = true;
      };
      return api;
    }

    /* Version web (PC / navigateur) */
    var layers = [h('div.ld-img'), h('div.ld-img')];
    var bar = h('i.ld-fill'), pctEl = h('span.ld-pct', { text: '0 %' }), stageEl = h('span.ld-stage', { text: 'Recherche des sources…' });
    var detailEl = h('div.ld-detail'), steps = STEPS.map(function (s) { return h('span.ld-step', { text: s }); });
    var titleBox = h('div.ld-title', [h('h1', { text: meta.name || '' })]);
    if (logo) { var li = new Image(); li.onload = function () { if (li.naturalWidth > 10) { titleBox.innerHTML = ''; li.className = 'ld-logo'; titleBox.appendChild(li); } }; li.src = logo; }
    var root = h('div#loader', [layers[0], layers[1], h('div.ld-shade'),
      h('div.ld-info', [titleBox, opts.label ? h('div.ld-sub', { text: opts.label }) : null,
        h('div.ld-head', [stageEl, pctEl]), h('div.ld-bar', [bar]), detailEl, h('div.ld-steps', steps)]),
      h('button.ld-cancel.f', { type: 'button', html: Onyx.icons.back + '<span>Annuler</span>', onclick: function () { api.cancelled = true; api.close(); } })
    ]);
    document.body.appendChild(root);
    afterLaunch(function () { requestAnimationFrame(function () { root.classList.add('in'); }); });
    var shown = 0, slide = 0, timer = null;
    function nextSlide() {
      if (!images.length || !root.isConnected) return;
      var url = images[slide % images.length], layer = layers[slide % 2];
      slide++;
      var im = new Image();
      im.onload = function () {
        layer.style.backgroundImage = 'url("' + url + '")';
        layer.classList.remove('kb-a', 'kb-b'); void layer.offsetWidth;
        layer.classList.add(slide % 2 ? 'kb-a' : 'kb-b', 'show');
        layers[slide % 2].classList.remove('show');
      };
      im.onerror = function () { if (images.length > 1) setTimeout(nextSlide, 200); };
      im.src = url;
      if (images.length > 1) timer = setTimeout(nextSlide, 5200);
    }
    nextSlide();
    api.stage = function (st, label, detail, pct) {
      if (st < last.st) return;
      if (st !== last.st) steps.forEach(function (s, i) { s.className = 'ld-step' + (i < st ? ' done' : i === st ? ' on' : ''); });
      last.st = st;
      if (label) stageEl.textContent = label;
      if (detail !== undefined && detail !== null) detailEl.textContent = detail;
      if (pct > shown) { shown = Math.min(100, pct); bar.style.width = shown + '%'; pctEl.textContent = Math.round(shown) + ' %'; }
    };
    api.status = function (t) { detailEl.textContent = t; };
    api.handoff = function () { };
    api.close = function () {
      clearTimeout(timer);
      if (!root.isConnected) return;
      root.classList.add('out');
      setTimeout(function () { root.remove(); }, 650);
    };
    api.finish = function () {
      api.stage(3, 'C\'est parti', '', 100);
      setTimeout(api.close, 300);
    };
    api.stage(0, 'Recherche des sources…', '', 0);
    setTimeout(function () { Onyx.focus.set(Onyx.$('.ld-cancel', root)); }, 50);
    return api;
  };
})();
