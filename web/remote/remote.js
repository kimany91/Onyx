/* Onyx Remote — télécommande & lecture à distance depuis le téléphone */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h, S = Onyx.Stremio;
  S.persist = false;

  var phone = window.OnyxPhone || null;
  var qs = {};
  location.search.replace(/^\?/, '').split('&').forEach(function (p) { var kv = p.split('='); if (kv[0]) qs[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); });
  var token = qs.token || localStorage.getItem('onyx.remoteToken') || '';
  if (qs.token) { localStorage.setItem('onyx.remoteToken', qs.token); history.replaceState(null, '', location.pathname); }
  var device = (phone && phone.deviceName && phone.deviceName()) || (/Android/.test(navigator.userAgent) ? 'Téléphone Android' : /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'Navigateur');

  var state = null, online = false, addonsKey = '';

  Onyx.$('#gem').innerHTML = Onyx.gemSvg('g');

  /* ---------- API TV ---------- */
  function api(path, body) {
    return fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Onyx-Token': token, 'X-Onyx-Device': device },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401) { setOnline(false, 'Code expiré — rescanne le QR'); throw new Error('unauthorized'); }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function cmd(c) {
    vibrate(12);
    return api('/api/cmd', c).catch(function (e) { if (e.message !== 'unauthorized') toast('TV injoignable'); });
  }
  function vibrate(ms) { try { if (phone && phone.vibrate) phone.vibrate(ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { } }

  function setOnline(on, label) {
    online = on;
    var tv = Onyx.$('#tv');
    tv.classList.toggle('on', on);
    Onyx.$('#tvName').textContent = label || (on ? ((state && state.tvName) || 'Onyx TV') : 'TV hors ligne');
  }

  function poll() {
    api('/api/state').then(function (s) {
      state = s || {};
      setOnline(true);
      var key = (state.addons || []).map(function (a) { return a.transportUrl; }).join('|');
      if (key !== addonsKey) {
        addonsKey = key;
        S.setAddons(state.addons || []);
        if (currentTab === 'browse' && !Onyx.$('#search').value) renderHome();
        if (currentTab === 'more') renderMore();
      }
      if (currentTab === 'now') renderNow();
    }).catch(function (e) { if (e.message !== 'unauthorized') setOnline(false); });
  }
  setInterval(function () { if (!document.hidden) poll(); }, 2000);
  poll();
  api('/api/cmd', { action: 'hello', device: device }).catch(function () { });

  /* ---------- Onglets ---------- */
  var currentTab = 'remote';
  Onyx.$$('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.dataset.tab); });
  });
  function showTab(t) {
    currentTab = t;
    Onyx.$$('.tabs button').forEach(function (x) { x.classList.toggle('active', x.dataset.tab === t); });
    Onyx.$$('.tab').forEach(function (x) { x.classList.toggle('active', x.id === 'tab-' + t); });
    if (t === 'browse' && !Onyx.$('#browse').children.length) renderHome();
    if (t === 'now') renderNow();
    if (t === 'more') renderMore();
    window.scrollTo(0, 0);
  }

  /* ---------- Télécommande ---------- */
  Onyx.$$('[data-key]').forEach(function (b) {
    var repeatT, repeatI;
    function fire() { cmd({ action: 'key', key: b.dataset.key }); }
    b.addEventListener('touchstart', function (e) {
      e.preventDefault(); b.classList.add('pressed'); fire();
      if (/up|down|left|right/.test(b.dataset.key)) repeatT = setTimeout(function () { repeatI = setInterval(fire, 160); }, 450);
    }, { passive: false });
    function end() { b.classList.remove('pressed'); clearTimeout(repeatT); clearInterval(repeatI); }
    b.addEventListener('touchend', end); b.addEventListener('touchcancel', end);
    b.addEventListener('click', function () { if (!('ontouchstart' in window)) fire(); });
  });
  Onyx.$$('[data-cmd]').forEach(function (b) { b.addEventListener('click', function () { cmd({ action: b.dataset.cmd }); }); });
  Onyx.$$('[data-seek]').forEach(function (b) { b.addEventListener('click', function () { cmd({ action: 'seek', delta: Number(b.dataset.seek) }); }); });
  Onyx.$('#textForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = Onyx.$('#textInput').value;
    if (!v) return;
    cmd({ action: 'text', text: v });
    toast('Texte envoyé à la TV');
  });

  /* ---------- Explorer ---------- */
  var browse = Onyx.$('#browse');
  var searchInput = Onyx.$('#search');
  var searchTok = 0;
  searchInput.addEventListener('input', Onyx.debounce(function () {
    var q = searchInput.value.trim();
    if (q.length < 2) { renderHome(); return; }
    var my = ++searchTok;
    browse.innerHTML = '<div class="loading"><i></i><i></i><i></i></div>';
    S.search(q).then(function (groups) {
      if (my !== searchTok) return;
      browse.innerHTML = '';
      if (!groups.length) { browse.appendChild(h('p.empty', { text: 'Aucun résultat pour « ' + q + ' »' })); return; }
      groups.forEach(function (g) { browse.appendChild(rowEl(label(g.cat), g.metas, g.cat.type)); });
    });
  }, 450));
  searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') searchInput.blur(); });

  function label(cat) {
    var t = cat.type === 'movie' ? 'Films' : cat.type === 'series' ? 'Séries' : cat.type;
    var n = String(cat.name || '');
    if (/cinemeta/i.test(cat.addon.manifest.name)) return t + ' ' + ({ Popular: 'populaires', New: 'récents', Featured: 'à la une' }[n] || n.toLowerCase());
    return n + ' · ' + t;
  }
  function poster(m) {
    if (m.poster) return m.poster;
    if (/^tt/.test(m.id)) return 'https://images.metahub.space/poster/small/' + m.id + '/img';
    return '';
  }
  function rowEl(title, metas, type) {
    var track = h('div.track');
    metas.slice(0, 30).forEach(function (m) {
      m.type = m.type || type;
      var c = h('button.card', [h('img', { src: poster(m), loading: 'lazy', alt: '', onerror: function () { this.style.opacity = 0; } }), h('span', { text: m.name })]);
      c.addEventListener('click', function () { openDetail(m); });
      track.appendChild(c);
    });
    return h('section.row', [h('h2', { text: title }), track]);
  }
  function renderHome() {
    browse.innerHTML = '';
    if (!S.addons.length) { browse.appendChild(h('p.empty', { text: online ? 'Aucun addon sur la TV.' : 'Connexion à la TV…' })); return; }
    S.homeCatalogs().slice(0, 10).forEach(function (cat) {
      var holder = h('div');
      browse.appendChild(holder);
      S.catalog(cat.addon, cat.type, cat.id).then(function (metas) {
        if (metas.length) holder.replaceWith(rowEl(label(cat), metas, cat.type));
      }).catch(function () { });
    });
  }

  /* ---------- Fiche (feuille) ---------- */
  var sheet = Onyx.$('#sheet'), sheetBody = Onyx.$('#sheetBody');
  function openSheet() { sheet.classList.add('open'); document.body.classList.add('noscroll'); history.pushState({ sheet: 1 }, ''); }
  function closeSheet() { sheet.classList.remove('open'); document.body.classList.remove('noscroll'); }
  window.addEventListener('popstate', function () { if (sheet.classList.contains('open')) closeSheet(); });
  sheet.addEventListener('click', function (e) { if (e.target === sheet) history.back(); });

  function openDetail(m) {
    sheetBody.innerHTML = '';
    sheetBody.scrollTop = 0;
    var bg = m.background || (/^tt/.test(m.id) ? 'https://images.metahub.space/background/medium/' + m.id + '/img' : poster(m));
    var head = h('div.d-head', { style: { backgroundImage: 'url("' + bg + '")' } }, [h('button.close', { html: '&times;', onclick: function () { history.back(); } })]);
    var info = h('div.d-info', [h('h1', { text: m.name }), h('p.d-meta', { text: [m.releaseInfo || m.year, m.runtime, m.imdbRating ? '★ ' + m.imdbRating : ''].filter(Boolean).join('  ·  ') }), h('p.d-desc', { text: m.description || '' })]);
    var actions = h('div.d-actions', [
      h('button.btn.primary', { text: 'Ouvrir sur la TV', onclick: function () { cmd({ action: 'open', type: m.type, id: m.id, meta: slim(m) }); toast('Ouvert sur la TV'); } })
    ]);
    var eps = h('div.d-eps'), streams = h('div.d-streams');
    sheetBody.appendChild(head); sheetBody.appendChild(info); sheetBody.appendChild(actions); sheetBody.appendChild(eps); sheetBody.appendChild(streams);
    openSheet();
    S.meta(m.type, m.id).then(function (full) {
      full.type = full.type || m.type;
      info.querySelector('.d-desc').textContent = full.description || m.description || '';
      info.querySelector('.d-meta').textContent = [full.releaseInfo || full.year, full.runtime, full.imdbRating ? '★ ' + full.imdbRating : '', (full.genres || []).slice(0, 3).join(', ')].filter(Boolean).join('  ·  ');
      if (full.videos && full.videos.length && full.type !== 'movie') renderEpisodes(full, eps, streams);
      else loadStreams(full, null, streams);
    }).catch(function () { loadStreams(m, null, streams); });
  }
  function slim(m) { return { id: m.id, type: m.type, name: m.name, poster: m.poster || '', background: m.background || '', logo: m.logo || '', description: m.description || '', releaseInfo: m.releaseInfo || '' }; }

  function renderEpisodes(meta, box, streams) {
    var vids = meta.videos.slice().sort(function (a, b) { return (a.season - b.season) || ((a.episode || a.number) - (b.episode || b.number)); });
    var seasons = []; vids.forEach(function (v) { if (seasons.indexOf(v.season) < 0) seasons.push(v.season); });
    if (seasons.length > 1 && seasons[0] === 0) seasons.push(seasons.shift());
    var sel = h('select.season');
    seasons.forEach(function (s) { sel.appendChild(h('option', { value: s, text: s === 0 ? 'Bonus' : 'Saison ' + s })); });
    var list = h('div.ep-list');
    function render() {
      list.innerHTML = '';
      var s = Number(sel.value);
      vids.filter(function (v) { return v.season === s; }).forEach(function (v) {
        var e = h('button.ep', [
          v.thumbnail ? h('img', { src: v.thumbnail, loading: 'lazy', alt: '' }) : h('div.ph'),
          h('div', [h('b', { text: (v.episode || v.number) + '. ' + (v.name || v.title || '') }), h('small', { text: v.overview || '' })])
        ]);
        e.addEventListener('click', function () {
          Onyx.$$('.ep.sel', list).forEach(function (x) { x.classList.remove('sel'); });
          e.classList.add('sel');
          loadStreams(meta, v, streams);
          setTimeout(function () { streams.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
        });
        list.appendChild(e);
      });
    }
    sel.addEventListener('change', render);
    if (seasons.indexOf(1) >= 0) sel.value = 1;
    box.appendChild(h('div.sec-title', [h('span', { text: 'Épisodes' }), sel]));
    box.appendChild(list);
    render();
    streams.innerHTML = '<p class="hint">Choisis un épisode pour voir les sources.</p>';
  }

  function loadStreams(meta, video, box) {
    var vid = video ? video.id : meta.id;
    box.innerHTML = '';
    box.appendChild(h('div.sec-title', [h('span', { text: video ? 'Sources · S' + video.season + 'E' + (video.episode || video.number) : 'Sources' })]));
    var list = h('div.src-list');
    box.appendChild(list);
    var addons = S.streamAddons(meta.type, vid);
    if (!addons.length) { list.appendChild(h('p.hint', { text: 'Aucun addon de sources installé sur la TV. Ajoute-en depuis l\'onglet Addons.' })); return; }
    var lang = (state && state.streamLang) || 'fr';
    var pending = addons.length, total = 0;
    var loading = h('div.loading', [h('i'), h('i'), h('i')]);
    list.appendChild(loading);
    S.streams(meta.type, vid, function (res) {
      pending--;
      var items = res.streams.map(function (s, i) { return { addon: res.addon, stream: s, info: S.streamInfo(s), addonIndex: addons.indexOf(res.addon), index: i }; });
      S.sortStreams(items, lang);
      if (items.length) list.appendChild(h('div.src-group', { text: res.addon.manifest.name }));
      items.forEach(function (it) {
        var inf = it.info;
        var badges = [inf.quality, inf.fr ? 'FR' : '', inf.cached ? '⚡' : ''].concat(inf.badges).concat([inf.size]).filter(Boolean);
        var b = h('button.src', [
          h('div.src-t', { text: (inf.title.split('\n')[0] || inf.name) }),
          h('div.src-b', badges.map(function (x) { return h('span' + (x === 'FR' ? '.fr' : ''), { text: x }); }))
        ]);
        b.addEventListener('click', function () {
          cmd({ action: 'play', type: meta.type, id: meta.id, videoId: vid, meta: slim(meta), stream: it.stream });
          toast('Lecture lancée sur la TV ▶');
          vibrate(30);
        });
        list.appendChild(b);
      });
      total += items.length;
      if (!pending) { loading.remove(); if (!total) list.appendChild(h('p.hint', { text: 'Aucune source trouvée.' })); }
    });
  }

  /* ---------- En cours ---------- */
  function renderNow() {
    var box = Onyx.$('#now');
    var np = state && state.nowPlaying;
    if (!np) {
      box.innerHTML = '';
      box.appendChild(h('div.now-empty', [h('div.big-gem', { html: Onyx.gemSvg('g') }), h('p', { text: 'Rien en lecture sur la TV.' }), h('button.btn', { text: 'Explorer', onclick: function () { showTab('browse'); } })]));
      return;
    }
    var pct = np.duration ? np.position / np.duration * 100 : 0;
    if (box.dataset.vid === np.videoId && box.firstChild) {
      Onyx.$('.now-bar i', box).style.width = pct + '%';
      Onyx.$('.now-time', box).textContent = Onyx.fmtTime(np.position) + ' / ' + Onyx.fmtTime(np.duration);
      Onyx.$('.now-pp', box).textContent = np.paused ? '▶' : '❚❚';
      return;
    }
    box.dataset.vid = np.videoId;
    box.innerHTML = '';
    var bar = h('div.now-bar', [h('i', { style: { width: pct + '%' } })]);
    bar.addEventListener('click', function (e) {
      var r = bar.getBoundingClientRect();
      if (np.duration) cmd({ action: 'seekTo', position: (e.clientX - r.left) / r.width * state.nowPlaying.duration });
    });
    box.appendChild(h('div.now', [
      h('div.now-art', { style: { backgroundImage: 'url("' + (np.background || np.poster) + '")' } }),
      h('h1', { text: np.title }), h('p.now-sub', { text: np.subtitle || '' }),
      bar, h('div.now-time', { text: Onyx.fmtTime(np.position) + ' / ' + Onyx.fmtTime(np.duration) }),
      h('div.now-ctl', [
        h('button', { text: '−30', onclick: function () { cmd({ action: 'seek', delta: -30 }); } }),
        h('button', { text: '−10', onclick: function () { cmd({ action: 'seek', delta: -10 }); } }),
        h('button.now-pp', { text: np.paused ? '▶' : '❚❚', onclick: function () { cmd({ action: 'playpause' }); } }),
        h('button', { text: '+10', onclick: function () { cmd({ action: 'seek', delta: 10 }); } }),
        h('button', { text: '+30', onclick: function () { cmd({ action: 'seek', delta: 30 }); } })
      ]),
      h('button.btn.stop', { text: 'Arrêter la lecture', onclick: function () { cmd({ action: 'stop' }); } })
    ]));
  }

  /* ---------- Addons / compte ---------- */
  function renderMore() {
    var box = Onyx.$('#more');
    box.innerHTML = '';
    var urlIn = h('input', { type: 'url', placeholder: 'https://…/manifest.json' });
    box.appendChild(h('div.card-box', [
      h('h2', { text: 'Ajouter un addon' }),
      h('p.hint', { text: 'Colle l\'URL d\'un addon Stremio : il sera installé sur la TV.' }),
      h('form.inline', { onsubmit: function (e) { e.preventDefault(); if (urlIn.value) { cmd({ action: 'addon-install', url: urlIn.value.trim() }); toast('Installation envoyée à la TV'); urlIn.value = ''; setTimeout(poll, 2500); } } }, [urlIn, h('button.btn.primary', { type: 'submit', text: 'Ajouter' })])
    ]));

    var email = h('input', { type: 'email', placeholder: 'E-mail Stremio', autocomplete: 'username' });
    var pw = h('input', { type: 'password', placeholder: 'Mot de passe', autocomplete: 'current-password' });
    var acc = state && state.account;
    box.appendChild(h('div.card-box', acc ? [
      h('h2', { text: 'Compte Stremio' }), h('p.hint', { text: 'Connecté : ' + acc }),
      h('button.btn', { text: 'Synchroniser les addons', onclick: function () { cmd({ action: 'stremio-sync' }); toast('Synchronisation lancée'); setTimeout(poll, 3000); } })
    ] : [
      h('h2', { text: 'Compte Stremio' }),
      h('p.hint', { text: 'Connecte ton compte : la TV récupère tous tes addons Stremio.' }),
      h('form.stack', { onsubmit: function (e) { e.preventDefault(); if (email.value && pw.value) { cmd({ action: 'stremio-login', email: email.value.trim(), password: pw.value }); toast('Connexion envoyée à la TV'); pw.value = ''; setTimeout(poll, 3500); } } }, [email, pw, h('button.btn.primary', { type: 'submit', text: 'Se connecter' })])
    ]));

    var list = h('div.addon-list');
    (S.addons || []).forEach(function (a) {
      var m = a.manifest || {};
      list.appendChild(h('div.addon', [
        h('div.a-logo', [m.logo ? h('img', { src: m.logo, alt: '', onerror: function () { this.remove(); } }) : (m.name || '?').charAt(0)]),
        h('div.a-info', [h('b', { text: m.name }), h('small', { text: m.description || '' })]),
        h('button.a-del', { html: '&times;', onclick: function () { if (confirm('Supprimer « ' + m.name + ' » de la TV ?')) { cmd({ action: 'addon-remove', url: a.transportUrl }); setTimeout(poll, 800); } } })
      ]));
    });
    box.appendChild(h('div.card-box', [h('h2', { text: 'Addons installés (' + S.addons.length + ')' }), list]));
    if (phone && phone.scan) box.appendChild(h('button.btn.wide', { text: 'Connecter une autre TV (scanner)', onclick: function () { phone.scan(); } }));
  }

  /* ---------- Toast ---------- */
  var toastT;
  function toast(t) {
    var el = Onyx.$('#toast');
    el.textContent = t; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }
})();
