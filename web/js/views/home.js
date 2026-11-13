/* Onyx — Accueil (style « billboard » + rangées) */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h, S = Onyx.Stremio;
  Onyx.views = Onyx.views || {};

  var NAMES = { popular: 'populaires', 'new': 'récents', featured: 'à la une', top: 'populaires', trending: 'tendances' };
  Onyx.catalogTitle = function (cat) {
    var typeLabel = cat.type === 'movie' ? 'Films' : cat.type === 'series' ? 'Séries' : cat.type === 'anime' ? 'Animes' : cat.type === 'channel' ? 'Chaînes' : cat.type === 'tv' ? 'TV' : cat.type;
    var key = String(cat.name || '').toLowerCase();
    if (NAMES[key] && /cinemeta/i.test(cat.addon.manifest.name)) return typeLabel + ' ' + NAMES[key];
    return cat.name + ' · ' + typeLabel;
  };

  Onyx.views.home = function () {
    var heroMeta = null;
    var heroTitle = h('div.hero-title');
    var heroLine = h('div.hero-line');
    var heroDesc = h('p.hero-desc');
    var listBtn = Onyx.btn('Ma liste', 'plus', function () {
      if (!heroMeta) return;
      var added = Onyx.library.toggle(heroMeta);
      Onyx.toast(added ? 'Ajouté à Ma liste' : 'Retiré de Ma liste');
      updateListBtn();
    });
    var actions = h('div.hero-actions', { 'data-remember': '' }, [
      Onyx.btn('Lecture', 'play', function () { if (heroMeta) Onyx.app.go('detail', { type: heroMeta.type, id: heroMeta.id, preview: heroMeta, autoplay: true }); }, 'primary default'),
      Onyx.btn('Plus d\'infos', 'info', function () { if (heroMeta) Onyx.openMeta(heroMeta); }),
      listBtn
    ]);
    var hero = h('div.hero', [heroTitle, heroLine, heroDesc, actions]);
    var track = h('div.track-v.rows', { 'data-vmode': 'top' });
    var rowsVp = h('div.rows-viewport', [track]);
    var el = h('div.view.home', [hero, rowsVp]);

    function updateListBtn() {
      var inList = heroMeta && Onyx.library.has(heroMeta.id);
      listBtn.innerHTML = (inList ? Onyx.icons.check : Onyx.icons.plus) + '<span>Ma liste</span>';
    }

    var setHeroNow = function (meta) {
      if (!meta) return;
      heroMeta = meta;
      heroTitle.innerHTML = '';
      heroTitle.appendChild(Onyx.titleEl(meta));
      heroLine.innerHTML = '';
      heroLine.appendChild(Onyx.metaLine(meta));
      heroDesc.textContent = meta.description || '';
      Onyx.backdrop.set(Onyx.bgOf(meta), 'home');
      updateListBtn();
      hero.classList.remove('swap'); void hero.offsetWidth; hero.classList.add('swap');
    };
    var setHero = Onyx.debounce(setHeroNow, 220);

    function onCardFocus(meta) { setHero(meta); }

    /* Rangées dynamiques (reprise / ma liste) */
    var contRow = null, listRow = null;
    function buildContinue() {
      var items = Onyx.progress.continueList();
      var row = null;
      if (items.length) {
        row = Onyx.row('Reprendre la lecture', { cls: 'continue' });
        items.forEach(function (e) {
          var label = e.video ? 'S' + e.video.season + ':E' + e.video.episode : '';
          var img = (e.video && e.video.thumbnail) || Onyx.bgOf(e.meta);
          row.track.appendChild(Onyx.card(e.meta, {
            landscape: true, image: img, progress: e.duration ? e.position / e.duration : 0, label: label || e.meta.name,
            onFocus: onCardFocus,
            onSelect: function (m) { Onyx.app.go('detail', { type: m.type, id: m.id, preview: m }); }
          }));
        });
      }
      if (contRow) { if (row) contRow.replaceWith(row); else contRow.remove(); }
      else if (row) track.insertBefore(row, track.firstChild);
      contRow = row;
    }
    function buildList() {
      var items = Onyx.library.all();
      var row = null;
      if (items.length) {
        row = Onyx.row('Ma liste');
        items.slice(0, 40).forEach(function (m) { row.track.appendChild(Onyx.card(m, { onFocus: onCardFocus })); });
      }
      var anchor = contRow ? contRow.nextSibling : track.firstChild;
      if (listRow) { if (row) listRow.replaceWith(row); else listRow.remove(); }
      else if (row) track.insertBefore(row, anchor);
      listRow = row;
    }

    function buildCatalogs() {
      var cats = S.homeCatalogs().filter(function (c) { return c.type === 'movie' || c.type === 'series' || c.type === 'anime' || c.type === 'tv' || c.type === 'channel'; });
      // ordre : Au cinéma, 2 catalogues populaires, Classiques, Disney, Marvel, puis le reste
      var specs = [];
      var special = (Onyx.Collections && Onyx.Collections.homeRows) || [];
      if (special[0]) specs.push({ title: special[0].title, load: special[0].load });
      cats.slice(0, 2).forEach(function (cat) { specs.push(catSpec(cat)); });
      special.slice(1).forEach(function (r) { specs.push({ title: r.title, load: r.load }); });
      cats.slice(2, 18).forEach(function (cat) { specs.push(catSpec(cat)); });
      if (!cats.length && !special.length) {
        track.appendChild(Onyx.empty('Aucun catalogue', 'Ajoute des addons Stremio pour remplir ton accueil.', [Onyx.btn('Gérer les addons', 'addons', function () { Onyx.app.go('addons'); }, 'primary')]));
        return;
      }
      var first = true;
      specs.forEach(function (spec) {
        var row = Onyx.row(spec.title);
        Onyx.skeletonRow(9).forEach(function (s) { row.track.appendChild(s); });
        track.appendChild(row);
        spec.load().then(function (metas) {
          row.track.innerHTML = '';
          if (!metas.length) { row.remove(); return; }
          metas.slice(0, 40).forEach(function (m) {
            m.type = m.type || spec.type || 'movie';
            row.track.appendChild(Onyx.card(m, { onFocus: onCardFocus }));
          });
          if (first && !heroMeta) {
            first = false;
            setHeroNow(metas[Math.floor(Math.random() * Math.min(6, metas.length))]);
            if (!Onyx.focus.cur || !Onyx.focus.cur.isConnected || Onyx.focus.cur.closest('.skeleton')) {
              if (el.classList.contains('active') && !document.body.classList.contains('in-sidebar')) Onyx.focus.set(Onyx.$('.btn.default', actions));
            }
          }
        }).catch(function () { row.remove(); });
      });
    }
    function catSpec(cat) {
      return { title: Onyx.catalogTitle(cat), type: cat.type, load: function () { return S.catalog(cat.addon, cat.type, cat.id); } };
    }

    buildContinue();
    buildList();
    buildCatalogs();

    var dirty = false;
    var markDirty = function () { dirty = true; };
    Onyx.bus.on('progress', markDirty);
    Onyx.bus.on('library', markDirty);
    var addonsChanged = function () {
      track.innerHTML = ''; contRow = null; listRow = null; heroMeta = null;
      buildContinue(); buildList(); buildCatalogs();
    };
    Onyx.bus.on('addons-changed', addonsChanged);

    // focus sur les boutons : rails remis en haut
    var onFocusBus = function (f) {
      if (!el.isConnected) return;
      el.classList.toggle('at-top', actions.contains(f));
      if (actions.contains(f)) { Onyx.focus.resetTrack(track); Onyx.$$('.active-row', track).forEach(function (r) { r.classList.remove('active-row'); }); }
    };
    Onyx.bus.on('focus', onFocusBus);

    return {
      el: el,
      onShow: function () {
        if (heroMeta) Onyx.backdrop.set(Onyx.bgOf(heroMeta), 'home');
        if (dirty) { dirty = false; buildContinue(); buildList(); updateListBtn(); }
      },
      focusDefault: function () { return Onyx.$('.btn.default', actions); },
      destroy: function () {
        Onyx.bus.off('progress', markDirty); Onyx.bus.off('library', markDirty); Onyx.bus.off('addons-changed', addonsChanged); Onyx.bus.off('focus', onFocusBus);
      }
    };
  };
})();
