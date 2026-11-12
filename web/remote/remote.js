/* Onyx Remote — télécommande & lecture à distance depuis le téléphone */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h, S = Onyx.Stremio;

  var phone = window.OnyxPhone || null;
  // LOCAL = app Android du téléphone : fonctionne seule, la TV est optionnelle.
  // Sinon, page servie par la TV (navigateur) : simple télécommande.
  var LOCAL = !!phone && (location.hostname === 'appassets.androidplatform.net' || /[?&]local=1/.test(location.search));
  var qs = {};
  location.search.replace(/^\?/, '').split('&').forEach(function (p) { var kv = p.split('='); if (kv[0]) qs[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); });
  var device = (phone && phone.deviceName && phone.deviceName()) || (/Android/.test(navigator.userAgent) ? 'Téléphone Android' : /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'Navigateur');

  function parseTv(url) {
    if (!url) return null;
    var m = String(url).match(/^(https?:\/\/[^\/?#]+)[^?]*\?(?:.*&)?token=([^&#]+)/);
    return m ? { base: m[1], token: decodeURIComponent(m[2]) } : null;
  }
  var tv;
  if (LOCAL) {
    tv = parseTv(phone.tvUrl && phone.tvUrl());
    S.persist = true;
  } else {
    S.persist = false;
    var tk = qs.token || localStorage.getItem('onyx.remoteToken') || '';
    if (qs.token) { localStorage.setItem('onyx.remoteToken', qs.token); history.replaceState(null, '', location.pathname); }
    tv = { base: '', token: tk };
  }

  var state = null, online = false, addonsKey = '';

  Onyx.$('#gem').innerHTML = Onyx.gemSvg('g');
  document.body.classList.toggle('local', LOCAL);

  /* ---------- API TV ---------- */
  function api(path, body) {
    if (!tv) return Promise.reject(new Error('notv'));
    return fetch(tv.base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Onyx-Token': tv.token, 'X-Onyx-Device': device },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401) { setOnline(false, 'Code expiré — rescanne'); throw new Error('unauthorized'); }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function cmd(c) {
    vibrate(12);
    if (!tv) { toast('Aucune TV connectée'); return Promise.resolve(); }
    return api('/api/cmd', c).catch(function (e) { if (e.message !== 'unauthorized') toast('TV injoignable'); });
  }
  function vibrate(ms) { try { if (phone && phone.vibrate) phone.vibrate(ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { } }

  function setOnline(on, label) {
    var changed = online !== on;
    online = on;
    if (changed && LOCAL && currentTab === 'more') setTimeout(renderMore, 0);
    var el = Onyx.$('#tv');
    el.classList.toggle('on', on);
    el.classList.toggle('none', !tv);
    Onyx.$('#tvName').textContent = !tv ? 'Connecter une TV' : (label || (on ? ((state && state.tvName) || 'Onyx TV') : 'TV hors ligne'));
    var nt = Onyx.$('#noTv');
    if (nt) nt.style.display = tv ? 'none' : '';
  }
  Onyx.$('#tv').addEventListener('click', function () {
    if (!tv) { if (phone && phone.scan) phone.scan(); else toast('Scanne le QR code de la TV'); }
    else showTab('remote');
  });

  function poll() {
    if (!tv) return;
    api('/api/state').then(function (s) {
      state = s || {};
      setOnline(true);
      if (!LOCAL) {
        var key = (state.addons || []).map(function (a) { return a.transportUrl; }).join('|');
        if (key !== addonsKey) {
          addonsKey = key;
          S.setAddons(state.addons || []);
          if (currentTab === 'browse' && !Onyx.$('#search').value) renderHome();
          if (currentTab === 'more') renderMore();
        }
      }
      if (currentTab === 'now') renderNow();
    }).catch(function (e) { if (e.message !== 'unauthorized') setOnline(false); });
  }
  setInterval(function () { if (!document.hidden) poll(); }, 2000);
  function connectTv() {
    setOnline(false);
    poll();
    if (tv) api('/api/cmd', { action: 'hello', device: device }).catch(function () { });
  }
  connectTv();
  window.addEventListener('onyx-tv', function (e) {
    var d = e.detail; try { d = JSON.parse(d); } catch (x) { }
    tv = parseTv(d && d.url);
    state = null;
    connectTv();
    if (currentTab === 'more') renderMore();
    toast('TV connectée ✓');
  });

  /* ---------- Lecture sur le téléphone ---------- */
  var progress = {};
  try { progress = JSON.parse(localStorage.getItem('onyx.phoneProgress') || '{}'); } catch (e) { }
  function saveProgress() { try { localStorage.setItem('onyx.phoneProgress', JSON.stringify(progress)); } catch (e) { } }
  var playingId = null;
  window.addEventListener('onyx-player', function (e) {
    var d = e.detail; try { d = JSON.parse(d); } catch (x) { }
    if (!d || !d.videoId || !progress[d.videoId]) return;
    var p = progress[d.videoId];
    if (d.position !== undefined) { p.position = d.position / 1000; p.duration = d.duration / 1000; p.updated = Date.now(); }
    if (d.ended || (p.duration && p.position / p.duration > 0.92)) p.watched = true;
    saveProgress();
    if (d.closed) {
      playingId = null;
      if (d.error) toast('Lecture impossible : ' + d.error);
      if (currentTab === 'browse' && !Onyx.$('#search').value) renderHome();
    }
  });
  function withTimeout(p, ms, def) { return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(def); }, ms); })]); }
  function playLocal(meta, video, vid, stream) {
    toast('Préparation de la lecture…');
    var info = S.streamInfo(stream);
    S.resolve(stream, localStorage.getItem('onyx.phoneStreamServer') || 'http://127.0.0.1:11470').then(function (res) {
      if (res.external) { phone.openExternal(res.external, ''); return; }
      return withTimeout(S.subtitles(meta.type, vid, {}), 5000, []).then(function (subs) {
        var fr = (subs || []).filter(function (x) { return /^(fr|fre|fra)$/i.test(x.lang || ''); }).slice(0, 5);
        var en = (subs || []).filter(function (x) { return /^(en|eng)$/i.test(x.lang || ''); }).slice(0, 2);
        var list = fr.concat(en).map(function (x, i) { return { url: x.url, lang: x.lang, label: (x.lang || '').toUpperCase() + ' ' + (i + 1) }; });
        var prev = progress[vid];
        var startAt = prev && !prev.watched && prev.position > 20 ? prev.position : 0;
        progress[vid] = { meta: slim(meta), video: video ? { season: video.season, episode: video.episode || video.number, name: video.name || video.title, thumbnail: video.thumbnail } : null,
          stream: stream, position: startAt, duration: prev ? prev.duration : 0, updated: Date.now() };
        saveProgress();
        playingId = vid;
        phone.play(JSON.stringify({
          url: res.url, headers: res.headers || null, title: meta.name || '',
          subtitle: video ? 'S' + video.season + ':E' + (video.episode || video.number) + (video.name ? ' · ' + video.name : '') : '',
          subtitles: list, startAt: Math.floor(startAt * 1000), videoId: vid, subLang: 'fr', audioLang: 'fr', subtitlesAuto: !info.fr
        }));
      });
    }).catch(function (e) { toast(e.message || 'Lecture impossible'); });
  }
  function playTv(meta, vid, stream) {
    cmd({ action: 'play', type: meta.type, id: meta.id, videoId: vid, meta: slim(meta), stream: stream });
    toast('Lecture lancée sur la TV ▶');
    vibrate(30);
  }
  function choosePlay(meta, video, vid, stream) {
    if (!LOCAL) return playTv(meta, vid, stream);
    if (!tv || !online) return playLocal(meta, video, vid, stream);
    var box = h('div.choose', [
      h('button.btn.primary.wide', { text: '📱  Regarder sur ce téléphone', onclick: function () { close(); playLocal(meta, video, vid, stream); } }),
      h('button.btn.wide', { text: '📺  Lire sur la TV', onclick: function () { close(); playTv(meta, vid, stream); } }),
      h('button.btn.ghost.wide', { text: 'Annuler', onclick: function () { close(); } })
    ]);
    var ov = h('div.choose-ov', [box]);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    function close() { ov.remove(); }
    document.body.appendChild(ov);
  }

  /* ---------- Onglets ---------- */
  var currentTab = 'remote';
  if (LOCAL) { var nav = Onyx.$('.tabs'); nav.insertBefore(Onyx.$('[data-tab=browse]', nav), nav.firstChild); }
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
  function continueRow() {
    var items = Object.keys(progress).map(function (k) { return progress[k]; })
      .filter(function (p) { return p.meta && !p.watched && p.duration && p.position / p.duration > 0.02; })
      .sort(function (a, b) { return b.updated - a.updated; });
    var seen = {}, track = h('div.track.land');
    items.forEach(function (p) {
      if (seen[p.meta.id]) return; seen[p.meta.id] = 1;
      var img = (p.video && p.video.thumbnail) || p.meta.background || (/^tt/.test(p.meta.id) ? 'https://images.metahub.space/background/medium/' + p.meta.id + '/img' : poster(p.meta));
      var c = h('button.card.wide', [
        h('img', { src: img, loading: 'lazy', alt: '', onerror: function () { this.style.opacity = 0; } }),
        h('i.bar', [h('b', { style: { width: Math.round(p.position / p.duration * 100) + '%' } })]),
        h('span', { text: p.meta.name + (p.video ? ' · S' + p.video.season + 'E' + p.video.episode : '') })
      ]);
      c.addEventListener('click', function () { openDetail(p.meta); });
      track.appendChild(c);
    });
    return track.children.length ? h('section.row', [h('h2', { text: 'Reprendre' }), track]) : null;
  }
  function renderHome() {
    browse.innerHTML = '';
    if (LOCAL) { var cr = continueRow(); if (cr) browse.appendChild(cr); }
    if (!S.addons.length) { browse.appendChild(h('p.empty', { text: LOCAL ? 'Aucun addon : ajoute-en depuis l\'onglet Addons.' : online ? 'Aucun addon sur la TV.' : 'Connexion à la TV…' })); return; }
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
    var actions = h('div.d-actions');
    var last = null;
    Object.keys(progress).forEach(function (k) { var p = progress[k]; if (p.meta && p.meta.id === m.id && (!last || p.updated > last.updated)) { last = p; last.vid = k; } });
    if (LOCAL && last && !last.watched && last.stream && last.position > 20) {
      actions.appendChild(h('button.btn.primary', { text: '▶  Reprendre' + (last.video ? ' S' + last.video.season + 'E' + last.video.episode : '') + ' · ' + Onyx.fmtTime(last.position), onclick: function () {
        playLocal(m, last.video ? { id: last.vid, season: last.video.season, episode: last.video.episode, name: last.video.name } : null, last.vid, last.stream);
      } }));
    }
    if (tv) actions.appendChild(h('button.btn' + (actions.children.length ? '' : '.primary'), { text: 'Ouvrir sur la TV', onclick: function () { cmd({ action: 'open', type: m.type, id: m.id, meta: slim(m) }); toast('Ouvert sur la TV'); } }));
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
    if (!addons.length) { list.appendChild(h('p.hint', { text: LOCAL ? 'Aucun addon de sources installé. Ajoute-en depuis l\'onglet Addons (ou connecte ton compte Stremio).' : 'Aucun addon de sources installé sur la TV. Ajoute-en depuis l\'onglet Addons.' })); return; }
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
        b.addEventListener('click', function () { choosePlay(meta, video, vid, it.stream); });
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
    if (!tv) {
      box.innerHTML = ''; delete box.dataset.vid;
      box.appendChild(h('div.now-empty', [h('div.big-gem', { html: Onyx.gemSvg('g') }), h('p', { text: 'Aucune TV connectée. Connecte ta TV pour voir et contrôler ce qui y est en lecture.' }),
        phone && phone.scan ? h('button.btn.primary', { text: 'Scanner le QR code de la TV', onclick: function () { phone.scan(); } }) : null]));
      return;
    }
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
    if (LOCAL) return renderMoreLocal();
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

  /* Onglet Addons de l'app téléphone (addons stockés sur le téléphone) */
  function renderMoreLocal() {
    var box = Onyx.$('#more');
    box.innerHTML = '';
    // TV
    box.appendChild(h('div.card-box', tv ? [
      h('h2', { text: 'TV : ' + ((state && state.tvName) || 'Onyx TV') }),
      h('p.hint', { text: online ? 'Connectée — tu peux lancer les films sur la TV.' : 'Hors ligne : ouvre Onyx sur la TV (même Wi-Fi).' }),
      state && state.addons && state.addons.length ? h('button.btn.wide', { text: 'Copier les addons de la TV sur ce téléphone', onclick: function () {
        S.setAddons(state.addons); toast(state.addons.length + ' addons copiés'); renderMore(); renderHome();
      } }) : null,
      h('button.btn.wide', { text: 'Scanner une autre TV', onclick: function () { phone.scan(); } }),
      h('button.btn.ghost.wide', { text: 'Déconnecter la TV', onclick: function () { if (confirm('Oublier cette TV ?')) { phone.forgetTv(); tv = null; state = null; setOnline(false); renderMore(); } } })
    ] : [
      h('h2', { text: 'Ma TV' }),
      h('p.hint', { text: 'Optionnel : sur la TV, ouvre Onyx › Connexions et scanne le QR code pour la piloter et y lancer des films.' }),
      h('button.btn.primary.wide', { text: 'Scanner le QR code de la TV', onclick: function () { phone.scan(); } })
    ]));
    // Ajout
    var urlIn = h('input', { type: 'url', placeholder: 'https://…/manifest.json' });
    box.appendChild(h('div.card-box', [
      h('h2', { text: 'Ajouter un addon' }),
      h('p.hint', { text: 'URL d\'un addon Stremio (manifest.json).' }),
      h('form.inline', { onsubmit: function (e) {
        e.preventDefault(); if (!urlIn.value) return;
        toast('Installation…');
        S.install(urlIn.value.trim()).then(function (m) { toast('« ' + m.name + ' » installé'); urlIn.value = ''; renderMore(); renderHome(); }, function (er) { toast('Échec : ' + er.message); });
      } }, [urlIn, h('button.btn.primary', { type: 'submit', text: 'Ajouter' })])
    ]));
    // Compte
    var acc = S.account.get();
    var email = h('input', { type: 'email', placeholder: 'E-mail Stremio', autocomplete: 'username' });
    var pw = h('input', { type: 'password', placeholder: 'Mot de passe', autocomplete: 'current-password' });
    box.appendChild(h('div.card-box', acc ? [
      h('h2', { text: 'Compte Stremio' }), h('p.hint', { text: 'Connecté : ' + acc.email }),
      h('button.btn.wide', { text: 'Synchroniser les addons', onclick: function () { S.account.pullAddons().then(function (l) { toast(l.length + ' addons synchronisés'); renderMore(); renderHome(); }, function (er) { toast(er.message); }); } }),
      h('button.btn.ghost.wide', { text: 'Se déconnecter', onclick: function () { S.account.logout(); renderMore(); } })
    ] : [
      h('h2', { text: 'Compte Stremio' }),
      h('p.hint', { text: 'Récupère automatiquement tous tes addons Stremio.' }),
      h('form.stack', { onsubmit: function (e) {
        e.preventDefault(); if (!email.value || !pw.value) return;
        toast('Connexion…');
        var em = email.value.trim(), pass = pw.value;
        S.account.login(em, pass).then(function () { return S.account.pullAddons(); }).then(function (l) {
          toast(l.length + ' addons récupérés');
          if (tv && online) cmd({ action: 'stremio-login', email: em, password: pass });
          renderMore(); renderHome();
        }, function (er) { toast('Connexion impossible : ' + er.message); });
        pw.value = '';
      } }, [email, pw, h('button.btn.primary', { type: 'submit', text: tv ? 'Se connecter (téléphone + TV)' : 'Se connecter' })])
    ]));
    // Liste
    var list = h('div.addon-list');
    S.addons.forEach(function (a) {
      var m = a.manifest || {};
      list.appendChild(h('div.addon', [
        h('div.a-logo', [m.logo ? h('img', { src: m.logo, alt: '', onerror: function () { this.remove(); } }) : (m.name || '?').charAt(0)]),
        h('div.a-info', [h('b', { text: m.name }), h('small', { text: m.description || '' })]),
        h('button.a-del', { html: '&times;', onclick: function () { if (confirm('Supprimer « ' + m.name + ' » ?')) { S.remove(a.transportUrl); renderMore(); renderHome(); } } })
      ]));
    });
    box.appendChild(h('div.card-box', [h('h2', { text: 'Addons du téléphone (' + S.addons.length + ')' }), list]));
    var srv = h('input', { type: 'url', value: localStorage.getItem('onyx.phoneStreamServer') || 'http://127.0.0.1:11470' });
    box.appendChild(h('div.card-box', [
      h('h2', { text: 'Serveur de streaming (torrents)' }),
      h('p.hint', { text: 'Pour les sources torrent, l\'app Stremio doit être ouverte sur ce téléphone (ou indique l\'adresse d\'un serveur Stremio du réseau).' }),
      h('form.inline', { onsubmit: function (e) { e.preventDefault(); localStorage.setItem('onyx.phoneStreamServer', srv.value.trim().replace(/\/+$/, '')); toast('Enregistré'); } }, [srv, h('button.btn', { type: 'submit', text: 'OK' })])
    ]));
    box.appendChild(h('p.hint.center', { text: 'Onyx ' + ((phone && phone.version && phone.version()) || '') }));
  }

  /* ---------- Démarrage ---------- */
  if (LOCAL) {
    S.init().then(function () { showTab('browse'); }, function () { showTab('browse'); });
  }
  setOnline(false);

  /* ---------- Toast ---------- */
  var toastT;
  function toast(t) {
    var el = Onyx.$('#toast');
    el.textContent = t; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }
})();
