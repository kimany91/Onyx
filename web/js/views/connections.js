/* Onyx — Connexions (QR code pour relier le téléphone) */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h;

  var REMOTE_APK = 'https://github.com/kimany91/Onyx/releases/latest/download/onyx-remote.apk';

  Onyx.qrSvg = function (text, size) {
    if (!window.qrcode) return '';
    var qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount(), cells = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) cells += 'M' + c + ' ' + r + 'h1v1h-1z';
    return '<svg viewBox="-2 -2 ' + (n + 4) + ' ' + (n + 4) + '" class="qr" shape-rendering="crispEdges"' + (size ? ' width="' + size + '"' : '') + '>' +
      '<rect x="-2" y="-2" width="' + (n + 4) + '" height="' + (n + 4) + '" fill="#fff"/><path d="' + cells + '" fill="#000"/></svg>';
  };

  function ago(t) {
    var s = Math.round((Date.now() - t) / 1000);
    if (s < 15) return 'connecté';
    if (s < 60) return 'il y a ' + s + ' s';
    if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
    return 'il y a ' + Math.round(s / 3600) + ' h';
  }

  Onyx.views.connections = function () {
    var qrBox = h('div.qr-box');
    var urlBox = h('div.qr-url');
    var devBox = h('div.devices');
    var steps = h('ol.steps', [
      h('li', [h('b', { text: 'Installe Onyx Remote' }), ' sur ton téléphone Android (scanne le QR de droite pour le télécharger).']),
      h('li', [h('b', { text: 'Ouvre Onyx Remote' }), ' et appuie sur « Scanner le QR code de la TV ».']),
      h('li', [h('b', { text: 'Scanne ce code' }), ' : ton téléphone devient une télécommande et tu peux lancer un film directement.'])
    ]);
    var resetBtn = Onyx.btn('Nouveau code (déconnecte tout)', 'sync', function () {
      Onyx.confirm('Générer un nouveau code ?', 'Les téléphones déjà connectés devront scanner le nouveau QR code.', 'Générer').then(function (ok) {
        if (ok) { Onyx.native.resetToken(); render(); Onyx.toast('Nouveau code généré'); }
      });
    }, 'default');
    var el = h('div.view.connections', [
      h('header.page-head', [h('h1', { text: 'Connexions' }), h('p.page-sub', { text: 'Contrôle Onyx depuis ton téléphone : télécommande, recherche et lecture à distance.' })]),
      h('div.conn-grid', [
        h('div.conn-card.main', [h('div.conn-qr', [qrBox, urlBox]), h('div.conn-side', [h('h2', { text: 'Connecter mon téléphone' }), steps, h('div.conn-actions', { 'data-remember': '' }, [resetBtn])])]),
        h('div.conn-card.small', [h('h3', { text: 'App Onyx Remote' }), h('div.qr-box.mini', { html: Onyx.qrSvg(REMOTE_APK) }), h('p', { text: 'Scanne pour télécharger l\'APK téléphone' })]),
        h('div.conn-card.devs', [h('h3', { text: 'Appareils connectés' }), devBox])
      ])
    ]);

    function render() {
      var info = Onyx.native.server();
      if (!info || !info.url) {
        qrBox.innerHTML = '';
        qrBox.appendChild(h('div.qr-off', { html: Onyx.icons.link + '<p>Le serveur de connexion n\'est disponible que dans l\'app TV ou la version Windows.</p>' }));
        urlBox.textContent = '';
        resetBtn.classList.add('disabled');
        return;
      }
      qrBox.innerHTML = Onyx.qrSvg(info.pairUrl);
      urlBox.innerHTML = '<span>' + Onyx.esc(info.url) + '</span><small>Code : ' + Onyx.esc(info.token) + '</small>';
      if (!info.ip || info.ip === '127.0.0.1') urlBox.appendChild(h('p.warn', { text: 'La TV ne semble pas connectée au réseau local (Wi-Fi / Ethernet).' }));
      renderDevices();
    }
    function renderDevices() {
      var devs = Onyx.native.devices() || [];
      devBox.innerHTML = '';
      if (!devs.length) { devBox.appendChild(h('p.muted', { text: 'Aucun téléphone connecté pour le moment.' })); return; }
      devs.sort(function (a, b) { return b.lastSeen - a.lastSeen; }).forEach(function (d) {
        var on = Date.now() - d.lastSeen < 15000;
        devBox.appendChild(h('div.device' + (on ? '.on' : ''), [h('span.dot'), h('span.dev-name', { text: d.name || 'Téléphone' }), h('small', { text: ago(d.lastSeen) })]));
      });
    }
    render();
    var timer = setInterval(function () { if (el.isConnected) renderDevices(); }, 4000);
    var onDev = function () { if (el.isConnected) renderDevices(); };
    Onyx.bus.on('remote', onDev);
    return {
      el: el,
      onShow: function () { Onyx.backdrop.set(null, 'plain'); render(); },
      destroy: function () { clearInterval(timer); Onyx.bus.off('remote', onDev); }
    };
  };
})();
