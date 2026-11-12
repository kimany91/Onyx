/* Onyx — Films / Séries (catalogues + genres, grille infinie) */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h, S = Onyx.Stremio;

  var GENRES_FR = {
    Action: 'Action', Adventure: 'Aventure', Animation: 'Animation', Biography: 'Biographie', Comedy: 'Comédie', Crime: 'Policier',
    Documentary: 'Documentaire', Drama: 'Drame', Family: 'Famille', Fantasy: 'Fantastique', History: 'Histoire', Horror: 'Horreur',
    Mystery: 'Mystère', Romance: 'Romance', 'Sci-Fi': 'Science-fiction', Sport: 'Sport', Thriller: 'Thriller', War: 'Guerre',
    Western: 'Western', Music: 'Musique', Musical: 'Comédie musicale', 'Reality-TV': 'Téléréalité', 'Talk-Show': 'Talk-show', 'Game-Show': 'Jeu TV', News: 'Actualités'
  };
  Onyx.genreFr = function (g) { return GENRES_FR[g] || g; };

  Onyx.views.catalog = function (params) {
    var type = params.type;
    var title = type === 'movie' ? 'Films' : 'Séries';
    var cats = S.homeCatalogs(type);
    var state = { cat: cats[0] || null, genre: null, skip: 0, loading: false, done: false, token: 0 };

    var catChips = h('div.track-h.chips', { 'data-hmode': 'visible' });
    var genreChips = h('div.track-h.chips', { 'data-hmode': 'visible' });
    var grid = h('div.track-v.grid', { 'data-vmode': 'visible' });
    var el = h('div.view.catalog', [
      h('header.page-head', [h('h1', { text: title })]),
      h('div.chip-row', { 'data-remember': '' }, [h('div.row-viewport', [catChips])]),
      h('div.chip-row.genres', { 'data-remember': '' }, [h('div.row-viewport', [genreChips])]),
      h('div.grid-viewport', [grid])
    ]);

    function chip(label, active, fn) {
      var c = h('button.chip.f' + (active ? '.active' : ''), { type: 'button', text: label });
      c.addEventListener('click', fn);
      return c;
    }
    function renderCats() {
      catChips.innerHTML = '';
      cats.forEach(function (c) {
        var label = Onyx.catalogTitle(c).replace(/^(Films|Séries)\s/, '').replace(/ · (Films|Séries)$/, '');
        label = label.charAt(0).toUpperCase() + label.slice(1);
        var b = chip(label, c === state.cat, function () {
          if (state.cat === c) return;
          state.cat = c; state.genre = null;
          renderCats(); renderGenres(); reload();
        });
        catChips.appendChild(b);
      });
    }
    function renderGenres() {
      genreChips.innerHTML = '';
      var genres = state.cat ? S.genresOf(state.cat.def) : [];
      genreChips.parentElement.parentElement.style.display = genres.length ? '' : 'none';
      if (!genres.length) return;
      genreChips.appendChild(chip('Tous', !state.genre, function () { if (state.genre) { state.genre = null; renderGenres(); reload(); } }));
      genres.forEach(function (g) {
        genreChips.appendChild(chip(Onyx.genreFr(g), state.genre === g, function () {
          if (state.genre === g) return;
          state.genre = g; renderGenres(); reload();
        }));
      });
    }
    function reload() {
      state.skip = 0; state.done = false; state.token++;
      grid.innerHTML = '';
      Onyx.focus.resetTrack(grid);
      for (var i = 0; i < 16; i++) grid.appendChild(h('div.card.skeleton'));
      loadMore(true);
    }
    function loadMore(first) {
      if (!state.cat || state.loading || state.done) return;
      state.loading = true;
      var tok = state.token;
      var extra = {};
      if (state.genre) extra.genre = state.genre;
      if (state.skip) extra.skip = state.skip;
      S.catalog(state.cat.addon, state.cat.type, state.cat.id, extra).then(function (metas) {
        if (tok !== state.token) return;
        state.loading = false;
        if (first) grid.innerHTML = '';
        var seen = {};
        Onyx.$$('.card', grid).forEach(function (c) { seen[c.dataset.id] = 1; });
        var added = 0;
        metas.forEach(function (m) {
          if (seen[m.id]) return;
          m.type = m.type || type;
          grid.appendChild(Onyx.card(m, { onFocus: onFocus }));
          added++;
        });
        state.skip += metas.length;
        if (!metas.length || !added || !S.catalogSupports(state.cat.def, 'skip')) state.done = true;
        if (first && !grid.children.length) grid.appendChild(Onyx.empty('Rien ici', 'Ce catalogue est vide pour le moment.'));
      }).catch(function () {
        if (tok !== state.token) return;
        state.loading = false; state.done = true;
        if (first) { grid.innerHTML = ''; grid.appendChild(Onyx.empty('Catalogue indisponible', 'L\'addon ne répond pas. Réessaie plus tard.')); }
      });
    }
    var bgSet = Onyx.debounce(function (m) { Onyx.backdrop.set(Onyx.bgOf(m), 'dim'); }, 350);
    function onFocus(meta, card) {
      bgSet(meta);
      var cards = grid.children, idx = Array.prototype.indexOf.call(cards, card);
      if (idx > cards.length - 18) loadMore(false);
    }

    if (!cats.length) {
      el.appendChild(Onyx.empty('Aucun catalogue de ' + title.toLowerCase(), 'Installe un addon qui fournit des catalogues.', [Onyx.btn('Gérer les addons', 'addons', function () { Onyx.app.go('addons'); }, 'primary')]));
    } else {
      renderCats(); renderGenres(); reload();
    }

    return {
      el: el,
      onShow: function () { Onyx.backdrop.set(null, 'dim'); },
      focusDefault: function () { return Onyx.$('.card.f', grid) || Onyx.$('.chip.active', catChips); }
    };
  };
})();
