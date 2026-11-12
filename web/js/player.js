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

  function subLangMatch(lang, pref) {
    lang = (lang || '').toLowerCase();
    var map = { fr: ['fr', 'fre', 'fra', 'french'], en: ['en', 'eng', 'english'] };
    return (map[pref] || [pref]).indexOf(lang) >= 0;
  }

  /* ctx: {meta, fullMeta, type, videoId, video, stream} */
  P.play = function (ctx) {
    var mode = Onyx.settings.get('player');
    var loading = showLoading(ctx);
    var prog = Onyx.progress.get(ctx.videoId);
    var startAt = 0;
    if (prog && !prog.watched && prog.position > 20) startAt = prog.position;
    if (ctx.startAt !== undefined) startAt = ctx.startAt;

    S.resolve(ctx.stream, Onyx.settings.get('streamServer')).then(function (res) {
      if (res.external) {
        loading.close();
        if (!Onyx.native.openExternal(res.external)) window.open(res.external, '_blank');
        return;
      }
      var pref = Onyx.settings.get('subLang');
      var subsP = pref === 'off' ? Promise.resolve([]) : withTimeout(S.subtitles(ctx.type, ctx.videoId, {}), 5000, []);
      return subsP.then(function (subs) {
        subs = (subs || []).filter(function (s) { return s && s.url; });
        var preferred = subs.filter(function (s) { return subLangMatch(s.lang, pref); });
        var others = subs.filter(function (s) { return !subLangMatch(s.lang, pref) && subLangMatch(s.lang, 'en'); });
        var list = preferred.slice(0, 6).concat(others.slice(0, 2)).map(function (s, i) {
          return { url: s.url, lang: s.lang, label: (s.lang || '?').toUpperCase() + ' ' + (i + 1) };
        });
        loading.close();
        P.ctx = ctx;
        Onyx.progress.update({
          videoId: ctx.videoId, meta: Onyx.preview(ctx.meta), type: ctx.type, video: ctx.video ? { season: ctx.video.season, episode: ctx.video.episode || ctx.video.number, name: ctx.video.name || ctx.video.title, thumbnail: ctx.video.thumbnail } : null,
          stream: ctx.stream, position: startAt, duration: (prog && prog.duration) || 0
        });
        var title = ctx.meta.name || '';
        var sub = epLabel(ctx.video);
        // pas de sous-titres automatiques si la source est déjà dans la langue préférée
        var autoSubs = !(pref === 'fr' && S.streamInfo(ctx.stream).fr);
        if (mode === 'external') {
          if (!Onyx.native.openExternal(res.url, 'video/*')) window.open(res.url, '_blank');
          return;
        }
        if (Onyx.native.isAndroid()) {
          P.nativeActive = true;
          Onyx.native.play({
            url: res.url, headers: res.headers || null, title: title, subtitle: sub, subtitles: list,
            startAt: Math.floor(startAt * 1000), videoId: ctx.videoId, subLang: pref,
            audioLang: Onyx.settings.get('streamLang'), subtitlesAuto: autoSubs,
            poster: ctx.meta.poster || '', background: Onyx.bgOf(ctx.meta) || ''
          });
          pushState();
          return;
        }
        openHtml5(res.url, title, sub, list, startAt, autoSubs);
      });
    }).catch(function (e) {
      loading.close();
      Onyx.toast(e.message || 'Lecture impossible', 'error', 5000);
    });
  };

  function showLoading(ctx) {
    var api = Onyx.modal(h('div.play-loading', [
      h('div.pl-gem', { html: Onyx.gemSvg('gem-load') }),
      h('p', { text: 'Préparation de ' + (ctx.meta.name || 'la lecture') + '…' }),
      Onyx.btn('Annuler', null, function () { api.close(); }, 'default')
    ]), { cls: 'loading-modal' });
    return api;
  }

  /* Événements du lecteur natif */
  Onyx.bus.on('native-player', function (d) {
    if (!d || !P.ctx) return;
    if (d.videoId && d.videoId !== P.ctx.videoId) return;
    if (d.position !== undefined) {
      P.nativeState = d;
      Onyx.progress.update({ videoId: P.ctx.videoId, position: d.position / 1000, duration: d.duration / 1000, ended: !!d.ended });
    }
    if (d.closed) {
      P.nativeActive = false;
      var ctx = P.ctx;
      if (d.error) Onyx.toast('Lecture impossible : ' + d.error + '. Essaie une autre source.', 'error', 6000);
      if (d.ended) afterEnded(ctx);
      pushState();
    }
  });

  function afterEnded(ctx) {
    if (!ctx || !Onyx.settings.get('autoNext')) return;
    var nv = nextVideo(ctx.fullMeta || ctx.meta, ctx.videoId);
    if (nv && Onyx.sources) {
      Onyx.toast('À suivre : ' + epLabel(nv));
      setTimeout(function () { Onyx.sources.open(ctx.fullMeta || ctx.meta, nv); }, 600);
    }
  }

  /* ---------- Lecteur HTML5 (PC / navigateur) ---------- */
  var hideTimer, seekAcc = 0, seekTimer;
  function openHtml5(url, title, sub, subs, startAt, autoSubs) {
    closeHtml5(true);
    var video = h('video', { autoplay: true, playsinline: true, preload: 'auto' });
    var played = h('i.pl-played'), buffered = h('i.pl-buffered'), thumb = h('i.pl-thumb');
    var bar = h('div.pl-bar.f', [h('div.pl-rail', [buffered, played, thumb])]);
    var tCur = h('span.pl-time', { text: '0:00' }), tDur = h('span.pl-time', { text: '0:00' });
    var playBtn = h('button.pl-btn.f.default', { type: 'button', html: Onyx.icons.pause });
    var rewBtn = h('button.pl-btn.f', { type: 'button', html: Onyx.icons.rew + '<b>10</b>' });
    var fwdBtn = h('button.pl-btn.f', { type: 'button', html: Onyx.icons.fwd + '<b>10</b>' });
    var ccBtn = h('button.pl-btn.f', { type: 'button', html: Onyx.icons.cc });
    var srcBtn = Onyx.btn('Sources', null, null, 'ghost');
    var nextBtn = Onyx.btn('Épisode suivant', 'play', null, 'ghost');
    var closeBtn = h('button.pl-btn.f', { type: 'button', html: Onyx.icons.close });
    var spinner = h('div.pl-spinner', [Onyx.spinner()]);
    var nv = P.ctx ? nextVideo(P.ctx.fullMeta || P.ctx.meta, P.ctx.videoId) : null;
    var root = h('div#player', [
      video,
      h('div.pl-shade'),
      h('div.pl-top', [h('div.pl-title', { text: title }), sub ? h('div.pl-sub', { text: sub }) : null]),
      spinner,
      h('div.pl-osd'),
      h('div.pl-bottom', [
        h('div.pl-progress', [tCur, bar, tDur]),
        h('div.pl-controls', [
          h('div.pl-left', [rewBtn, playBtn, fwdBtn]),
          h('div.pl-right', [subs.length ? ccBtn : null, nv ? nextBtn : null, srcBtn, closeBtn])
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
    if (autoSubs && subs.length && Onyx.settings.get('subLang') !== 'off' && subLangMatch(subs[0].lang, Onyx.settings.get('subLang'))) loadSub(0);
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
    video.addEventListener('playing', function () { spinner.classList.remove('show'); playBtn.innerHTML = Onyx.icons.pause; pushState(); });
    video.addEventListener('canplay', function () { spinner.classList.remove('show'); });
    video.addEventListener('pause', function () { playBtn.innerHTML = Onyx.icons.play; showControls(true); pushState(); });
    video.addEventListener('ended', function () { saveProgress(true); var c = P.ctx; closeHtml5(); afterEnded(c); });
    video.addEventListener('error', function () {
      var c = P.ctx;
      closeHtml5();
      Onyx.toast('Ce format ne peut pas être lu par le lecteur intégré. Essaie une autre source ou le lecteur externe.', 'error', 6000);
      if (c && Onyx.sources) Onyx.sources.open(c.fullMeta || c.meta, c.video);
    });
    spinner.classList.add('show');

    playBtn.addEventListener('click', togglePause);
    rewBtn.addEventListener('click', function () { seek(-10); });
    fwdBtn.addEventListener('click', function () { seek(10); });
    closeBtn.addEventListener('click', function () { closeHtml5(); });
    srcBtn.addEventListener('click', function () { var c = P.ctx; closeHtml5(); if (c && Onyx.sources) Onyx.sources.open(c.fullMeta || c.meta, c.video); });
    nextBtn.addEventListener('click', function () { var c = P.ctx; closeHtml5(); if (c && nv && Onyx.sources) Onyx.sources.open(c.fullMeta || c.meta, nv); });
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
