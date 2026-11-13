/* Onyx — lecture (lecteur natif Android / lecteur intégré HTML5 / lecteur externe) */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h, S = Onyx.Stremio;

  var P = Onyx.player = { active: false, ctx: null, el: null, video: null, nativeActive: false };

  function nextVideo(meta, videoId) {
    var vids = (meta && meta.videos) || [];
    vids = vids.filter(function (v) { return v.season !== 0; }).sort(function (a, b) { return (a.season - b.season) || ((a.episode || a.number) - (b.episode || b.number)); });
    var i = vids.findIndex(function (v) { return v.id === videoId; });
    return i >= 0 && i + 1 < vids.length ? vids[i + 1] : null;
  }
  P.nextVideo = nextVideo;

  function epLabel(v) {
    if (!v || v.season === undefined) return '';
    return 'S' + v.season + ':E' + (v.episode || v.number) + (v.name || v.title ? ' · ' + (v.name || v.title) : '');
  }
  P.epLabel = epLabel;

  function withTimeout(p, ms, def) {
    return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(def); }, ms); })]);
  }

  function videoIdOf(meta, video) {
    return video ? video.id : (meta.behaviorHints && meta.behaviorHints.defaultVideoId) || meta.id;
  }

  /* ---------- Lecture automatique « à la Netflix » ----------
     Récupère toutes les sources, choisit le fichier qui correspond à la langue
     et à la qualité voulues, et passe au suivant si un fichier ne marche pas. */
  P.auto = function (meta, video, opts) {
    opts = opts || {};
    var type = meta.type, videoId = videoIdOf(meta, video);
    var prefs = S.prefs.forShow(meta.id);
    if (opts.prefs) Object.keys(opts.prefs).forEach(function (k) { prefs[k] = opts.prefs[k]; });
    var loading = Onyx.loader({ meta: meta, video: video, label: epLabel(video), videoId: videoId, quick: opts.startAt !== undefined });
    // sous-titres en parallèle : aucune attente supplémentaire au lancement
    var subsP = withTimeout(S.subtitles(type, videoId, {}), 4000, []);
    var itemsP = opts.items ? Promise.resolve(opts.items) : S.collect(type, videoId, function (n, done, total, el, x) {
      loading.stage(0, 'Recherche des sources', S.collectText(n, done, total, el, x), (x ? x.frac : done / Math.max(1, total)) * 25);
    });
    itemsP.then(function (items) {
      if (loading.cancelled) return;
      if (!items.length) {
        loading.close('aucune source trouvée');
        Onyx.toast('Aucune source trouvée pour ce titre avec tes addons.', 'error', 5000);
        if (Onyx.sources) Onyx.sources.open(meta, video);
        return;
      }
      var ranked = S.rank(items, prefs);
      if (opts.stream) {
        ranked = [{ stream: opts.stream, info: S.streamInfo(opts.stream), addon: null }]
          .concat(ranked.filter(function (x) { return !S.sameStream(x.stream, opts.stream); }));
      } else {
        // même fichier que la dernière fois s'il correspond toujours aussi bien
        var prog = Onyx.progress.get(videoId);
        if (prog && prog.stream && !opts.prefs) {
          var i = ranked.findIndex(function (x) { return S.sameStream(x.stream, prog.stream); });
          if (i > 0 && ranked[i].score >= ranked[0].score - 20) ranked.unshift(ranked.splice(i, 1)[0]);
        }
      }
      var ctx = { manual: !!opts.stream, meta: Onyx.preview(meta), fullMeta: meta, type: type, videoId: videoId, video: video || null, items: items, ranked: ranked, prefs: prefs, startAt: opts.startAt, subsP: subsP };
      // torrents : on vérifie lesquels ont vraiment des pairs avant de lancer
      loading.stage(1, 'Vérification des sources', items.length + ' fichiers trouvés', 25);
      (opts.stream ? Promise.resolve(ranked) : S.pickHealthy(ranked, function (label, detail, frac) { loading.stage(1, label, detail, 25 + frac * 15); })).then(function (r) {
        if (loading.cancelled) return;
        ctx.ranked = r;
        ctx.loader = loading;
        start(ctx, 0, loading);
      });
    });
  };

  /* Préchargement dès l'ouverture d'une fiche : sources en cache + début du torrent prêt */
  P.prewarm = function (meta, video) {
    if (!meta || !meta.id) return;
    var vid = videoIdOf(meta, video);
    S.collect(meta.type, vid).then(function (items) {
      if (!items.length) return;
      S.pickHealthy(S.rank(items, S.prefs.forShow(meta.id))).then(function (r) {
        if (r[0] && r[0].info.kind === 'torrent') S.prepare(r[0].stream);
      });
    });
  };

  /* Compatibilité : lecture d'une source précise (choix manuel / téléphone) */
  P.play = function (ctx) {
    P.auto(ctx.fullMeta || ctx.meta, ctx.video, { stream: ctx.stream, startAt: ctx.startAt });
  };

  function start(ctx, i, loading) {
    // sources d'image disque ignorées en lecture automatique (sauf choix manuel)
    while (ctx.ranked[i] && ctx.ranked[i].info.disc && !(ctx.ranked[i] === ctx.ranked[0] && ctx.manual)) i++;
    var cand = ctx.ranked[i];
    if (!cand) {
      if (loading) loading.close('aucune source lisible');
      if (P.nativeActive) Onyx.native.call('closePlayer', 'aucune source lisible');
      Onyx.toast('Aucune source n\'a pu être lue. Choisis-en une manuellement.', 'error', 6000);
      if (Onyx.sources) Onyx.sources.open(ctx.fullMeta, ctx.video);
      return;
    }
    ctx.tryIndex = i; ctx.stream = cand.stream; ctx.info = cand.info;
    if (loading) loading.stage(1, 'Préparation de la lecture', S.describe(cand.info) + (cand.addon ? '  ·  ' + cand.addon.manifest.name : ''), 42);
    var prog = Onyx.progress.get(ctx.videoId);
    var startAt = ctx.startAt !== undefined ? ctx.startAt : (prog && !prog.watched && prog.position > 20 ? prog.position : 0);
    S.resolve(cand.stream, Onyx.settings.get('streamServer'), ctx.video ? { season: ctx.video.season, episode: ctx.video.episode || ctx.video.number } : null).then(function (res) {
      if (loading && loading.cancelled) return;
      if (res.external) {
        if (loading) loading.close();
        if (!Onyx.native.openExternal(res.external)) window.open(res.external, '_blank');
        return;
      }
      ctx.subsP = ctx.subsP || withTimeout(S.subtitles(ctx.type, ctx.videoId, {}), 4000, []);
      return withTimeout(ctx.subsP, res.torrent ? 300 : 1200, []).then(function (subs) {
        if (loading && loading.cancelled) return;
        if (loading) loading.handoff();
        launch(ctx, res, S.pickSubtitles(subs, ctx.prefs), startAt);
      });
    }).catch(function () {
      if (loading && loading.cancelled) return;
      start(ctx, i + 1, loading);
    });
  }

  function menuFor(ctx) {
    var m = S.menuOptions(ctx.items, ctx.prefs);
    m.current = { audio: ctx.prefs.audio, subs: ctx.prefs.subs, quality: String(ctx.prefs.quality) };
    m.deviceLang = S.deviceLang();
    m.info = S.describe(ctx.info);
    return m;
  }

  function launch(ctx, res, subs, startAt) {
    var mode = Onyx.settings.get('player');
    P.ctx = ctx;
    var prev = Onyx.progress.get(ctx.videoId);
    Onyx.progress.update({
      videoId: ctx.videoId, meta: ctx.meta, type: ctx.type,
      video: ctx.video ? { season: ctx.video.season, episode: ctx.video.episode || ctx.video.number, name: ctx.video.name || ctx.video.title, thumbnail: ctx.video.thumbnail } : null,
      stream: ctx.stream, position: startAt, duration: (prev && prev.duration) || 0
    });
    var title = ctx.meta.name || '';
    var sub = epLabel(ctx.video);
    if (mode === 'external') {
      if (ctx.loader) ctx.loader.close();
      if (!Onyx.native.openExternal(res.url, 'video/*')) window.open(res.url, '_blank');
      return;
    }
    if (Onyx.native.isAndroid()) {
      P.nativeActive = true;
      Onyx.native.play({
        url: res.url, headers: res.headers || null, title: title, subtitle: sub, subtitles: subs,
        startAt: Math.floor(startAt * 1000), videoId: ctx.videoId,
        audioLang: ctx.prefs.audio, subLang: ctx.prefs.subs, subtitlesAuto: ctx.prefs.subs !== 'off',
        deviceLang: S.deviceLang(), menu: menuFor(ctx),
        background: Onyx.bgOf(ctx.fullMeta || ctx.meta) || '', poster: ctx.meta.poster || '',
        logo: Onyx.logoOf(ctx.fullMeta || ctx.meta) || '', images: Onyx.cinematicImages(ctx.fullMeta || ctx.meta, ctx.video)
      });
      pushState();
      return;
    }
    openHtml5(res.url, title, sub, subs, startAt, ctx);
  }

  /* Changement de langue / qualité pendant la lecture : on garde la position */
  P.applyPrefs = function (ctx, changes, position, inFile) {
    var changedFile = false;
    Object.keys(changes).forEach(function (k) {
      var v = changes[k];
      if (k === 'quality' && v !== 'auto') v = Number(v);
      if (ctx.prefs[k] !== v) { ctx.prefs[k] = v; if (k !== 'subs') changedFile = true; }
    });
    // VO choisie sans sous-titres → sous-titres dans la langue de l'appareil (et inversement)
    if (changes.audio === 'vo' && ctx.prefs.subs === 'off' && !changes.subs) ctx.prefs.subs = S.deviceLang();
    if (changes.audio && changes.audio === S.deviceLang() && !changes.subs) ctx.prefs.subs = 'off';
    S.prefs.setShow(ctx.meta.id, { audio: ctx.prefs.audio, subs: ctx.prefs.subs, quality: ctx.prefs.quality });
    if (!changedFile || inFile) return false;
    var ranked = S.rank(ctx.items, ctx.prefs);
    if (S.sameStream(ranked[0].stream, ctx.stream)) {
      var msg = 'Pas d\'autre version disponible : ' + S.describe(ctx.info);
      if (P.nativeActive) Onyx.native.call('playerMessage', msg); else Onyx.toast(msg);
      return false;
    }
    ctx.ranked = ranked;
    ctx.startAt = position;
    if (P.nativeActive) Onyx.native.call('playerMessage', 'Changement : ' + S.describe(ranked[0].info) + '…');
    start(ctx, 0, null);
    return true;
  };

  function showLoading(meta, video) {
    var status = h('small.pl-status', { text: 'Recherche de la meilleure source…' });
    var api = Onyx.modal(h('div.play-loading', [
      h('div.pl-gem', { html: Onyx.gemSvg('gem-load') }),
      h('p', { text: (meta.name || 'Lecture') + (video ? '  ·  ' + epLabel(video) : '') }),
      status,
      Onyx.btn('Annuler', null, function () { api.cancelled = true; api.close(); }, 'default')
    ]), { cls: 'loading-modal', onClose: function () { api.cancelled = true; } });
    api.status = function (t) { status.textContent = t; };
    return api;
  }

  /* Événements du lecteur natif */
  Onyx.bus.on('native-player', function (d) {
    if (!d || !P.ctx || d.cancelled) return;
    if (d.videoId && d.videoId !== P.ctx.videoId) return;
    var ctx = P.ctx;
    if (d.position !== undefined && !d.failed) {
      P.nativeState = d;
      Onyx.progress.update({ videoId: ctx.videoId, position: d.position / 1000, duration: d.duration / 1000, ended: !!d.ended });
    }
    // à 85 % d'un épisode : on prépare déjà le suivant
    if (d.duration > 0 && d.position / d.duration > 0.85 && !ctx.nextWarm) {
      ctx.nextWarm = true;
      var nvw = nextVideo(ctx.fullMeta || ctx.meta, ctx.videoId);
      if (nvw) P.prewarm(ctx.fullMeta || ctx.meta, nvw);
    }
    if (d.failed) {
      // fichier illisible : on essaie automatiquement le suivant, au même endroit
      var pos = d.position > 0 ? d.position / 1000 : ctx.startAt;
      ctx.startAt = pos;
      ctx.failed = ctx.failed || {};
      if (ctx.stream) ctx.failed[S.streamKey(ctx.stream)] = true;
      // prochaine source : d'abord une qui a vraiment des partageurs
      var nx = S.nextCandidate(ctx.ranked, (ctx.tryIndex || 0) + 1, ctx.failed);
      if (nx < 0) {
        Onyx.native.call('closePlayer', 'aucune source de cet épisode n\'a de partageurs en ce moment');
        Onyx.toast('Aucune source n\'a de partageurs en ce moment. Choisis-en une manuellement ou réessaie plus tard.', 'error', 7000);
        if (Onyx.sources) Onyx.sources.open(ctx.fullMeta, ctx.video);
        return;
      }
      Onyx.native.call('playerMessage', 'Source sans partageurs, essai d\'une autre…');
      start(ctx, nx, null);
      return;
    }
    if (d['switch']) { P.applyPrefs(ctx, d['switch'], d.position / 1000, !!d.inFile); return; }
    if (d.closed) {
      P.nativeActive = false;
      if (d.error) Onyx.toast('Lecture impossible : ' + d.error, 'error', 6000);
      S.account.pushProgress(Onyx.progress.get(ctx.videoId));
      if (d.ended) afterEnded(ctx);
      pushState();
    }
  });

  function afterEnded(ctx) {
    if (!ctx || !Onyx.settings.get('autoNext')) return;
    var nv = nextVideo(ctx.fullMeta || ctx.meta, ctx.videoId);
    if (nv) {
      Onyx.toast('Épisode suivant : ' + epLabel(nv));
      setTimeout(function () { P.auto(ctx.fullMeta || ctx.meta, nv, { startAt: 0 }); }, 800);
    }
  }

  /* Fenêtre « Langue & qualité » (télécommande) */
  P.optionsModal = function (prefs, items, onApply) {
    var cur = { audio: prefs.audio, subs: prefs.subs, quality: String(prefs.quality) };
    var opts = S.menuOptions(items, prefs);
    var api;
    function section(title, key, list) {
      var track = h('div.track-h.chips', { 'data-hmode': 'visible' });
      function render() {
        track.innerHTML = '';
        list.forEach(function (o) {
          var c = h('button.chip.f' + (cur[key] === o.code ? '.active' : ''), { type: 'button', text: o.label });
          c.addEventListener('click', function () {
            cur[key] = o.code;
            if (key === 'audio' && o.code === 'vo' && cur.subs === 'off') cur.subs = S.deviceLang();
            if (key === 'audio' && o.code === S.deviceLang()) cur.subs = 'off';
            renderAll();
          });
          track.appendChild(c);
        });
      }
      track._render = render;
      return { el: h('div.opt-section', { 'data-remember': '' }, [h('h3', { text: title }), h('div.row-viewport', [track])]), render: render };
    }
    var secs = [section('Audio', 'audio', opts.audio), section('Sous-titres', 'subs', opts.subs), section('Qualité', 'quality', opts.quality)];
    function renderAll() {
      var focusedLabel = Onyx.focus.cur && Onyx.focus.cur.textContent;
      secs.forEach(function (x) { x.render(); });
      var again = Onyx.$$('.chip', api ? api.el : document).filter(function (c) { return c.textContent === focusedLabel; })[0];
      if (again) Onyx.focus.set(again, { noScroll: true });
    }
    secs.forEach(function (x) { x.render(); });
    api = Onyx.modal(h('div.dialog.wide.options', [
      h('h2', { text: 'Langue & qualité' }),
      h('p', { text: 'Onyx choisit automatiquement le fichier qui correspond. Le choix est mémorisé pour ce titre.' }),
      secs[0].el, secs[1].el, secs[2].el,
      h('div.dialog-actions', [
        Onyx.btn('Appliquer', 'check', function () {
          api.close(true);
          var changes = {};
          ['audio', 'subs', 'quality'].forEach(function (k) { if (cur[k] !== String(prefs[k])) changes[k] = cur[k]; });
          onApply(changes, cur);
        }, 'primary'),
        Onyx.btn('Annuler', null, function () { api.close(true); })
      ])
    ]));
    setTimeout(function () { var a = Onyx.$('.chip.active', api.el); if (a) Onyx.focus.set(a); }, 30);
  };

  /* ---------- Lecteur HTML5 (PC / navigateur) ---------- */
  var hideTimer, seekAcc = 0, seekTimer;
  function openHtml5(url, title, sub, subs, startAt, ctx) {
    closeHtml5(true);
    var video = h('video', { autoplay: true, playsinline: true, preload: 'auto' });
    var played = h('i.pl-played'), buffered = h('i.pl-buffered'), thumb = h('i.pl-thumb');
    var bar = h('div.pl-bar.f', [h('div.pl-rail', [buffered, played, thumb])]);
    var tCur = h('span.pl-time', { text: '0:00' }), tDur = h('span.pl-time', { text: '0:00' });
    var playBtn = h('button.pl-btn.f.default', { type: 'button', html: Onyx.icons.pause });
    var rewBtn = h('button.pl-btn.f', { type: 'button', html: Onyx.icons.rew + '<b>10</b>' });
    var fwdBtn = h('button.pl-btn.f', { type: 'button', html: Onyx.icons.fwd + '<b>10</b>' });
    var ccBtn = h('button.pl-btn.f', { type: 'button', html: Onyx.icons.cc });
    var optBtn = Onyx.btn('Langue & qualité', 'globe', null, 'ghost');
    var srcBtn = Onyx.btn('Sources', null, null, 'ghost');
    var nextBtn = Onyx.btn('Épisode suivant', 'play', null, 'ghost');
    var closeBtn = h('button.pl-btn.f', { type: 'button', html: Onyx.icons.close });
    // flèche retour en haut à gauche : quitte la lecture
    var backBtn = h('button.pl-back.f', { type: 'button', title: 'Quitter la lecture', html: Onyx.icons.back });
    backBtn.addEventListener('click', function () { closeHtml5(); });
    var spinner = h('div.pl-spinner', [Onyx.spinner()]);
    var nv = P.ctx ? nextVideo(P.ctx.fullMeta || P.ctx.meta, P.ctx.videoId) : null;
    var root = h('div#player', [
      video,
      h('div.pl-shade'),
      h('div.pl-top', [backBtn, h('div.pl-titles', [h('div.pl-title', { text: title }), sub ? h('div.pl-sub', { text: sub }) : null])]),
      spinner,
      h('div.pl-osd'),
      h('div.pl-bottom', [
        h('div.pl-progress', [tCur, bar, tDur]),
        h('div.pl-controls', [
          h('div.pl-left', [rewBtn, playBtn, fwdBtn]),
          h('div.pl-right', [subs.length ? ccBtn : null, optBtn, nv ? nextBtn : null, srcBtn, closeBtn])
        ])
      ])
    ]);
    document.body.appendChild(root);
    P.el = root; P.video = video; P.active = true;
    document.body.classList.add('playing');

    // sous-titres (SRT → VTT)
    var subIdx = -1;
    var tracks = [];
    function loadSub(i) {
      tracks.forEach(function (t) { t.mode = 'disabled'; });
      subIdx = i;
      ccBtn.classList.toggle('on', i >= 0);
      if (i < 0) { osd('Sous-titres désactivés'); return; }
      var s = subs[i];
      osd('Sous-titres : ' + s.label);
      if (tracks[i]) { tracks[i].mode = 'showing'; return; }
      fetch(s.url).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
        var txt;
        try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { txt = new TextDecoder('windows-1252').decode(buf); }
        var vtt = /^WEBVTT/.test(txt) ? txt : 'WEBVTT\n\n' + txt.replace(/\r/g, '').replace(/(\d+:\d+:\d+),(\d+)/g, '$1.$2');
        var tr = document.createElement('track');
        tr.kind = 'subtitles'; tr.label = s.label; tr.srclang = s.lang || 'xx';
        tr.src = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
        video.appendChild(tr);
        tr.track.mode = subIdx === i ? 'showing' : 'disabled';
        tracks[i] = tr.track;
      }).catch(function () { osd('Sous-titres indisponibles'); });
    }
    if (ctx.prefs.subs !== 'off') { var si = subs.findIndex(function (x) { return x.lang === ctx.prefs.subs; }); if (si >= 0) loadSub(si); }
    ccBtn.addEventListener('click', function () { loadSub(subIdx + 1 >= subs.length ? -1 : subIdx + 1); });

    video.src = url;
    video.addEventListener('loadedmetadata', function () {
      if (startAt && startAt < video.duration - 10) video.currentTime = startAt;
      tDur.textContent = Onyx.fmtTime(video.duration);
    });
    video.addEventListener('timeupdate', function () {
      var d = video.duration || 0;
      tCur.textContent = Onyx.fmtTime(video.currentTime);
      var pct = d ? video.currentTime / d * 100 : 0;
      played.style.width = pct + '%'; thumb.style.left = pct + '%';
      if (video.buffered.length) buffered.style.width = (d ? video.buffered.end(video.buffered.length - 1) / d * 100 : 0) + '%';
    });
    video.addEventListener('waiting', function () { spinner.classList.add('show'); });
    var loader = ctx.loader, started = false;
    if (loader) loader.stage(2, 'Connexion à la source', 'Connexion au serveur…', 48);
    // compteur de secondes réel tant que le serveur n'a rien envoyé
    var connT0 = Date.now(), gotData = false;
    var connTick = setInterval(function () {
      if (started || gotData || !loader || !video.isConnected) { clearInterval(connTick); return; }
      var secs = Math.floor((Date.now() - connT0) / 1000);
      loader.stage(2, 'Connexion à la source', 'Connexion au serveur… ' + secs + ' s', 48 + Math.min(secs, 10) * .8);
    }, 500);
    var bufProg = function () {
      if (video.buffered.length) gotData = true;
      if (started || !loader) return;
      var b = video.buffered.length ? video.buffered.end(video.buffered.length - 1) - video.currentTime : 0;
      loader.stage(3, 'Mise en mémoire', 'Réception de la vidéo…', 60 + Math.min(1, Math.max(0, b) / 2) * 40);
    };
    video.addEventListener('progress', bufProg);
    video.addEventListener('loadeddata', bufProg);
    video.addEventListener('playing', function () {
      spinner.classList.remove('show'); playBtn.innerHTML = Onyx.icons.pause; pushState();
      if (!started) { started = true; if (loader) loader.finish(); }
    });
    video.addEventListener('canplay', function () { spinner.classList.remove('show'); });
    video.addEventListener('pause', function () { playBtn.innerHTML = Onyx.icons.play; showControls(true); pushState(); });
    video.addEventListener('ended', function () { saveProgress(true); var c = P.ctx; closeHtml5(); afterEnded(c); });
    video.addEventListener('error', function () {
      // fichier illisible ici : on passe automatiquement au suivant, au même endroit
      var c = P.ctx, pos = video.currentTime || startAt;
      if (c && c.loader && !started) c.loader.stage(2, 'Source suivante', 'Ce fichier ne peut pas être lu ici, essai d\'une autre source…', 48);
      closeHtml5(true);
      Onyx.toast('Source illisible, essai d\'une autre…');
      c.startAt = pos;
      start(c, (c.tryIndex || 0) + 1, started ? null : c.loader);
    });
    spinner.classList.add('show');

    playBtn.addEventListener('click', togglePause);
    rewBtn.addEventListener('click', function () { seek(-10); });
    fwdBtn.addEventListener('click', function () { seek(10); });
    closeBtn.addEventListener('click', function () { closeHtml5(); });
    srcBtn.addEventListener('click', function () { var c = P.ctx; closeHtml5(); if (c && Onyx.sources) Onyx.sources.open(c.fullMeta || c.meta, c.video); });
    nextBtn.addEventListener('click', function () { var c = P.ctx; closeHtml5(); if (c && nv) P.auto(c.fullMeta || c.meta, nv, { startAt: 0 }); });
    optBtn.addEventListener('click', function () {
      P.optionsModal(ctx.prefs, ctx.items, function (changes) {
        if (changes.subs) {
          var si = subs.findIndex(function (x) { return x.lang === changes.subs; });
          loadSub(changes.subs === 'off' ? -1 : si);
          if (changes.subs !== 'off' && si < 0) osd('Pas de sous-titres ' + S.langLabel(changes.subs) + ' pour cette vidéo');
        }
        var pos = video.currentTime;
        if (P.applyPrefs(ctx, changes, pos, false)) closeHtml5(true);
      });
    });
    bar.addEventListener('click', function (e) {
      if (e.clientX && video.duration) {
        var r = bar.getBoundingClientRect();
        video.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * video.duration;
      }
    });
    bar.addEventListener('nav', function (e) {
      if (e.detail === 'left' || e.detail === 'right') { e.preventDefault(); seek(e.detail === 'left' ? -10 : 10); }
    });
    root.addEventListener('mousemove', function () { showControls(); });
    video.addEventListener('dblclick', function () { if (Onyx.native.call('toggleFullscreen') === null && root.requestFullscreen) root.requestFullscreen(); });
    video.addEventListener('click', togglePause);

    P.progressTimer = setInterval(function () { saveProgress(false); pushState(); }, 5000);
    showControls();
    Onyx.focus.set(playBtn);
  }

  function osd(text) {
    if (!P.el) return;
    var o = Onyx.$('.pl-osd', P.el);
    o.textContent = text;
    o.classList.add('show');
    clearTimeout(o._t);
    o._t = setTimeout(function () { o.classList.remove('show'); }, 1500);
  }
  function showControls(stay) {
    if (!P.el) return;
    P.el.classList.add('controls');
    clearTimeout(hideTimer);
    if (!stay) hideTimer = setTimeout(function () { if (P.video && !P.video.paused && P.el) P.el.classList.remove('controls'); }, 4000);
  }
  function controlsVisible() { return P.el && P.el.classList.contains('controls'); }
  function togglePause() {
    if (!P.video) return;
    if (P.video.paused) { P.video.play(); osd('Lecture'); } else { P.video.pause(); osd('Pause'); }
    showControls();
  }
  function seek(delta) {
    if (!P.video || !P.video.duration) return;
    seekAcc += delta;
    var target = Math.max(0, Math.min(P.video.duration - 1, P.video.currentTime + seekAcc));
    osd((seekAcc > 0 ? '+' : '') + seekAcc + ' s  ·  ' + Onyx.fmtTime(target));
    clearTimeout(seekTimer);
    seekTimer = setTimeout(function () { P.video.currentTime = target; seekAcc = 0; }, 350);
    showControls();
  }
  function saveProgress(ended) {
    if (!P.video || !P.ctx || !P.video.duration) return;
    Onyx.progress.update({ videoId: P.ctx.videoId, position: P.video.currentTime, duration: P.video.duration, ended: !!ended });
  }
  function closeHtml5(silent) {
    if (!P.el) return;
    saveProgress(false);
    if (P.ctx && !silent) S.account.pushProgress(Onyx.progress.get(P.ctx.videoId));
    clearInterval(P.progressTimer);
    try { P.video.pause(); P.video.removeAttribute('src'); P.video.load(); } catch (e) { }
    P.el.remove();
    P.el = null; P.video = null; P.active = false;
    document.body.classList.remove('playing');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () { });
    if (!silent) {
      Onyx.focus.restore(Onyx.$('#view > .view.active'));
      Onyx.bus.emit('player-closed');
    }
    pushState();
  }
  P.close = closeHtml5;

  /* Touches quand le lecteur HTML5 est actif */
  Onyx.bus.on('key', function (k) {
    if (!P.active || Onyx.$('#modals > .modal')) return;
    var a = k.action;
    k.handled.stop = true;
    if (a === 'back') { if (controlsVisible() && !P.video.paused) P.el.classList.remove('controls'); else closeHtml5(); return; }
    if (a === 'playpause' || a === 'play' || a === 'pause') { togglePause(); return; }
    if (a === 'ff') { seek(30); return; }
    if (a === 'rw') { seek(-30); return; }
    if (a === 'stop') { closeHtml5(); return; }
    if (!controlsVisible()) {
      if (a === 'left') { seek(-10); return; }
      if (a === 'right') { seek(10); return; }
      if (a === 'ok') { togglePause(); return; }
      showControls();
      Onyx.focus.set(Onyx.$('.pl-btn.default', P.el));
      return;
    }
    showControls();
    k.handled.stop = false; // navigation normale entre les boutons
  });

  /* Commandes de la télécommande téléphone */
  P.command = function (cmd) {
    if (P.nativeActive) return false; // géré côté natif
    if (!P.active) return false;
    if (cmd.action === 'playpause') togglePause();
    else if (cmd.action === 'pause') { P.video.pause(); }
    else if (cmd.action === 'resume') { P.video.play(); }
    else if (cmd.action === 'seek') seek(cmd.delta || 10);
    else if (cmd.action === 'seekTo' && P.video) { P.video.currentTime = cmd.position || 0; }
    else if (cmd.action === 'stop') closeHtml5();
    else return false;
    return true;
  };

  P.state = function () {
    if (!P.ctx || (!P.active && !P.nativeActive)) return null;
    var c = P.ctx;
    var s = { title: c.meta.name, subtitle: epLabel(c.video), poster: c.meta.poster || '', background: Onyx.bgOf(c.meta) || '', type: c.type, id: c.meta.id, videoId: c.videoId };
    if (P.active && P.video) { s.position = P.video.currentTime; s.duration = P.video.duration || 0; s.paused = P.video.paused; }
    else if (P.nativeState) { s.position = P.nativeState.position / 1000; s.duration = P.nativeState.duration / 1000; s.paused = !!P.nativeState.paused; }
    return s;
  };
  function pushState() { if (Onyx.app && Onyx.app.pushState) Onyx.app.pushState(); }
})();
