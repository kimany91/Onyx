/* Onyx — Catégories (comme sur Netflix) : grille de genres + page d'un genre */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h;

  /* Grille de vignettes colorées */
  Onyx.genreGrid = function () {
    var grid = h('div.genre-grid', { 'data-remember': '' });
    Onyx.Collections.GENRES.forEach(function (g) {
      var t = h('button.genre-tile.f', { type: 'button', style: { background: 'linear-gradient(135deg, ' + g.color + ' 0%, rgba(0,0,0,.55) 140%)' } }, [h('span', { text: g.label })]);
      t.addEventListener('click', function () { Onyx.app.go('genre', { genre: g.id }); });
      grid.appendChild(t);
    });
    return grid;
  };

  Onyx.views.categories = function () {
    var track = h('div.track-v', { 'data-vmode': 'visible' }, [Onyx.genreGrid()]);
    var el = h('div.view.categories', [
      h('header.page-head', [h('h1', { text: 'Catégories' }), h('p.page-sub', { text: 'Films et séries par genre.' })]),
      h('div.list-viewport.cat-vp', [track])
    ]);
    return { el: el, onShow: function () { Onyx.backdrop.set(null, 'plain'); } };
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
