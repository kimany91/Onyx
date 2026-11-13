/* Onyx — application : navigation, barre latérale, démarrage, télécommande */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h, S = Onyx.Stremio;

  var SECTIONS = [
    { id: 'search', label: 'Recherche', icon: 'search' },
    { id: 'home', label: 'Accueil', icon: 'home' },
    { id: 'movies', label: 'Films', icon: 'movie', view: 'catalog', params: { type: 'movie' } },
    { id: 'series', label: 'Séries', icon: 'tv', view: 'catalog', params: { type: 'series' } },
    { id: 'categories', label: 'Catégories', icon: 'grid' },
    { id: 'library', label: 'Ma liste', icon: 'list' },
    { id: 'addons', label: 'Addons', icon: 'addons' },
    { id: 'connections', label: 'Connexions', icon: 'phone' },
    { id: 'settings', label: 'Paramètres', icon: 'gear' }
  ];

  var app = Onyx.app = { stack: [], section: null, updateStatus: '' };

  /* ---------- Barre latérale ---------- */
  function buildSidebar() {
    var nav = Onyx.$('#sidebar');
    nav.innerHTML = '';
    nav.appendChild(h('div.side-logo', { html: Onyx.gemSvg('gem-side') + Onyx.wordmark() }));
    var items = h('div.side-items');
    SECTIONS.forEach(function (s) {
      var b = h('button.side-item.f', { type: 'button', data: { section: s.id } }, [
        h('span.side-ico', { html: Onyx.icons[s.icon] }), h('span.side-label', { text: s.label })
      ]);
      b.addEventListener('click', function () { app.go(s.id); });
      items.appendChild(b);
    });
    nav.appendChild(items);
  }
  function markSection(id) {
    Onyx.$$('#sidebar .side-item').forEach(function (b) { b.classList.toggle('active', b.dataset.section === id); });
  }

  /* ---------- Navigation ---------- */
  function sectionOf(name) { return SECTIONS.filter(function (s) { return s.id === name; })[0]; }

  app.go = function (name, params, opts) {
    opts = opts || {};
    var sec = sectionOf(name);
    var viewName = sec ? (sec.view || sec.id) : name;
    params = params || (sec && sec.params) || {};
    var factory = Onyx.views[viewName];
    if (!factory) return;

    if (sec) {
      // section principale : on vide la pile
      if (app.section === name && app.stack.length === 1 && !opts.force) {
        var only = app.stack[0];
        focusView(only);
        return;
      }
      while (app.stack.length) destroy(app.stack.pop());
      app.section = name;
      markSection(name);
    } else {
      var top = app.stack[app.stack.length - 1];
      if (top) { top.el.classList.remove('active'); top.el.classList.add('hidden'); if (top.onHide) top.onHide(); }
    }
    var v = factory(params);
    v.name = viewName;
    v.params = params;
    v.el.classList.add('view');
    Onyx.$('#view').appendChild(v.el);
    app.stack.push(v);
    requestAnimationFrame(function () { v.el.classList.add('active', 'enter'); setTimeout(function () { v.el.classList.remove('enter'); }, 450); });
    v.el.classList.add('active');
    if (v.onShow) v.onShow();
    if (!opts.keepSidebar) focusView(v);
    app.pushState();
  };

  function focusView(v) {
    var target = v.el._last && v.el._last.isConnected ? v.el._last : (v.focusDefault && v.focusDefault());
    if (target) Onyx.focus.set(target);
    else if (!Onyx.focus.restore(v.el)) { /* vue vide */ }
  }
  function destroy(v) {
    if (v.destroy) v.destroy();
    v.el.remove();
  }

  app.current = function () { return app.stack[app.stack.length - 1]; };

  app.back = function () {
    if (Onyx.closeTopModal()) return true;
    if (Onyx.player.active) { Onyx.player.close(); return true; }
    if (app.stack.length > 1) {
      destroy(app.stack.pop());
      var v = app.current();
      v.el.classList.remove('hidden');
      v.el.classList.add('active');
      if (v.onShow) v.onShow();
      focusView(v);
      app.pushState();
      return true;
    }
    if (!document.body.classList.contains('in-sidebar')) {
      var act = Onyx.$('#sidebar .side-item.active');
      if (act) { Onyx.focus.set(act); return true; }
    }
    if (app.section !== 'home') { app.go('home'); return true; }
    Onyx.confirm('Quitter Onyx ?', null, 'Quitter').then(function (ok) { if (ok) Onyx.native.exit(); });
    return true;
  };
  // appelé par Android (touche retour)
  window.onyxBack = function () { app.back(); return true; };

  // mémorise le dernier élément focalisé de chaque vue
  Onyx.bus.on('focus', function (el) {
    var v = app.current();
    if (v && v.el.contains(el)) v.el._last = el;
    var nav = Onyx.$('#sidebar');
    nav.classList.toggle('open', nav.contains(el));
  });

  /* ---------- État envoyé au téléphone ---------- */
  app.pushState = Onyx.debounce(function () {
    if (!Onyx.native.available) return;
    var v = app.current();
    var detail = v && v.name === 'detail' ? { type: v.params.type, id: v.params.id } : null;
    Onyx.native.setState({
      tvName: Onyx.settings.get('tvName'),
      screen: v ? v.name : 'home',
      detail: detail,
      nowPlaying: Onyx.player.state(),
      addons: S.addons.map(function (a) { return { transportUrl: a.transportUrl, manifest: a.manifest }; }),
      prefs: S.prefs.global(),
      account: S.account.get() ? S.account.get().email : null
    });
  }, 200);
  S.onChange(function () { app.pushState(); });
  Onyx.bus.on('progress', function () { app.pushState(); pushProgress(); });
  // la progression est partagée avec le téléphone via le serveur de connexion
  var pushProgress = Onyx.debounce(function () {
    if (Onyx.native.available) Onyx.native.call('setProgress', JSON.stringify(Onyx.progress.all()));
  }, 3000);
  function pullAccountProgress() {
    if (!S.account.get()) return;
    S.account.pullProgress().then(function (entries) { if (entries.length) Onyx.progress.mergeAll(entries); });
  }
  setInterval(pullAccountProgress, 10 * 60 * 1000);

  /* ---------- Commandes du téléphone ---------- */
  Onyx.bus.on('remote', function (cmd) {
    if (!cmd || !cmd.action) return;
    var a = cmd.action;
    if (a === 'key') {
      var map = { up: 'up', down: 'down', left: 'left', right: 'right', ok: 'ok', back: 'back' };
      if (cmd.key === 'home') { while (Onyx.closeTopModal()) { } if (Onyx.player.active) Onyx.player.close(); app.go('home', null, { force: true }); return; }
      if (map[cmd.key]) Onyx.focus.handleKey(map[cmd.key], false);
      return;
    }
    if (Onyx.player.command(cmd)) { app.pushState(); return; }
    if (a === 'open') {
      while (Onyx.closeTopModal()) { }
      if (Onyx.player.active) Onyx.player.close();
      app.go('detail', { type: cmd.type, id: cmd.id, preview: cmd.meta || null });
    } else if (a === 'play') {
      while (Onyx.closeTopModal()) { }
      if (Onyx.player.active) Onyx.player.close(true);
      var meta = cmd.meta || { id: cmd.id, type: cmd.type, name: '' };
      var go = function (full) {
        var video = cmd.videoId && full && full.videos ? full.videos.filter(function (v) { return v.id === cmd.videoId; })[0] : null;
        Onyx.player.play({ meta: Onyx.preview(full || meta), fullMeta: full || meta, type: cmd.type || meta.type, videoId: cmd.videoId || meta.id, video: video || cmd.video || null, stream: cmd.stream });
      };
      S.meta(cmd.type || meta.type, meta.id).then(go, function () { go(null); });
      Onyx.toast('Lecture demandée depuis le téléphone');
    } else if (a === 'autoplay') {
      while (Onyx.closeTopModal()) { }
      if (Onyx.player.active) Onyx.player.close(true);
      S.meta(cmd.type, cmd.id).then(function (full) {
        var v = cmd.videoId && full.videos ? full.videos.filter(function (x) { return x.id === cmd.videoId; })[0] : null;
        Onyx.player.auto(full, v || null, { prefs: cmd.prefs || null, startAt: cmd.startAt });
      }, function () {
        Onyx.player.auto(cmd.meta || { id: cmd.id, type: cmd.type, name: '' }, null, { prefs: cmd.prefs || null });
      });
      Onyx.toast('Lecture demandée depuis le téléphone');
    } else if (a === 'progress-merge') {
      Onyx.progress.mergeAll(cmd.entries || {});
    } else if (a === 'sources') {
      S.meta(cmd.type, cmd.id).then(function (m) {
        var v = cmd.videoId && m.videos ? m.videos.filter(function (x) { return x.id === cmd.videoId; })[0] : null;
        Onyx.sources.open(m, v || null);
      });
    } else if (a === 'search') {
      while (Onyx.closeTopModal()) { }
      var cur = app.current();
      if (cur && cur.name === 'search' && cur.setQuery) cur.setQuery(cmd.query);
      else app.go('search', { query: cmd.query || '' });
    } else if (a === 'text') {
      Onyx.bus.emit('remote-text', cmd.text || '');
      var c2 = app.current();
      if (!Onyx.$('#modals > .modal') && c2 && c2.name === 'search' && c2.setQuery) c2.setQuery(cmd.text || '');
    } else if (a === 'addon-install') {
      Onyx.installAddon(cmd.url).then(function () { Onyx.bus.emit('addons-changed-remote'); }, function () { });
    } else if (a === 'addon-remove') {
      S.remove(cmd.url); Onyx.bus.emit('addons-changed'); Onyx.bus.emit('addons-changed-remote');
    } else if (a === 'stremio-login') {
      Onyx.stremioLogin(cmd.email, cmd.password).then(function () { Onyx.bus.emit('addons-changed-remote'); }, function () { });
    } else if (a === 'stremio-sync') {
      S.account.pullAddons().then(function (l) { Onyx.toast(l.length + ' addons synchronisés', 'ok'); Onyx.bus.emit('addons-changed'); Onyx.bus.emit('addons-changed-remote'); }).catch(function (e) { Onyx.toast(e.message, 'error'); });
    } else if (a === 'hello') {
      Onyx.toast((cmd.device || 'Un téléphone') + ' est connecté', 'ok');
    }
    app.pushState();
  });

  /* Touches multimédia renvoyées par Android */
  Onyx.bus.on('native-key', function (d) { if (d && d.action) Onyx.focus.handleKey(d.action, false); });

  /* ---------- Mises à jour ---------- */
  Onyx.bus.on('update', function (u) {
    if (!u) return;
    if (u.status === 'available') { app.updateStatus = 'v' + u.version + ' disponible'; Onyx.toast('Mise à jour ' + u.version + ' en cours de téléchargement…'); }
    else if (u.status === 'downloading') app.updateStatus = 'téléchargement ' + (u.progress || 0) + ' %';
    else if (u.status === 'ready') { app.updateStatus = 'prête à installer'; Onyx.toast('Mise à jour prête : installation…', 'ok'); }
    else if (u.status === 'none') { app.updateStatus = 'à jour'; if (u.manual) Onyx.toast('Onyx est à jour', 'ok'); }
    else if (u.status === 'error') { app.updateStatus = ''; if (u.manual) Onyx.toast('Mise à jour impossible : ' + (u.message || 'erreur'), 'error'); }
  });

  /* ---------- Démarrage ---------- */
  function start() {
    var splash = Onyx.$('#splash');
    var showSplash = Onyx.settings.get('splash');
    var minDelay = showSplash ? 2900 : 0;
    if (!showSplash) splash.classList.add('quick');
    else splash.classList.add('run');
    if (Onyx.native.platform() !== 'web') document.body.classList.add('native', 'p-' + Onyx.native.platform());
    buildSidebar();
    var t0 = Date.now();
    var ready = S.init().catch(function () { });
    ready.then(function () {
      setTimeout(function () {
        app.go('home');
        splash.classList.add('out');
        setTimeout(function () { splash.remove(); }, 900);
        app.pushState();
        // (les mises à jour sont vérifiées automatiquement par l'app : démarrage, retour dans l'app, toutes les 3 h)
        // synchronisation silencieuse des addons du compte Stremio
        pullAccountProgress();
        pushProgress();
        if (S.account.get()) {
          var before = S.addons.map(function (a) { return a.transportUrl; }).join('|');
          S.account.pullAddons().then(function () {
            if (S.addons.map(function (a) { return a.transportUrl; }).join('|') !== before) Onyx.bus.emit('addons-changed');
          }).catch(function () { });
        }
      }, Math.max(0, minDelay - (Date.now() - t0)));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
