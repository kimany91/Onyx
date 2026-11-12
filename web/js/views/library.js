/* Onyx — Ma liste */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h;

  Onyx.views.library = function () {
    var track = h('div.track-v.rows', { 'data-vmode': 'top' });
    var el = h('div.view.library', [h('header.page-head', [h('h1', { text: 'Ma liste' })]), h('div.rows-viewport.full', [track])]);
    var bg = Onyx.debounce(function (m) { Onyx.backdrop.set(Onyx.bgOf(m), 'dim'); }, 350);

    function render() {
      track.innerHTML = '';
      Onyx.focus.resetTrack(track);
      var cont = Onyx.progress.continueList();
      if (cont.length) {
        var r = Onyx.row('Reprendre la lecture', { cls: 'continue' });
        cont.forEach(function (e) {
          r.track.appendChild(Onyx.card(e.meta, {
            landscape: true, image: (e.video && e.video.thumbnail) || Onyx.bgOf(e.meta),
            progress: e.duration ? e.position / e.duration : 0,
            label: e.video ? 'S' + e.video.season + ':E' + e.video.episode : e.meta.name, onFocus: bg
          }));
        });
        track.appendChild(r);
      }
      var lib = Onyx.library.all();
      var groups = [['movie', 'Films'], ['series', 'Séries']];
      groups.forEach(function (g) {
        var items = lib.filter(function (m) { return m.type === g[0]; });
        if (!items.length) return;
        var r = Onyx.row(g[1] + ' (' + items.length + ')');
        items.forEach(function (m) { r.track.appendChild(Onyx.card(m, { onFocus: bg })); });
        track.appendChild(r);
      });
      var others = lib.filter(function (m) { return m.type !== 'movie' && m.type !== 'series'; });
      if (others.length) {
        var ro = Onyx.row('Autres');
        others.forEach(function (m) { ro.track.appendChild(Onyx.card(m, { onFocus: bg })); });
        track.appendChild(ro);
      }
      if (!track.children.length) {
        track.appendChild(Onyx.empty('Ta liste est vide', 'Ajoute des films et des séries avec le bouton « Ma liste » pour les retrouver ici.', [
          Onyx.btn('Découvrir', 'home', function () { Onyx.app.go('home'); }, 'primary default')
        ]));
      }
    }
    render();
    var dirty = false, mark = function () { dirty = true; };
    Onyx.bus.on('library', mark); Onyx.bus.on('progress', mark);
    return {
      el: el,
      onShow: function () { Onyx.backdrop.set(null, 'dim'); if (dirty) { dirty = false; render(); } },
      destroy: function () { Onyx.bus.off('library', mark); Onyx.bus.off('progress', mark); }
    };
  };
})();
