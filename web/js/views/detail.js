/* Onyx — Fiche détaillée + choix des sources */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h, S = Onyx.Stremio;

  /* ---------- Fenêtre « Sources » ---------- */
  Onyx.sources = {
    open: function (meta, video) {
      var type = meta.type;
      var videoId = video ? video.id : (meta.behaviorHints && meta.behaviorHints.defaultVideoId) || meta.id;
      var prefs = S.prefs.forShow(meta.id);
      var list = h('div.track-v.sources-list', { 'data-vmode': 'visible' });
      var head = h('div.sources-head', [
        h('div.sources-kicker', { text: 'Choix manuel de la source' }),
        h('h2', { text: meta.name || '' }),
        video ? h('div.sources-ep', { text: Onyx.player.epLabel(video) }) : null
      ]);
      var panel = h('div.sources', [head, h('div.sources-vp', [list])]);
      var api = Onyx.modal(panel, { cls: 'side' });
      var addons = S.streamAddons(type, videoId);
      var total = 0, pending = addons.length;

      if (!addons.length) {
        list.appendChild(h('div.sources-none', [
          h('h3', { text: 'Aucun addon de sources' }),
          h('p', { text: 'Pour regarder, ajoute un addon Stremio qui fournit des sources (streams) depuis Addons, ou connecte ton compte Stremio dans Paramètres pour récupérer les tiens.' }),
          Onyx.btn('Gérer les addons', 'addons', function () { api.close(); Onyx.app.go('addons'); }, 'primary default')
        ]));
        return;
      }

      var groups = addons.map(function (a) {
        var g = h('div.source-group', [h('div.source-group-title', [h('span', { text: a.manifest.name }), h('span.mini-spin')])]);
        list.appendChild(g);
        return g;
      });

      S.streams(type, videoId, function (res) {
        if (!api.el.isConnected) return;
        var idx = addons.indexOf(res.addon);
        var g = groups[idx];
        pending--;
        var spin = Onyx.$('.mini-spin', g);
        if (spin) spin.remove();
        var items = res.streams.map(function (s, i) { return { addon: res.addon, stream: s, info: S.streamInfo(s), addonIndex: idx, index: i }; });
        items = S.rank(items, prefs);
        if (!items.length) {
          g.appendChild(h('div.source-empty', { text: res.error ? 'L\'addon ne répond pas' : 'Aucune source' }));
        }
        items.forEach(function (it) { g.appendChild(sourceItem(it)); });
        total += items.length;
        var cur = Onyx.focus.cur;
        if (items.length && (!cur || !list.contains(cur))) {
          Onyx.focus.set(Onyx.$('.source.f', list));
        }
        if (!pending && !total) {
          list.appendChild(h('div.sources-none', [h('h3', { text: 'Aucune source trouvée' }), h('p', { text: 'Aucun de tes addons ne propose ce titre pour le moment.' })]));
        }
      });

      function sourceItem(it) {
        var info = it.info;
        var badges = [];
        if (info.cached) badges.push(h('span.badge.hot', { text: '⚡ Instantané' }));
        info.badges.forEach(function (b) { badges.push(h('span.badge', { text: b })); });
        if (info.size) badges.push(h('span.badge.dim', { text: info.size }));
        if (info.kind === 'torrent') badges.push(h('span.badge.dim', { text: 'Torrent' }));
        if (info.kind === 'youtube' || info.kind === 'external') badges.push(h('span.badge.dim', { text: 'Externe' }));
        var lang = info.multi ? 'Multi-langues (VF + VO)' : info.vostfr ? 'VO sous-titrée' : info.langs.length ? info.langs.map(S.langLabel).join(' / ') : 'Version originale';
        var file = (info.title.split('\n').filter(Boolean)[0] || '').replace(/^[^\w\[]+/, '');
        var el = h('button.source.f', { type: 'button' }, [
          h('div.source-q', [h('b', { text: info.quality || 'HD' })]),
          h('div.source-body', [
            h('div.source-title', { text: lang }),
            badges.length ? h('div.source-badges', badges) : null,
            file ? h('div.source-file', { text: file }) : null
          ])
        ]);
        el.addEventListener('click', function () {
          api.close(true);
          Onyx.player.play({ meta: Onyx.preview(meta), fullMeta: meta, type: type, videoId: videoId, video: video || null, stream: it.stream });
        });
        return el;
      }
    }
  };

  /* ---------- Vue détail ---------- */
  Onyx.views.detail = function (params) {
    var meta = params.preview || { id: params.id, type: params.type, name: '' };
    meta.type = meta.type || params.type;
    var full = null;

    var titleBox = h('div.detail-title');
    var lineBox = h('div.detail-line');
    var desc = h('p.detail-desc');
    var credits = h('div.detail-credits');
    var actions = h('div.detail-actions', { 'data-remember': '' });
    var seasonsChips = h('div.track-h.chips', { 'data-hmode': 'visible' });
    var epTrack = h('div.track-h.episodes', { 'data-hmode': 'visible' });
    var epSection = h('section.detail-episodes', { style: { display: 'none' } }, [
      h('div.chip-row', { 'data-remember': '' }, [h('div.row-viewport', [seasonsChips])]),
      h('div.row.ep-row', { 'data-remember': '' }, [h('div.row-viewport', [epTrack])])
    ]);
    var prefLine = h('div.detail-prefs');
    var top = h('div.detail-top', [titleBox, lineBox, desc, credits, actions, prefLine]);
    var track = h('div.track-v', { 'data-vmode': 'visible' }, [top, epSection]);
    var el = h('div.view.detail', [h('div.detail-vp', [track])]);
    var season = null;

    function fill(m) {
      titleBox.innerHTML = ''; titleBox.appendChild(Onyx.titleEl(m, 'big'));
      lineBox.innerHTML = ''; lineBox.appendChild(Onyx.metaLine(m));
      desc.textContent = m.description || '';
      credits.innerHTML = '';
      var cast = m.cast || [], dir = m.director || [];
      if (!cast.length && m.links) cast = m.links.filter(function (l) { return l.category === 'Cast'; }).map(function (l) { return l.name; });
      if (!dir.length && m.links) dir = m.links.filter(function (l) { return l.category === 'Directors'; }).map(function (l) { return l.name; });
      if (cast.length) credits.appendChild(h('div', [h('span.k', { text: 'Avec : ' }), cast.slice(0, 5).join(', ')]));
      if (dir && dir.length) credits.appendChild(h('div', [h('span.k', { text: 'Réalisation : ' }), [].concat(dir).slice(0, 3).join(', ')]));
      Onyx.backdrop.set(Onyx.bgOf(m), 'detail');
      if (Onyx.ambient) Onyx.ambient.meta(m);
    }

    function videosOf(m) {
      return (m.videos || []).slice().sort(function (a, b) { return ((a.season || 0) - (b.season || 0)) || ((a.episode || a.number || 0) - (b.episode || b.number || 0)); });
    }
    function seasonsOf(m) {
      var s = {};
      videosOf(m).forEach(function (v) { s[v.season || 0] = 1; });
      var arr = Object.keys(s).map(Number).sort(function (a, b) { return a - b; });
      if (arr.length > 1 && arr[0] === 0) arr.push(arr.shift()); // spéciaux à la fin
      return arr;
    }
    function targetEpisode(m) {
      var vids = videosOf(m).filter(function (v) { return v.season !== 0; });
      if (!vids.length) vids = videosOf(m);
      var last = Onyx.progress.lastForMeta(m.id);
      if (last) {
        var i = vids.findIndex(function (v) { return v.id === last.videoId; });
        if (i >= 0) return last.watched && vids[i + 1] ? vids[i + 1] : vids[i];
      }
      var now = Date.now();
      var aired = vids.filter(function (v) { return !v.released || new Date(v.released).getTime() < now; });
      return aired[0] || vids[0] || null;
    }

    function prefsSummary(m) {
      var p = S.prefs.forShow(m.id);
      return 'Audio : ' + S.langLabel(p.audio).replace(' (VO)', '') + '   ·   Sous-titres : ' + (p.subs === 'off' ? 'non' : S.langLabel(p.subs)) + '   ·   Qualité : ' + S.qualityLabel(p.quality);
    }

    function buildActions(m) {
      actions.innerHTML = '';
      var isSeries = (m.videos || []).length > 0 && m.type !== 'movie';
      var last = Onyx.progress.lastForMeta(m.id);
      var target = isSeries ? targetEpisode(m) : null;
      var resume = last && !last.watched && last.position > 20 && (!isSeries || !target || target.id === last.videoId);
      var label;
      if (resume) label = 'Reprendre' + (last.video ? ' S' + last.video.season + ':E' + last.video.episode : '') + ' · ' + Onyx.fmtTime(last.position);
      else label = isSeries && target ? 'Lecture S' + target.season + ':E' + (target.episode || target.number) : 'Lecture';
      actions.appendChild(Onyx.btn(label, 'play', function () {
        Onyx.player.auto(m, isSeries ? target : null, {});
      }, 'primary default'));
      var lb = Onyx.btn('Ma liste', Onyx.library.has(m.id) ? 'check' : 'plus', function () {
        var added = Onyx.library.toggle(m);
        lb.innerHTML = (added ? Onyx.icons.check : Onyx.icons.plus) + '<span>Ma liste</span>';
        Onyx.toast(added ? 'Ajouté à Ma liste' : 'Retiré de Ma liste');
      });
      actions.appendChild(lb);
      actions.appendChild(Onyx.btn('Langue & qualité', 'globe', function () {
        Onyx.player.optionsModal(S.prefs.forShow(m.id), null, function (changes, cur) {
          S.prefs.setShow(m.id, { audio: cur.audio, subs: cur.subs, quality: cur.quality === 'auto' ? 'auto' : Number(cur.quality) });
          prefLine.textContent = prefsSummary(m);
          Onyx.toast('Préférences enregistrées pour ce titre', 'ok');
        });
      }));
      if (isSeries) actions.appendChild(Onyx.btn('Épisodes', 'list', function () {
        var c = Onyx.$('.ep-card.current', epTrack) || Onyx.$('.ep-card', epTrack);
        if (c) Onyx.focus.set(c);
      }));
      var trailer = (m.trailerStreams && m.trailerStreams[0]) || (m.trailers && m.trailers[0] && { ytId: m.trailers[0].source });
      if (trailer && trailer.ytId) {
        actions.appendChild(Onyx.btn('Bande-annonce', 'movie', function () {
          var url = 'https://www.youtube.com/watch?v=' + trailer.ytId;
          if (!Onyx.native.openExternal(url)) window.open(url, '_blank');
        }));
      }
      actions.appendChild(Onyx.btn('Sources', 'list', function () { Onyx.sources.open(m, isSeries ? target : null); }, 'ghost'));
      prefLine.textContent = prefsSummary(m);
    }

    function buildSeasons(m) {
      var ss = seasonsOf(m);
      if (!ss.length || m.type === 'movie') { epSection.style.display = 'none'; return; }
      epSection.style.display = '';
      var t = targetEpisode(m);
      season = t ? (t.season || 0) : ss[0];
      function render() {
        seasonsChips.innerHTML = '';
        ss.forEach(function (s) {
          var c = h('button.chip.f' + (s === season ? '.active' : ''), { type: 'button', text: s === 0 ? 'Bonus' : 'Saison ' + s });
          c.addEventListener('click', function () { if (season !== s) { season = s; render(); renderEpisodes(m); } });
          seasonsChips.appendChild(c);
        });
      }
      render();
      renderEpisodes(m);
    }
    function renderEpisodes(m) {
      epTrack.innerHTML = '';
      Onyx.focus.resetTrack(epTrack);
      var t = targetEpisode(m);
      var all = Onyx.progress.all();
      videosOf(m).filter(function (v) { return (v.season || 0) === season; }).forEach(function (v) {
        var p = all[v.id];
        var num = v.episode || v.number;
        var future = v.released && new Date(v.released).getTime() > Date.now();
        var card = h('button.ep-card.f' + (t && t.id === v.id ? '.current' : ''), { type: 'button' }, [
          h('div.ep-thumb', [
            v.thumbnail ? h('img', { src: v.thumbnail, loading: 'lazy', alt: '', onerror: function () { this.remove(); } }) : null,
            p && p.duration ? h('div.card-progress', [h('i', { style: { width: Math.min(100, Math.round(p.position / p.duration * 100)) + '%' } })]) : null,
            p && p.watched ? h('div.ep-watched', { html: Onyx.icons.check }) : null,
            h('div.ep-play', { html: Onyx.icons.play })
          ]),
          h('div.ep-title', { text: (num ? num + '. ' : '') + (v.name || v.title || 'Épisode ' + num) }),
          h('div.ep-desc', { text: future ? 'Sortie le ' + new Date(v.released).toLocaleDateString('fr-FR') : (v.overview || v.description || '') })
        ]);
        card.addEventListener('click', function () { Onyx.player.auto(full || m, v, {}); });
        epTrack.appendChild(card);
      });
    }

    fill(meta);
    actions.appendChild(Onyx.btn('Chargement…', null, null, 'primary default'));

    var loaded = S.meta(meta.type, meta.id).then(function (m) {
      full = m;
      m.type = m.type || meta.type;
      fill(m);
      var hadFocus = Onyx.focus.cur && el.contains(Onyx.focus.cur);
      buildActions(m);
      buildSeasons(m);
      if (hadFocus || !Onyx.focus.cur || !Onyx.focus.cur.isConnected) {
        if (el.classList.contains('active') && !Onyx.$('#modals > .modal')) Onyx.focus.set(Onyx.$('.btn.default', actions));
      }
      var isSer = (m.videos || []).length > 0 && m.type !== 'movie';
      if (!params.autoplay) Onyx.player.prewarm(m, isSer ? targetEpisode(m) : null);
      if (params.autoplay) {
        var isSeries = (m.videos || []).length > 0 && m.type !== 'movie';
        Onyx.player.auto(m, isSeries ? targetEpisode(m) : null, {});
      }
      return m;
    }).catch(function () {
      full = meta;
      actions.innerHTML = '';
      buildActions(meta);
      if (el.classList.contains('active')) Onyx.focus.set(Onyx.$('.btn.default', actions));
      if (params.autoplay) Onyx.player.auto(meta, null, {});
    });

    var onProgress = Onyx.debounce(function () { if (full) { buildActions(full); if (full.videos && full.videos.length && season !== null) renderEpisodes(full); } }, 300);
    Onyx.bus.on('progress', onProgress);

    return {
      el: el,
      loaded: loaded,
      onShow: function () { Onyx.backdrop.set(Onyx.bgOf(full || meta), 'detail'); },
      focusDefault: function () { return Onyx.$('.btn.default', actions); },
      destroy: function () { Onyx.bus.off('progress', onProgress); }
    };
  };
})();
