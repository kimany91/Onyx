/* Onyx — Catégories (comme sur Netflix) : grille de genres + page d'un genre */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h;

  /* Carte de catégorie : verre sombre + icône 3D en métal poli.
     Elle tourne quand la carte est sélectionnée et s'arrête quand on la quitte. */
  Onyx.genreCard = function (g, onOpen) {
    var still = h('img.g3d-still', { alt: '' });
    var box = h('div.g3d-box', [h('span.g3d-flat', { html: Onyx.genreIcon(g.id) }), still]);
    var card = h('button.genre-card.f', { type: 'button' }, [
      h('div.genre-card-bg'), box, h('span.genre-card-label', { text: g.label }), h('i.genre-card-shine')
    ]);
    card.style.setProperty('--gc', g.color);
    card._genre = g;
    card.addEventListener('click', function () { (onOpen || function () { Onyx.app.go('home'); setTimeout(function () { Onyx.bus.emit('home-genre', g.id); }, 60); })(g); });
    var G = Onyx.Genre3D;
    if (G && G.supported) {
      var px = function () { return Math.round(Math.max(box.clientWidth, 96) * Math.min(2, window.devicePixelRatio || 1)); };
      card.addEventListener('focus', function () { G.attach(box, g.id, g.color, px()); });
      card.addEventListener('unfocus', function () { G.detach(); });
      card._loadStill = function () {
        var src = G.thumb(g.id, g.color, px());
        if (src) { still.onload = function () { box.classList.add('ready'); }; still.src = src; }
      };
    }
    return card;
  };

  /* Les images 3D apparaissent une à une, sans bloquer l'interface */
  function loadStills(holder, cards) {
    var i = 0;
    (function next() {
      if (i >= cards.length) return;
      if (!holder.isConnected || !holder.offsetParent) { setTimeout(next, 250); return; }
      var c = cards[i++];
      if (c._loadStill) c._loadStill();
      setTimeout(next, 30);
    })();
  }

  /* Grille de catégories (recherche) */
  Onyx.genreGrid = function () {
    var grid = h('div.genre-grid', { 'data-remember': '' });
    var cards = Onyx.Collections.GENRES.map(function (g) { var c = Onyx.genreCard(g); grid.appendChild(c); return c; });
    loadStills(grid, cards);
    return grid;
  };

  /* Barre de catégories de l'accueil : la « maison » (menu principal) puis chaque catégorie.
     opts.onFocus(genre | null) quand la télécommande passe dessus, opts.onPick(genre | null) à la validation. */
  Onyx.genreRow = function (opts) {
    opts = opts || {};
    var row = Onyx.row('Catégories', { cls: 'genre-row' });
    var home = h('button.genre-card.home-chip.f.picked', { type: 'button', 'aria-label': 'Accueil' }, [
      h('div.genre-card-bg'), h('span.home-chip-ico', { html: Onyx.icons.home }), h('i.genre-card-shine')
    ]);
    home.style.setProperty('--gc', '#9aa3b5');
    home.addEventListener('focus', function () { if (opts.onFocus) opts.onFocus(null); });
    home.addEventListener('click', function () { if (opts.onPick) opts.onPick(null); });
    row.track.appendChild(home);
    var cards = Onyx.Collections.GENRES.map(function (g) {
      var c = Onyx.genreCard(g, function () { if (opts.onPick) opts.onPick(g); });
      c.addEventListener('focus', function () { if (opts.onFocus) opts.onFocus(g); });
      row.track.appendChild(c);
      return c;
    });
    loadStills(row, cards);
    return row;
  };

  Onyx.views.genre = function (params) {
    var g = params.genre;
    var track = h('div.track-v.rows', { 'data-vmode': 'top' });
    var el = h('div.view.library.genre-view', [h('header.page-head', [h('h1', { text: Onyx.genreFr(g) })]), h('div.rows-viewport.full', [track])]);
    var bg = Onyx.debounce(function (m) { Onyx.backdrop.set(Onyx.bgOf(m), 'dim'); }, 350);
    for (var i = 0; i < 2; i++) { var sk = Onyx.row(' '); Onyx.skeletonRow(9).forEach(function (s) { sk.track.appendChild(s); }); track.appendChild(sk); }
    Onyx.Collections.genre(g).then(function (rows) {
      track.innerHTML = '';
      Onyx.focus.resetTrack(track);
      rows.forEach(function (r) {
        var row = Onyx.row(r.title);
        r.metas.slice(0, 40).forEach(function (m) { row.track.appendChild(Onyx.card(m, { onFocus: bg })); });
        track.appendChild(row);
      });
      if (!rows.length) track.appendChild(Onyx.empty('Rien pour le moment', 'Aucun titre dans cette catégorie.'));
      if (el.classList.contains('active') && (!Onyx.focus.cur || !Onyx.focus.cur.isConnected)) Onyx.focus.restore(el);
    });
    return {
      el: el,
      onShow: function () { Onyx.backdrop.set(null, 'dim'); },
      focusDefault: function () { return Onyx.$('.card.f', track); }
    };
  };
})();
