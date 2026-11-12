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
      if (url === bd.url) return;
      bd.url = url;
      var layers = Onyx.$$('.bd-layer', root);
      var next = layers[bd.idx = 1 - bd.idx], prev = layers[1 - bd.idx];
      if (!url) { next.classList.remove('show'); prev.classList.remove('show'); return; }
      var img = new Image();
      img.onload = function () {
        if (bd.url !== url) return;
        next.style.backgroundImage = 'url("' + url + '")';
        next.classList.add('show');
        prev.classList.remove('show');
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
