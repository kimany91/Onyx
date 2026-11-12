/* Onyx — Paramètres */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h, S = Onyx.Stremio, set = Onyx.settings;

  Onyx.stremioLogin = function (email, password) {
    Onyx.toast('Connexion à Stremio…');
    return S.account.login(email, password).then(function (auth) {
      Onyx.toast('Connecté : ' + auth.email, 'ok');
      return S.account.pullAddons().then(function (list) {
        Onyx.toast(list.length + ' addons récupérés depuis ton compte', 'ok');
        Onyx.bus.emit('addons-changed');
        S.account.pullProgress().then(function (e) { if (e.length) Onyx.progress.mergeAll(e); });
        return S.account.pullLibrary().then(function (items) {
          Onyx.library.addMany(items.map(function (x) { return { id: x._id, type: x.type, name: x.name, poster: x.poster }; }));
        }).catch(function () { });
      });
    }).catch(function (e) {
      Onyx.toast('Connexion impossible : ' + e.message, 'error', 5000);
      throw e;
    });
  };

  Onyx.views.settings = function () {
    var list = h('div.track-v.settings-list', { 'data-vmode': 'visible' });
    var el = h('div.view.settings', [
      h('header.page-head', [h('h1', { text: 'Paramètres' })]),
      h('div.list-viewport', [list])
    ]);

    function section(title) { list.appendChild(h('h3.set-section', { text: title })); }
    function row(label, value, fn, opts) {
      opts = opts || {};
      var b = h('button.set-row.f', { type: 'button' }, [
        h('span.set-ico', { html: Onyx.icons[opts.icon || 'gear'] }),
        h('span.set-label', [h('b', { text: label }), opts.help ? h('small', { text: opts.help }) : null]),
        value !== null && value !== undefined ? h('span.set-value', { text: value }) : null
      ]);
      b.dataset.key = label;
      b.addEventListener('click', fn);
      list.appendChild(b);
      return b;
    }
    function choice(label, key, options, opts) {
      var cur = set.get(key);
      var curLabel = (options.filter(function (o) { return o.value === cur; })[0] || {}).label || cur;
      row(label, curLabel, function () {
        Onyx.choose(label, options, set.get(key)).then(function (v) {
          if (v !== undefined) { set.set(key, v); render(); }
        });
      }, opts);
    }

    function render() {
      var keep = Onyx.focus.cur && list.contains(Onyx.focus.cur) ? Onyx.focus.cur.dataset.key : null;
      list.innerHTML = '';
      var plat = Onyx.native.platform();

      section('Compte Stremio');
      var auth = S.account.get();
      if (auth) {
        row('Connecté', auth.email, function () { }, { icon: 'check', help: 'Tes addons Stremio sont utilisés par Onyx.' });
        row('Synchroniser les addons', null, function () {
          Onyx.toast('Synchronisation…');
          S.account.pullAddons().then(function (l) { Onyx.toast(l.length + ' addons synchronisés', 'ok'); Onyx.bus.emit('addons-changed'); }).catch(function (e) { Onyx.toast(e.message, 'error'); });
        }, { icon: 'sync', help: 'Récupère les addons installés sur ton compte Stremio.' });
        row('Importer ma bibliothèque Stremio', null, function () {
          S.account.pullLibrary().then(function (items) {
            Onyx.library.addMany(items.map(function (x) { return { id: x._id, type: x.type, name: x.name, poster: x.poster }; }));
            Onyx.toast(items.length + ' titres ajoutés à Ma liste', 'ok');
          }).catch(function (e) { Onyx.toast(e.message, 'error'); });
        }, { icon: 'list' });
        row('Se déconnecter', null, function () {
          Onyx.confirm('Se déconnecter de Stremio ?', 'Tes addons restent installés dans Onyx.', 'Déconnexion').then(function (ok) { if (ok) { S.account.logout(); render(); } });
        }, { icon: 'power' });
      } else {
        row('Se connecter à Stremio', null, function () {
          Onyx.prompt('Adresse e-mail Stremio', { placeholder: 'email@exemple.com' }).then(function (email) {
            if (!email) return;
            Onyx.prompt('Mot de passe Stremio', { password: true }).then(function (pw) {
              if (!pw) return;
              Onyx.stremioLogin(email.trim(), pw).then(render, function () { });
            });
          });
        }, { icon: 'link', help: 'Récupère automatiquement tous tes addons Stremio. Plus simple depuis l\'app téléphone.' });
      }

      section('Lecture');
      var gp = S.prefs.global(), opts = S.menuOptions(null, gp);
      function prefChoice(label, key, list, icon, help) {
        var cur = String(gp[key]);
        var curLabel = (list.filter(function (o) { return o.code === cur; })[0] || {}).label || cur;
        row(label, curLabel, function () {
          Onyx.choose(label, list.map(function (o) { return { value: o.code, label: o.label }; }), cur).then(function (v) {
            if (v === undefined) return;
            var o = {}; o[key] = key === 'quality' && v !== 'auto' ? Number(v) : v;
            S.prefs.setGlobal(o); render();
          });
        }, { icon: icon, help: help });
      }
      prefChoice('Langue audio par défaut', 'audio', opts.audio, 'globe', 'Onyx choisit tout seul le fichier dans cette langue. Modifiable pour chaque titre.');
      prefChoice('Sous-titres par défaut', 'subs', opts.subs, 'cc');
      prefChoice('Qualité par défaut', 'quality', opts.quality, 'movie', 'Le fichier le plus proche de cette qualité est choisi automatiquement.');
      var players = [{ value: 'internal', label: plat === 'android-tv' ? 'Lecteur Onyx (ExoPlayer, recommandé)' : 'Lecteur Onyx intégré' }];
      players.push({ value: 'external', label: plat === 'desktop' ? 'VLC / lecteur externe' : 'Lecteur externe (VLC, MX Player…)' });
      choice('Lecteur vidéo', 'player', players, { icon: 'play' });
      choice('Épisode suivant automatique', 'autoNext', [{ value: true, label: 'Activé' }, { value: false, label: 'Désactivé' }], { icon: 'fwd' });
      row('Serveur de streaming (torrents)', set.get('streamServer'), function () {
        Onyx.prompt('Serveur de streaming Stremio', { value: set.get('streamServer'), text: 'Nécessaire pour les sources torrent : l\'app Stremio (ou son serveur) doit tourner sur cet appareil ou sur ton réseau.' }).then(function (v) {
          if (v) { set.set('streamServer', v.trim().replace(/\/+$/, '')); render(); }
        });
      }, { icon: 'link', help: 'Par défaut http://127.0.0.1:11470' });

      section('Application');
      choice('Animation de démarrage', 'splash', [{ value: true, label: 'Activée' }, { value: false, label: 'Désactivée' }], { icon: 'star' });
      row('Nom de la TV', set.get('tvName'), function () {
        Onyx.prompt('Nom affiché sur le téléphone', { value: set.get('tvName'), symbols: false }).then(function (v) {
          if (v) { set.set('tvName', v.trim()); Onyx.app.pushState(); render(); }
        });
      }, { icon: 'tv' });
      var upd = Onyx.app.updateStatus;
      row('Mises à jour', 'Version ' + Onyx.native.version() + (upd ? '  ·  ' + upd : ''), function () {
        if (!Onyx.native.available) { Onyx.toast('Mises à jour gérées par l\'app TV / Windows'); return; }
        Onyx.toast('Recherche de mises à jour…');
        Onyx.native.checkUpdate(true);
      }, { icon: 'sync', help: 'Onyx se met à jour automatiquement au démarrage.' });
      row('Vider le cache et l\'historique', null, function () {
        Onyx.confirm('Effacer l\'historique de lecture ?', 'La progression « Reprendre la lecture » sera supprimée. Ma liste et les addons sont conservés.', 'Effacer').then(function (ok) {
          if (ok) { Onyx.store.set('progress', {}); Onyx.bus.emit('progress', null); Onyx.toast('Historique effacé'); }
        });
      }, { icon: 'trash' });
      row('Réinitialiser Onyx', null, function () {
        Onyx.confirm('Tout réinitialiser ?', 'Addons, Ma liste, historique et compte seront effacés.', 'Réinitialiser').then(function (ok) {
          if (ok) { try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('onyx.') === 0) localStorage.removeItem(k); }); } catch (e) { } location.reload(); }
        });
      }, { icon: 'power' });
      if (plat === 'android-tv' || plat === 'desktop') row('Quitter Onyx', null, function () { Onyx.native.exit(); }, { icon: 'close' });

      list.appendChild(h('div.about', { html: Onyx.gemSvg('gem-about') + Onyx.wordmark() + '<p>Onyx ' + Onyx.esc(Onyx.native.version()) + ' — client Stremio pour TV.<br>Onyx n\'héberge aucun contenu : tout provient des addons que tu installes.</p>' }));

      if (keep) {
        var again = Onyx.$$('.set-row', list).filter(function (b) { return b.dataset.key === keep; })[0];
        if (again) Onyx.focus.set(again, { instant: true });
      }
    }
    render();
    var onUpd = function () { if (el.isConnected) render(); };
    Onyx.bus.on('update', onUpd);
    return {
      el: el,
      onShow: function () { Onyx.backdrop.set(null, 'plain'); render(); },
      destroy: function () { Onyx.bus.off('update', onUpd); }
    };
  };
})();
