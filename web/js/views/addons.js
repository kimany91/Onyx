/* Onyx — Gestion des addons Stremio */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h, S = Onyx.Stremio;

  function typesLabel(m) {
    var map = { movie: 'Films', series: 'Séries', channel: 'Chaînes', tv: 'TV', anime: 'Animes', other: 'Autres' };
    return (m.types || []).map(function (t) { return map[t] || t; }).join(' · ');
  }
  function resLabel(m) {
    var map = { catalog: 'Catalogues', meta: 'Fiches', stream: 'Sources', subtitles: 'Sous-titres', addon_catalog: 'Addons' };
    return (m.resources || []).map(function (r) { var n = typeof r === 'string' ? r : r.name; return map[n] || n; }).join(' · ');
  }
  Onyx.addonLogo = function (m) {
    var box = h('div.addon-logo');
    if (m.logo) {
      var img = h('img', { src: m.logo, alt: '', loading: 'lazy' });
      img.onerror = function () { img.remove(); box.textContent = (m.name || '?').charAt(0); };
      box.appendChild(img);
    } else box.textContent = (m.name || '?').charAt(0);
    return box;
  };

  Onyx.installAddon = function (url) {
    Onyx.toast('Installation de l\'addon…');
    return S.install(url).then(function (m) {
      Onyx.toast('Addon « ' + m.name + ' » installé', 'ok');
      Onyx.bus.emit('addons-changed');
      return m;
    }).catch(function (e) {
      Onyx.toast('Impossible d\'installer cet addon (' + e.message + ')', 'error', 5000);
      throw e;
    });
  };

  Onyx.views.addons = function () {
    var track = h('div.track-v.addon-list', { 'data-vmode': 'visible' });
    var head = h('div.addon-toolbar', { 'data-remember': '' }, [
      Onyx.btn('Ajouter par URL', 'plus', addByUrl, 'primary default'),
      Onyx.btn('Catalogue d\'addons', 'globe', function () { openCatalog('official'); }),
      Onyx.btn('Communauté', 'addons', function () { openCatalog('community'); }),
      Onyx.btn('Synchroniser Stremio', 'sync', syncAccount)
    ]);
    var el = h('div.view.addons', [
      h('header.page-head', [h('h1', { text: 'Addons' }), h('p.page-sub', { text: 'Les mêmes addons que Stremio : catalogues, fiches, sources et sous-titres.' })]),
      head,
      h('div.list-viewport', [track])
    ]);

    function render() {
      var keepUrl = Onyx.focus.cur && Onyx.focus.cur.dataset && Onyx.focus.cur.dataset.url;
      track.innerHTML = '';
      S.addons.forEach(function (a, i) {
        var m = a.manifest;
        var row = h('div.addon-row', { 'data-remember': '' }, [
          Onyx.addonLogo(m),
          h('div.addon-info', [
            h('div.addon-name', [h('span', { text: m.name }), h('small', { text: 'v' + (m.version || '?') })]),
            h('div.addon-desc', { text: m.description || '' }),
            h('div.addon-tags', { text: [resLabel(m), typesLabel(m)].filter(Boolean).join('  —  ') })
          ]),
          h('div.addon-actions', [
            iconBtn('up', 'Monter', i === 0, function () { S.move(a.transportUrl, -1); changed(); }),
            iconBtn('down', 'Descendre', i === S.addons.length - 1, function () { S.move(a.transportUrl, 1); changed(); }),
            iconBtn('trash', 'Supprimer', false, function () {
              Onyx.confirm('Supprimer « ' + m.name + ' » ?', 'Tu pourras le réinstaller plus tard.', 'Supprimer').then(function (ok) {
                if (ok) { S.remove(a.transportUrl); changed(); Onyx.toast('Addon supprimé'); }
              });
            })
          ])
        ]);
        Onyx.$$('.f', row).forEach(function (b) { b.dataset.url = a.transportUrl + '|' + b.dataset.act; });
        track.appendChild(row);
      });
      if (!S.addons.length) track.appendChild(Onyx.empty('Aucun addon', 'Ajoute un addon par URL ou synchronise ton compte Stremio.'));
      if (keepUrl) {
        var again = Onyx.$$('.f', track).filter(function (b) { return b.dataset.url === keepUrl; })[0];
        if (again && !again.classList.contains('disabled')) Onyx.focus.set(again);
        else Onyx.focus.restore(el);
      }
    }
    function iconBtn(icon, label, disabled, fn) {
      var b = h('button.icon-btn.f' + (disabled ? '.disabled' : ''), { type: 'button', title: label, html: Onyx.icons[icon] + '<span>' + label + '</span>' });
      b.dataset.act = icon;
      b.addEventListener('click', fn);
      return b;
    }
    function changed() { render(); Onyx.bus.emit('addons-changed'); }

    function addByUrl() {
      Onyx.prompt('Ajouter un addon', { placeholder: 'https://…/manifest.json', text: 'Saisis l\'URL du manifest de l\'addon (comme dans Stremio).' }).then(function (url) {
        if (url) Onyx.installAddon(url).then(render, function () { });
      });
    }

    function syncAccount() {
      if (!S.account.get()) {
        Onyx.confirm('Compte Stremio', 'Connecte d\'abord ton compte Stremio dans Paramètres (ou depuis l\'app téléphone).', 'Ouvrir les paramètres').then(function (ok) { if (ok) Onyx.app.go('settings'); });
        return;
      }
      Onyx.toast('Synchronisation…');
      S.account.pullAddons().then(function (list) {
        Onyx.toast(list.length + ' addons synchronisés depuis Stremio', 'ok');
        changed();
      }).catch(function (e) { Onyx.toast(e.message, 'error'); });
    }

    function openCatalog(which) {
      var list = h('div.track-v.catalog-list', { 'data-vmode': 'visible' });
      var api = Onyx.modal(h('div.dialog.wide', [
        h('h2', { text: which === 'official' ? 'Addons officiels' : 'Addons de la communauté' }),
        h('div.catalog-vp', [list])
      ]));
      list.appendChild(Onyx.spinner());
      var featuredP = which === 'official' ? S.featuredAddons() : Promise.resolve([]);
      Promise.all([featuredP, S.addonCatalog(which).catch(function () { return []; })]).then(function (res) {
        var featured = res[0], addons = res[1];
        var urls = featured.map(function (f) { return f.transportUrl; });
        addons = addons.filter(function (a) { return urls.indexOf(a.transportUrl) < 0; });
        list.innerHTML = '';
        if (featured.length) list.appendChild(h('h3.catalog-section', { text: 'Recommandés' }));
        featured.concat(featured.length && addons.length ? [{ sep: true }] : [], addons).forEach(function (a) {
          if (a.sep) { list.appendChild(h('h3.catalog-section', { text: 'Tous les addons' })); return; }
          var m = a.manifest || {};
          var installed = S.isInstalled(a.transportUrl);
          var b = Onyx.btn(installed ? 'Installé' : 'Installer', installed ? 'check' : 'plus', function () {
            if (S.isInstalled(a.transportUrl)) return;
            Onyx.installAddon(a.transportUrl).then(function () {
              b.innerHTML = Onyx.icons.check + '<span>Installé</span>';
              render();
            }, function () { });
          }, installed ? 'ghost' : '');
          list.appendChild(h('div.addon-row.compact', { 'data-remember': '' }, [
            Onyx.addonLogo(m),
            h('div.addon-info', [h('div.addon-name', [h('span', { text: m.name || a.transportUrl })]), h('div.addon-desc', { text: a.note || m.description || '' }), h('div.addon-tags', { text: [resLabel(m), typesLabel(m)].filter(Boolean).join('  —  ') })]),
            h('div.addon-actions', [b])
          ]));
        });
        if (!addons.length) list.appendChild(Onyx.empty('Catalogue vide'));
        Onyx.focus.restore(api.el);
      }).catch(function () { list.innerHTML = ''; list.appendChild(Onyx.empty('Catalogue indisponible', 'Vérifie la connexion internet.')); });
    }

    render();
    var onChange = function () { if (el.isConnected) render(); };
    Onyx.bus.on('addons-changed-remote', onChange);
    return {
      el: el,
      onShow: function () { Onyx.backdrop.set(null, 'plain'); render(); },
      destroy: function () { Onyx.bus.off('addons-changed-remote', onChange); }
    };
  };
})();
