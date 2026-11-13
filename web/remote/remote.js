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
    if (!m) return null;
    var port = (m[1].match(/:(\d+)$/) || [])[1] || '80';
    var ips = (String(url).match(/[?&]ips=([^&#]+)/) || [])[1];
    var alts = ips ? decodeURIComponent(ips).split(',').filter(Boolean).map(function (ip) { return 'http://' + ip + ':' + port; }) : [];
    return { base: m[1], token: decodeURIComponent(m[2]), alts: alts };
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
  /* Requêtes vers la TV : par l'app elle-même quand c'est possible (le WebView d'Android
     bloque les appels d'une page vers un appareil du réseau local), sinon par fetch. */
  var httpWait = {}, httpSeq = 0;
  window.addEventListener('onyx-http', function (e) {
    var d = e.detail; try { d = JSON.parse(d); } catch (x) { }
    var w = d && httpWait[d.id];
    if (!w) return;
    delete httpWait[d.id];
    clearTimeout(w.t);
    if (!d.status) { var er = new Error(d.error || 'réseau'); er.wifi = d.wifi; return w.reject(er); }
    w.resolve({ status: d.status, ok: d.status >= 200 && d.status < 300, json: function () { try { return Promise.resolve(JSON.parse(d.body || 'null')); } catch (x) { return Promise.reject(x); } } });
  });
  function request(url, opts) {
    if (phone && typeof phone.http === 'function') {
      return new Promise(function (resolve, reject) {
        var id = 'h' + (++httpSeq);
        httpWait[id] = { resolve: resolve, reject: reject, t: setTimeout(function () { delete httpWait[id]; reject(new Error('délai dépassé')); }, 12000) };
        phone.http(id, opts.method || 'GET', url, JSON.stringify(opts.headers || {}), opts.body || null);
      });
    }
    return fetch(url, opts);
  }
  function api(path, body) {
    if (!tv) return Promise.reject(new Error('notv'));
    return request(tv.base + path, {
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
    if (changed && on) setTimeout(syncTv, 500);
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
    }).catch(function (e) {
      if (e.message === 'unauthorized') return;
      setOnline(false);
      // l'adresse de la TV a peut-être changé : on la recherche (au plus toutes les 20 s)
      var now = Date.now();
      if (LOCAL && now - lastLocate > 20000) { lastLocate = now; locate().then(function () { poll(); }).catch(function (er) { lastError = explain(er); }); }
    });
  }
  var lastLocate = 0;
  setInterval(function () { if (!document.hidden) poll(); }, 2000);
  function connectTv() {
    setOnline(false);
    poll();
    if (tv) api('/api/cmd', { action: 'hello', device: device }).catch(function () { });
  }
  connectTv();
  /* Trouve la TV : adresse du QR code, puis ses autres adresses, puis recherche sur le réseau local */
  function tryBase(base) {
    return request(base + '/api/state', { method: 'GET', headers: { 'X-Onyx-Token': tv.token, 'X-Onyx-Device': device } }).then(function (r) {
      if (r.status === 401) { var e = new Error('unauthorized'); throw e; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return base;
    });
  }
  function discover() {
    if (!phone || typeof phone.discover !== 'function') return Promise.resolve([]);
    return new Promise(function (resolve) {
      var done = false;
      var on = function (e) { var d = e.detail; try { d = JSON.parse(d); } catch (x) { } done = true; window.removeEventListener('onyx-found', on); resolve((d && d.tvs) || []); };
      window.addEventListener('onyx-found', on);
      phone.discover();
      setTimeout(function () { if (!done) { window.removeEventListener('onyx-found', on); resolve([]); } }, 7000);
    });
  }
  var locating = null;
  function locate() {
    if (locating) return locating;
    var cands = [tv.base].concat(tv.alts || []), lastErr = null;
    function chain(list) {
      if (!list.length) return Promise.reject(lastErr || new Error('introuvable'));
      return tryBase(list[0]).catch(function (e) { if (e.message === 'unauthorized') throw e; lastErr = e; return chain(list.slice(1)); });
    }
    locating = chain(cands).catch(function (e) {
      if (e.message === 'unauthorized') throw e;
      return discover().then(function (found) {
        found = found.filter(function (b) { return cands.indexOf(b) < 0; });
        if (!found.length) throw lastErr || e;
        return chain(found);
      });
    }).then(function (base) {
      if (base !== tv.base) {
        tv.base = base;
        if (phone && phone.saveTv) phone.saveTv(base + '/remote/?token=' + encodeURIComponent(tv.token));
      }
      return base;
    });
    locating.then(function () { locating = null; }, function () { locating = null; });
    return locating;
  }
  function explain(err) {
    var host = tv ? tv.base.replace(/^https?:\/\//, '') : '', m = (err && err.message) || '';
    if (m === 'unauthorized') return 'Code expiré : rescanne le QR code de la TV (Connexions).';
    if (err && err.wifi === false) return 'Active le Wi-Fi du téléphone (même réseau que la TV).';
    if (/refused|ECONNREFUSED/i.test(m)) return 'La TV (' + host + ') refuse la connexion : ouvre Onyx sur la TV.';
    if (/unreachable|EHOSTUNREACH|ENETUNREACH|No route/i.test(m)) return 'La TV (' + host + ') n\'est pas joignable depuis ce Wi-Fi : vérifie que les deux sont sur le même réseau (pas un réseau invité).';
    if (/timed? ?out|ETIMEDOUT|délai/i.test(m)) return 'Pas de réponse de la TV (' + host + ') : la box isole peut-être les appareils (réseau invité, 5 GHz séparé…).';
    return 'TV introuvable (' + host + ') : ' + m.slice(0, 90);
  }
  window.addEventListener('onyx-tv', function (e) {
    var d = e.detail; try { d = JSON.parse(d); } catch (x) { }
    tv = parseTv(d && d.url);
    state = null;
    if (!tv) { toast('QR code non reconnu : scanne celui de la TV (Connexions)'); return; }
    toast('Connexion à la TV…', 9000);
    if (currentTab === 'more') renderMore();
    locate().then(function () {
      connectTv();
      toast('TV connectée ✓');
      api('/api/cmd', { action: 'hello', device: device }).catch(function () { });
    }).catch(function (err) { setOnline(false); lastError = explain(err); toast(lastError, 9000); if (currentTab === 'more') renderMore(); });
  });
  var lastError = '';

  /* ---------- Lecture (choix automatique du fichier, comme Netflix) ---------- */
  function withTimeout(p, ms, def) { return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(def); }, ms); })]); }
  function vidOf(meta, video) { return video ? video.id : (meta.behaviorHints && meta.behaviorHints.defaultVideoId) || meta.id; }
  function epLabel(v) { return v ? 'S' + v.season + ':E' + (v.episode || v.number) + (v.name || v.title ? ' · ' + (v.name || v.title) : '') : ''; }
  var cur = null; // lecture en cours sur le téléphone

  /* Point d'entrée : où lire ? (téléphone / TV) */
  function autoPlay(meta, video, opts) {
    opts = opts || {};
    if (!LOCAL) return playOnTv(meta, video, opts);
    if (opts.target === 'phone' || !tv || !online) return playPhone(meta, video, opts);
    if (opts.target === 'tv') return playOnTv(meta, video, opts);
    var box = h('div.choose', [
      h('div.choose-title', { text: (meta.name || '') + (video ? '  ·  ' + epLabel(video) : '') }),
      h('button.btn.primary.wide', { text: '📱  Regarder sur ce téléphone', onclick: function () { close(); playPhone(meta, video, opts); } }),
      h('button.btn.wide', { text: '📺  Lire sur la TV', onclick: function () { close(); playOnTv(meta, video, opts); } }),
      h('button.btn.ghost.wide', { text: 'Annuler', onclick: function () { close(); } })
    ]);
    var ov = h('div.choose-ov', [box]);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    function close() { ov.remove(); }
    document.body.appendChild(ov);
  }

  function playOnTv(meta, video, opts) {
    var vid = vidOf(meta, video);
    if (opts.stream) cmd({ action: 'play', type: meta.type, id: meta.id, videoId: vid, meta: slim(meta), stream: opts.stream });
    else cmd({ action: 'autoplay', type: meta.type, id: meta.id, videoId: vid, meta: slim(meta), prefs: S.prefs.forShow(meta.id) });
    toast('Lecture lancée sur la TV ▶');
    vibrate(30);
  }

  function loadingSheet(meta, video) {
    var status = h('small', { text: 'Recherche de la meilleure source…' });
    var api = { cancelled: false };
    var ov = h('div.choose-ov.loading-ov', [h('div.choose.center', [
      h('div.big-gem.spin', { html: Onyx.gemSvg('g') }),
      h('div.choose-title', { text: (meta.name || '') + (video ? '  ·  ' + epLabel(video) : '') }),
      status,
      h('button.btn.ghost.wide', { text: 'Annuler', onclick: function () { api.cancelled = true; api.close(); } })
    ])]);
    document.body.appendChild(ov);
    api.status = function (t) { status.textContent = t; };
    api.close = function () { ov.remove(); };
    return api;
  }

  function playPhone(meta, video, opts) {
    var vid = vidOf(meta, video);
    var prefs = S.prefs.forShow(meta.id);
    var loading = Onyx.loader({ meta: meta, video: video, label: epLabel(video), videoId: vid, quick: !!opts && opts.startAt !== undefined });
    var subsP = withTimeout(S.subtitles(meta.type, vid, {}), 4000, []);
    S.collect(meta.type, vid, function (n, done, total, el, x) {
      loading.stage(0, 'Recherche des sources', S.collectText(n, done, total, el, x), (x ? x.frac : done / Math.max(1, total)) * 25);
    }).then(function (items) {
      if (loading.cancelled) return;
      if (!items.length) { loading.close('aucune source trouvée'); toast('Aucune source trouvée avec tes addons'); return; }
      var ranked = S.rank(items, prefs);
      if (opts.stream) {
        ranked = [{ stream: opts.stream, info: S.streamInfo(opts.stream) }].concat(ranked.filter(function (x) { return !S.sameStream(x.stream, opts.stream); }));
      } else {
        var prog = Onyx.progress.get(vid);
        if (prog && prog.stream) {
          var i = ranked.findIndex(function (x) { return S.sameStream(x.stream, prog.stream); });
          if (i > 0 && ranked[i].score >= ranked[0].score - 20) ranked.unshift(ranked.splice(i, 1)[0]);
        }
      }
      cur = { meta: meta, video: video || null, vid: vid, items: items, ranked: ranked, prefs: prefs, startAt: opts.startAt, subsP: subsP };
      var ctx = cur;
      if (!meta.videos && meta.type === 'series') S.meta(meta.type, meta.id).then(function (m) { if (cur && cur.meta === meta) cur.meta = m; }, function () { });
      // torrents : on vérifie lesquels ont vraiment des pairs avant de lancer
      loading.stage(1, 'Vérification des sources', items.length + ' fichiers trouvés', 25);
      (opts.stream ? Promise.resolve(ranked) : S.pickHealthy(ranked, function (label, detail, frac) { loading.stage(1, label, detail, 25 + frac * 15); })).then(function (r) {
        if (loading.cancelled) return;
        ctx.ranked = r;
        startPhone(ctx, 0, loading);
      });
    });
  }

  function startPhone(ctx, i, loading) {
    var cand = ctx.ranked[i];
    if (!cand) {
      if (loading) loading.close('aucune source lisible');
      else if (phone.closePlayer) phone.closePlayer('aucune source lisible');
      toast('Aucune source n\'a pu être lue');
      return;
    }
    ctx.tryIndex = i; ctx.stream = cand.stream; ctx.info = cand.info;
    if (loading) loading.stage(1, 'Préparation de la lecture', S.describe(cand.info) + (cand.addon ? '  ·  ' + cand.addon.manifest.name : ''), 42);
    var prog = Onyx.progress.get(ctx.vid);
    var startAt = ctx.startAt !== undefined ? ctx.startAt : (prog && !prog.watched && prog.position > 20 ? prog.position : 0);
    S.resolve(cand.stream, localStorage.getItem('onyx.phoneStreamServer') || 'http://127.0.0.1:11470').then(function (res) {
      if (loading && loading.cancelled) return;
      if (res.external) { if (loading) loading.close(); phone.openExternal(res.external, ''); return; }
      ctx.subsP = ctx.subsP || withTimeout(S.subtitles(ctx.meta.type, ctx.vid, {}), 4000, []);
      return withTimeout(ctx.subsP, res.torrent ? 300 : 1200, []).then(function (subs) {
        if (loading && loading.cancelled) return;
        if (loading) loading.handoff();
        var v = ctx.video;
        var prev = Onyx.progress.get(ctx.vid);
        Onyx.progress.update({
          videoId: ctx.vid, meta: slim(ctx.meta), type: ctx.meta.type,
          video: v ? { season: v.season, episode: v.episode || v.number, name: v.name || v.title, thumbnail: v.thumbnail } : null,
          stream: ctx.stream, position: startAt, duration: (prev && prev.duration) || 0
        });
        var menu = S.menuOptions(ctx.items, ctx.prefs);
        menu.current = { audio: ctx.prefs.audio, subs: ctx.prefs.subs, quality: String(ctx.prefs.quality) };
        menu.info = S.describe(ctx.info);
        phone.play(JSON.stringify({
          url: res.url, headers: res.headers || null, title: ctx.meta.name || '', subtitle: epLabel(v),
          subtitles: S.pickSubtitles(subs, ctx.prefs), startAt: Math.floor(startAt * 1000), videoId: ctx.vid,
          audioLang: ctx.prefs.audio, subLang: ctx.prefs.subs, subtitlesAuto: ctx.prefs.subs !== 'off',
          deviceLang: S.deviceLang(), menu: menu,
          background: ctx.meta.background || (/^tt/.test(ctx.meta.id) ? 'https://images.metahub.space/background/medium/' + ctx.meta.id + '/img' : ''),
          poster: ctx.meta.poster || '',
          logo: Onyx.logoOf(ctx.meta) || '', images: Onyx.cinematicImages(ctx.meta, v)
        }));
      });
    }).catch(function () { if (!(loading && loading.cancelled)) startPhone(ctx, i + 1, loading); });
  }

  /* Changement de langue/qualité dans le lecteur : même position */
  function applyPrefs(ctx, changes, position, inFile) {
    var changedFile = false;
    Object.keys(changes).forEach(function (k) {
      var v = changes[k];
      if (k === 'quality' && v !== 'auto') v = Number(v);
      if (ctx.prefs[k] !== v) { ctx.prefs[k] = v; if (k !== 'subs') changedFile = true; }
    });
    if (changes.audio === 'vo' && ctx.prefs.subs === 'off' && !changes.subs) ctx.prefs.subs = S.deviceLang();
    if (changes.audio && changes.audio === S.deviceLang() && !changes.subs) ctx.prefs.subs = 'off';
    S.prefs.setShow(ctx.meta.id, { audio: ctx.prefs.audio, subs: ctx.prefs.subs, quality: ctx.prefs.quality });
    if (!changedFile || inFile) return;
    var ranked = S.rank(ctx.items, ctx.prefs);
    if (S.sameStream(ranked[0].stream, ctx.stream)) { phone.playerMessage('Pas d\'autre version disponible : ' + S.describe(ctx.info)); return; }
    ctx.ranked = ranked; ctx.startAt = position;
    phone.playerMessage('Changement : ' + S.describe(ranked[0].info) + '…');
    startPhone(ctx, 0, null);
  }

  window.addEventListener('onyx-player', function (e) {
    var d = e.detail; try { d = JSON.parse(d); } catch (x) { }
    if (!d || !cur || d.cancelled || (d.videoId && d.videoId !== cur.vid)) return;
    var ctx = cur;
    if (d.position !== undefined && !d.failed) Onyx.progress.update({ videoId: ctx.vid, position: d.position / 1000, duration: d.duration / 1000, ended: !!d.ended });
    if (d.duration > 0 && d.position / d.duration > 0.85 && !ctx.nextWarm && S.hasTorrentEngine()) {
      ctx.nextWarm = true;
      var nvs = ((ctx.meta && ctx.meta.videos) || []).filter(function (v) { return v.season !== 0; })
        .sort(function (a, b) { return (a.season - b.season) || ((a.episode || a.number) - (b.episode || b.number)); });
      var ni = nvs.findIndex(function (v) { return v.id === ctx.vid; });
      if (ni >= 0 && nvs[ni + 1]) S.collect(ctx.meta.type, nvs[ni + 1].id).then(function (items) {
        if (!items.length) return;
        S.pickHealthy(S.rank(items, ctx.prefs)).then(function (r) {
          if (r[0] && r[0].info.kind === 'torrent') S.prepare(r[0].stream);
        });
      });
    }
    if (d.failed) {
      ctx.startAt = d.position > 0 ? d.position / 1000 : ctx.startAt;
      phone.playerMessage('Source indisponible, essai d\'une autre…');
      startPhone(ctx, (ctx.tryIndex || 0) + 1, null);
      return;
    }
    if (d['switch']) { applyPrefs(ctx, d['switch'], d.position / 1000, !!d.inFile); return; }
    if (d.closed) {
      if (d.error) toast('Lecture impossible : ' + d.error);
      S.account.pushProgress(Onyx.progress.get(ctx.vid));
      syncTv();
      if (d.ended && localStorage.getItem('onyx.phoneAutoNext') !== '0') {
        var vids = ((ctx.meta && ctx.meta.videos) || []).filter(function (v) { return v.season !== 0; })
          .sort(function (a, b) { return (a.season - b.season) || ((a.episode || a.number) - (b.episode || b.number)); });
        var i = vids.findIndex(function (v) { return v.id === ctx.vid; });
        if (i >= 0 && vids[i + 1]) { toast('Épisode suivant : ' + epLabel(vids[i + 1])); setTimeout(function () { playPhone(ctx.meta, vids[i + 1], { startAt: 0 }); }, 700); }
      }
      if (detailRefresh) detailRefresh();
      if (currentTab === 'browse' && !Onyx.$('#search').value) renderHome();
    }
  });

  /* Progression partagée : TV ⇄ téléphone ⇄ compte Stremio */
  function syncTv() {
    if (!LOCAL || !tv || !online) return;
    api('/api/progress').then(function (remote) {
      var newer = Onyx.progress.mergeAll(remote || {});
      if (Object.keys(newer).length) return api('/api/progress', { entries: newer });
    }).catch(function () { });
  }
  setInterval(function () { if (!document.hidden) syncTv(); }, 30000);

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
    metas.slice(0, 50).forEach(function (m) {
      m.type = m.type || type;
      var c = h('button.card', [h('img', { src: poster(m), loading: 'lazy', alt: '', onerror: function () { this.style.opacity = 0; } }), h('span', { text: m.name })]);
      c.addEventListener('click', function () { openDetail(m); });
      track.appendChild(c);
    });
    return h('section.row', [h('h2', { text: title }), track]);
  }
  function continueRow() {
    var items = Onyx.progress.continueList();
    var track = h('div.track.land');
    items.forEach(function (p) {
      var img = (p.video && p.video.thumbnail) || p.meta.background || (/^tt/.test(p.meta.id) ? 'https://images.metahub.space/background/medium/' + p.meta.id.split(':')[0] + '/img' : poster(p.meta));
      var c = h('button.card.wide', [
        h('img', { src: img, loading: 'lazy', alt: '', onerror: function () { this.style.opacity = 0; } }),
        h('i.bar', [h('b', { style: { width: Math.round(p.position / p.duration * 100) + '%' } })]),
        h('span', { text: p.meta.name + (p.video ? ' · S' + p.video.season + ':E' + p.video.episode : '') })
      ]);
      c.addEventListener('click', function () { openDetail(p.meta); });
      track.appendChild(c);
    });
    return track.children.length ? h('section.row', [h('h2', { text: 'Reprendre la lecture' }), track]) : null;
  }
  /* Catégories (comme sur Netflix) : petites cartes avec icône 3D en métal poli.
     Doigt posé dessus : la carte s'illumine et l'icône tourne ; doigt levé : elle s'arrête. */
  function genreCard(g) {
    var still = h('img.g3d-still', { alt: '' });
    var box = h('div.g3d-box', [h('span.g3d-flat', { html: Onyx.genreIcon(g.id) }), still]);
    var c = h('button.gcard', [h('div.gcard-bg'), box, h('span.gcard-label', { text: g.label })]);
    c.style.setProperty('--gc', g.color);
    var G = Onyx.Genre3D, timer = 0, held = false, x0 = 0, y0 = 0;
    var px = function () { return Math.round(Math.max(box.clientWidth, 64) * Math.min(2, window.devicePixelRatio || 1)); };
    var release = function () {
      clearTimeout(timer);
      if (!c.classList.contains('held')) return;
      c.classList.remove('held');
      if (G && G.supported) G.detach();
    };
    c.addEventListener('touchstart', function (e) {
      held = false; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
      clearTimeout(timer);
      timer = setTimeout(function () {
        held = true;
        c.classList.add('held');
        if (navigator.vibrate) try { navigator.vibrate(8); } catch (er) { }
        if (G && G.supported) G.attach(box, g.id, g.color, px());
      }, 320);
    }, { passive: true });
    c.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (Math.abs(t.clientX - x0) > 10 || Math.abs(t.clientY - y0) > 10) release();
    }, { passive: true });
    c.addEventListener('touchend', release);
    c.addEventListener('touchcancel', release);
    c.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    c.addEventListener('click', function (e) { if (held) { held = false; e.preventDefault(); return; } renderGenre(g); });
    c._loadStill = function () {
      if (!G || !G.supported) return;
      var src = G.thumb(g.id, g.color, px());
      if (src) { still.onload = function () { box.classList.add('ready'); }; still.src = src; }
    };
    return c;
  }
  function genreChips() {
    var track = h('div.track.genres');
    var cards = Onyx.Collections.GENRES.map(function (g) { var c = genreCard(g); track.appendChild(c); return c; });
    var i = 0;
    (function next() {
      if (i >= cards.length) return;
      if (!track.isConnected) { setTimeout(next, 250); return; }
      cards[i++]._loadStill();
      setTimeout(next, 30);
    })();
    return h('section.row.cats', [h('h2', { text: 'Catégories' }), track]);
  }
  function renderGenre(g) {
    searchInput.value = '';
    browse.innerHTML = '';
    var back = h('button.genre-back', { html: '&#8249; Catégories', onclick: function () { renderHome(); window.scrollTo(0, 0); } });
    browse.appendChild(h('div.genre-head', [back, h('h1', { text: g.label })]));
    var holder = h('div.loading', [h('i'), h('i'), h('i')]);
    browse.appendChild(holder);
    window.scrollTo(0, 0);
    Onyx.Collections.genre(g.id).then(function (rows) {
      holder.remove();
      rows.forEach(function (r) { browse.appendChild(rowEl(r.title, r.metas, 'movie')); });
      if (!rows.length) browse.appendChild(h('p.empty', { text: 'Aucun titre dans cette catégorie.' }));
    });
  }

  function renderHome() {
    browse.innerHTML = '';
    if (LOCAL) { var cr = continueRow(); if (cr) browse.appendChild(cr); }
    browse.appendChild(genreChips());
    if (!S.addons.length) { browse.appendChild(h('p.empty', { text: LOCAL ? 'Aucun addon : ajoute-en depuis l\'onglet Addons.' : online ? 'Aucun addon sur la TV.' : 'Connexion à la TV…' })); return; }
    // ordre : Au cinéma, 2 catalogues populaires, Classiques, Disney, Marvel, puis le reste
    var cats = S.homeCatalogs();
    var special = Onyx.Collections.homeRows;
    var specs = [{ title: special[0].title, load: special[0].load }];
    cats.slice(0, 2).forEach(function (cat) { specs.push({ title: label(cat), type: cat.type, load: function () { return S.catalog(cat.addon, cat.type, cat.id); } }); });
    special.slice(1).forEach(function (r) { specs.push({ title: r.title, load: r.load }); });
    cats.slice(2, 10).forEach(function (cat) { specs.push({ title: label(cat), type: cat.type, load: function () { return S.catalog(cat.addon, cat.type, cat.id); } }); });
    specs.forEach(function (spec) {
      var holder = h('div');
      browse.appendChild(holder);
      spec.load().then(function (metas) {
        if (metas.length && holder.isConnected) holder.replaceWith(rowEl(spec.title, metas, spec.type || 'movie'));
      }).catch(function () { });
    });
  }

  /* ---------- Fiche (feuille) ---------- */
  var sheet = Onyx.$('#sheet'), sheetBody = Onyx.$('#sheetBody');
  function openSheet() { sheet.classList.add('open'); document.body.classList.add('noscroll'); history.pushState({ sheet: 1 }, ''); }
  function closeSheet() { sheet.classList.remove('open'); document.body.classList.remove('noscroll'); }
  window.addEventListener('popstate', function () { if (sheet.classList.contains('open')) closeSheet(); });
  sheet.addEventListener('click', function (e) { if (e.target === sheet) history.back(); });

  var detailRefresh = null;
  function openDetail(m) {
    if (Onyx.ambient) Onyx.ambient.meta(m); // couleurs du film prêtes pour l'animation de lancement
    sheetBody.innerHTML = '';
    sheetBody.scrollTop = 0;
    detailRefresh = null;
    var bg = m.background || (/^tt/.test(m.id) ? 'https://images.metahub.space/background/medium/' + m.id + '/img' : poster(m));
    var head = h('div.d-head', { style: { backgroundImage: 'url("' + bg + '")' } }, [h('button.close', { html: '&times;', onclick: function () { history.back(); } })]);
    var titleEl = h('h1', { text: m.name });
    var metaEl = h('p.d-meta', { text: [m.releaseInfo || m.year, m.imdbRating ? '★ ' + m.imdbRating : ''].filter(Boolean).join('  ·  ') });
    var descEl = h('p.d-desc.clamp', { text: m.description || '' });
    descEl.addEventListener('click', function () { descEl.classList.toggle('clamp'); });
    var playBtn = h('button.btn.primary.wide.play', { html: '<span class="pi">▶</span> Lecture' });
    var actions = h('div.d-actions', [playBtn]);
    var prefsBox = h('div.d-prefs');
    var eps = h('div.d-eps');
    var manual = h('details.d-manual', [h('summary', { text: 'Choisir un fichier manuellement' }), h('div.src-list')]);
    sheetBody.appendChild(head);
    sheetBody.appendChild(h('div.d-info', [titleEl, metaEl, descEl]));
    sheetBody.appendChild(actions);
    sheetBody.appendChild(prefsBox);
    sheetBody.appendChild(eps);
    sheetBody.appendChild(manual);
    openSheet();

    var full = m, isSeries = false, season = null;
    // logo à la place du titre si disponible
    var logo = m.logo || (/^tt/.test(m.id) ? 'https://images.metahub.space/logo/medium/' + m.id + '/img' : null);
    if (logo) { var li = new Image(); li.onload = function () { if (li.naturalWidth > 10) { li.className = 'd-logo'; titleEl.replaceWith(li); } }; li.src = logo; }

    function videosSorted() {
      return (full.videos || []).slice().sort(function (a, b) { return (a.season - b.season) || ((a.episode || a.number) - (b.episode || b.number)); });
    }
    function target() {
      if (!isSeries) return null;
      var vids = videosSorted().filter(function (v) { return v.season !== 0; });
      var last = Onyx.progress.lastForMeta(full.id);
      if (last) {
        var i = vids.findIndex(function (v) { return v.id === last.videoId; });
        if (i >= 0) return last.watched && vids[i + 1] ? vids[i + 1] : vids[i];
      }
      var now = Date.now();
      return vids.filter(function (v) { return !v.released || new Date(v.released).getTime() < now; })[0] || vids[0] || null;
    }
    function renderPlay() {
      var t = target();
      var vid = t ? t.id : full.id;
      var p = Onyx.progress.get(vid);
      var resume = p && !p.watched && p.position > 20;
      var ep = t ? ' S' + t.season + ':E' + (t.episode || t.number) : '';
      playBtn.innerHTML = '<span class="pi">▶</span> ' + (resume ? 'Reprendre' + ep + '<small>' + Onyx.fmtTime(p.position) + (p.duration ? ' / ' + Onyx.fmtTime(p.duration) : '') + '</small>' : 'Lecture' + ep);
      playBtn.onclick = function () { autoPlay(full, t, {}); };
      if (resume && p.duration) {
        var bar = h('i.play-bar', [h('b', { style: { width: Math.round(p.position / p.duration * 100) + '%' } })]);
        playBtn.appendChild(bar);
      }
      var tvBtn = Onyx.$('.tv-open', actions);
      if (tvBtn) tvBtn.remove();
      if (tv) actions.appendChild(h('button.btn.wide.tv-open', { text: '📺  Ouvrir sur la TV', onclick: function () { cmd({ action: 'open', type: full.type, id: full.id, meta: slim(full) }); toast('Ouvert sur la TV'); } }));
    }

    /* Audio / Sous-titres / Qualité (mémorisé pour ce titre) */
    function renderPrefs() {
      var p = S.prefs.forShow(full.id);
      var o = S.menuOptions(null, p);
      prefsBox.innerHTML = '';
      function pill(icon, key, list) {
        var sel = h('select');
        list.forEach(function (x) { var op = h('option', { value: x.code, text: x.label }); if (String(p[key]) === x.code) op.selected = true; sel.appendChild(op); });
        var lab = h('span.v', { text: (list.filter(function (x) { return String(p[key]) === x.code; })[0] || {}).label || '' });
        sel.addEventListener('change', function () {
          var ch = {}; ch[key] = key === 'quality' && sel.value !== 'auto' ? Number(sel.value) : sel.value;
          if (key === 'audio' && sel.value === 'vo' && p.subs === 'off') ch.subs = S.deviceLang();
          if (key === 'audio' && sel.value === S.deviceLang()) ch.subs = 'off';
          S.prefs.setShow(full.id, ch);
          renderPrefs();
          if (manual.open) loadManual();
        });
        return h('label.pill', [h('span.i', { text: icon }), lab, h('span.caret', { text: '▾' }), sel]);
      }
      prefsBox.appendChild(pill('🔊', 'audio', o.audio.map(function (x) { return { code: x.code, label: x.label.replace(' (appareil)', '').replace('Version originale (VO)', 'VO') }; })));
      prefsBox.appendChild(pill('💬', 'subs', o.subs.map(function (x) { return { code: x.code, label: x.code === 'off' ? 'Sans sous-titres' : 'ST ' + x.label }; })));
      prefsBox.appendChild(pill('✦', 'quality', o.quality.map(function (x) { return { code: x.code, label: x.code === 'auto' ? 'Qualité auto' : x.label }; })));
    }

    function renderEpisodes() {
      var vids = videosSorted();
      var seasons = []; vids.forEach(function (v) { if (seasons.indexOf(v.season) < 0) seasons.push(v.season); });
      if (seasons.length > 1 && seasons[0] === 0) seasons.push(seasons.shift());
      var t = target();
      if (season === null) season = t ? t.season : seasons[0];
      eps.innerHTML = '';
      var sel = h('select.season');
      seasons.forEach(function (s) { var op = h('option', { value: s, text: s === 0 ? 'Bonus' : 'Saison ' + s }); if (s === season) op.selected = true; sel.appendChild(op); });
      sel.addEventListener('change', function () { season = Number(sel.value); renderEpisodes(); });
      eps.appendChild(h('div.sec-title', [h('span', { text: 'Épisodes' }), sel]));
      var list = h('div.ep-list');
      var now = Date.now();
      vids.filter(function (v) { return v.season === season; }).forEach(function (v) {
        var p = Onyx.progress.get(v.id);
        var future = v.released && new Date(v.released).getTime() > now;
        var pct = p && p.duration ? Math.min(100, Math.round(p.position / p.duration * 100)) : 0;
        var row = h('button.ep' + (t && t.id === v.id ? '.current' : '') + (future ? '.future' : ''), [
          h('div.ep-thumb', [
            v.thumbnail ? h('img', { src: v.thumbnail, loading: 'lazy', alt: '', onerror: function () { this.remove(); } }) : null,
            h('span.ep-play', { text: '▶' }),
            p && p.watched ? h('span.ep-check', { text: '✓' }) : null,
            pct && !(p && p.watched) ? h('i.ep-bar', [h('b', { style: { width: pct + '%' } })]) : null
          ]),
          h('div.ep-txt', [
            h('b', { text: (v.episode || v.number) + '. ' + (v.name || v.title || 'Épisode ' + (v.episode || v.number)) }),
            h('small.ep-sub', { text: future ? 'Sortie le ' + new Date(v.released).toLocaleDateString('fr-FR') : p && p.watched ? 'Vu' : pct ? 'Reste ' + Onyx.fmtTime(p.duration - p.position) : '' }),
            h('small.ep-ov', { text: v.overview || v.description || '' })
          ])
        ]);
        if (!future) row.addEventListener('click', function () { autoPlay(full, v, {}); });
        list.appendChild(row);
      });
      eps.appendChild(list);
    }

    /* Choix manuel (replié par défaut) */
    function loadManual() {
      var box = Onyx.$('.src-list', manual);
      box.innerHTML = '<div class="loading"><i></i><i></i><i></i></div>';
      var t = target();
      var vid = vidOf(full, t);
      S.collect(full.type, vid).then(function (items) {
        box.innerHTML = '';
        if (t) box.appendChild(h('p.hint', { text: 'Fichiers pour ' + epLabel(t) }));
        if (!items.length) { box.appendChild(h('p.hint', { text: S.streamAddons(full.type, vid).length ? 'Aucune source trouvée.' : 'Aucun addon de sources installé : ajoute-en dans l\'onglet Addons.' })); return; }
        S.rank(items, S.prefs.forShow(full.id)).slice(0, 40).forEach(function (it, i) {
          var inf = it.info;
          var tags = [inf.size, inf.cached ? '⚡ instantané' : '', inf.kind === 'torrent' ? 'torrent' : '', it.addon.manifest.name].filter(Boolean).join(' · ');
          var b = h('button.src', [
            h('span.src-q', { text: inf.quality || 'HD' }),
            h('span.src-main', [h('b', { text: S.describe(inf) }), h('small', { text: tags })]),
            i === 0 ? h('span.src-best', { text: 'Recommandé' }) : null
          ]);
          b.addEventListener('click', function () { autoPlay(full, t, { stream: it.stream }); });
          box.appendChild(b);
        });
      });
    }
    manual.addEventListener('toggle', function () { if (manual.open) loadManual(); });

    detailRefresh = function () { if (!sheet.classList.contains('open')) return; renderPlay(); if (isSeries) renderEpisodes(); };
    renderPlay(); renderPrefs();
    S.meta(m.type, m.id).then(function (fm) {
      full = fm; full.type = full.type || m.type;
      isSeries = (full.videos || []).length > 0 && full.type !== 'movie';
      descEl.textContent = full.description || m.description || '';
      metaEl.textContent = [full.releaseInfo || full.year, full.runtime, full.imdbRating ? '★ ' + full.imdbRating : '', (full.genres || []).slice(0, 3).join(', ')].filter(Boolean).join('  ·  ');
      renderPlay();
      if (isSeries) renderEpisodes();
      // préchargement : sources prêtes et début du torrent téléchargé avant même d'appuyer sur Lecture
      if (LOCAL && S.hasTorrentEngine()) {
        var t = target();
        S.collect(full.type, vidOf(full, t)).then(function (items) {
          if (!items.length) return;
          S.pickHealthy(S.rank(items, S.prefs.forShow(full.id))).then(function (r) {
            if (r[0] && r[0].info.kind === 'torrent') S.prepare(r[0].stream);
          });
        });
      }
    }).catch(function () { });
  }
  function slim(m) { return { id: m.id, type: m.type, name: m.name, poster: m.poster || '', background: m.background || '', logo: m.logo || '', description: m.description || '', releaseInfo: m.releaseInfo || '' }; }

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
      h('p.hint', { text: online ? 'Connectée — tu peux lancer les films sur la TV.' : (lastError || 'Hors ligne : ouvre Onyx sur la TV (même Wi-Fi).') }),
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
    S.account.pullProgress().then(function (e) { if (e.length) { Onyx.progress.mergeAll(e); if (currentTab === 'browse' && !Onyx.$('#search').value) renderHome(); } });
  }
  setOnline(false);

  /* ---------- Toast ---------- */
  var toastT;
  function toast(t, ms) {
    var el = Onyx.$('#toast');
    el.textContent = t; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('show'); }, ms || 2200);
  }

  /* Sons de l'interface (téléphone) : onglets, boutons, cartes */
  document.addEventListener('click', function (e) {
    if (!Onyx.sfx) return;
    var t = e.target.closest && e.target.closest('button, .card, .ep, a');
    if (!t) return;
    if (t.closest('.tabs')) Onyx.sfx('move');
    else if (t.classList.contains('genre-back') || t.classList.contains('sheet-close') || /close|back/.test(t.className)) Onyx.sfx('back');
    else Onyx.sfx('select');
  }, true);
})();
