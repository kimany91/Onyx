/* Onyx — Recherche (clavier virtuel + résultats) */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h, S = Onyx.Stremio;

  Onyx.views.search = function (params) {
    var query = (params && params.query) || '';
    var display = h('div.search-query');
    var results = h('div.track-v.rows', { 'data-vmode': 'top' });
    var kb = Onyx.keyboard({ value: query, symbols: false, onChange: function (v) { query = v; show(); run(); } });
    var el = h('div.view.search', [
      h('div.search-left', [h('div.search-box', [h('span.search-ico', { html: Onyx.icons.search }), display]), kb,
        h('p.search-hint', { html: Onyx.icons.phone + '<span>Tu peux aussi chercher depuis ton téléphone.</span>' })]),
      h('div.search-right', [h('div.rows-viewport', [results])])
    ]);

    function show() {
      display.textContent = query;
      if (!query) display.innerHTML = '<span class="placeholder">Titre de film ou de série…</span>';
      display.appendChild(h('i.caret'));
    }
    var token = 0;
    var run = Onyx.debounce(function () {
      var q = query.trim();
      var my = ++token;
      results.innerHTML = '';
      Onyx.focus.resetTrack(results);
      if (q.length < 2) { results.appendChild(suggestions()); return; }
      results.appendChild(h('div.search-loading', [Onyx.spinner()]));
      S.search(q).then(function (groups) {
        if (my !== token) return;
        results.innerHTML = '';
        if (!groups.length) { results.appendChild(Onyx.empty('Aucun résultat', 'Aucun titre trouvé pour « ' + q + ' ».')); return; }
        groups.forEach(function (g) {
          var row = Onyx.row(Onyx.catalogTitle(g.cat).replace(/^(Films|Séries) populaires$/, '$1'));
          g.metas.slice(0, 30).forEach(function (m) { m.type = m.type || g.cat.type; row.track.appendChild(Onyx.card(m, { onFocus: bg })); });
          results.appendChild(row);
        });
      });
    }, 550);
    var bg = Onyx.debounce(function (m) { Onyx.backdrop.set(Onyx.bgOf(m), 'dim'); }, 400);

    function suggestions() {
      var box = h('div.search-empty');
      box.appendChild(Onyx.empty('Recherche', 'Tape un titre avec le clavier, la télécommande ou ton téléphone.'));
      return box;
    }

    show();
    if (query) run(); else results.appendChild(suggestions());

    return {
      el: el,
      onShow: function () { Onyx.backdrop.set(null, 'dim'); },
      setQuery: function (q) { query = q || ''; kb.setValue(query); show(); run(); },
      focusDefault: function () { return Onyx.$('.kb-key[data-k="a"]', kb) || Onyx.$('.kb-key', kb); }
    };
  };
})();
