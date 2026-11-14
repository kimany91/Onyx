/* Onyx — utilitaires partagés */
(function () {
  'use strict';
  var Onyx = window.Onyx = window.Onyx || {};

  Onyx.$ = function (sel, root) { return (root || document).querySelector(sel); };
  Onyx.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* Création d'éléments : h('div.card.f', {onclick: fn, data: {id: 1}}, [enfants]) */
  Onyx.h = function (spec, attrs, children) {
    var parts = spec.split('.');
    var tag = parts[0] || 'div', id = null;
    if (tag.indexOf('#') >= 0) { id = tag.slice(tag.indexOf('#') + 1); tag = tag.slice(0, tag.indexOf('#')) || 'div'; }
    var el = document.createElement(tag);
    if (id) el.id = id;
    if (parts.length > 1) el.className = parts.slice(1).join(' ');
    if (attrs && (Array.isArray(attrs) || typeof attrs === 'string' || attrs instanceof Node)) { children = attrs; attrs = null; }
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (s) { el.style[s] = v[s]; });
        else if (k === 'data') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
        else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'cls') el.className += ' ' + v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    if (children !== undefined && children !== null) append(el, children);
    return el;
  };
  function append(el, c) {
    if (Array.isArray(c)) c.forEach(function (x) { append(el, x); });
    else if (c instanceof Node) el.appendChild(c);
    else if (c !== false && c !== null && c !== undefined) el.appendChild(document.createTextNode(String(c)));
  }

  Onyx.esc = function (s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* Stockage persistant */
  Onyx.store = {
    get: function (k, def) {
      try { var v = localStorage.getItem('onyx.' + k); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set: function (k, v) { try { localStorage.setItem('onyx.' + k, JSON.stringify(v)); } catch (e) { } },
    del: function (k) { try { localStorage.removeItem('onyx.' + k); } catch (e) { } }
  };

  /* Bus d'événements */
  var handlers = {};
  Onyx.bus = {
    on: function (n, fn) { (handlers[n] = handlers[n] || []).push(fn); },
    off: function (n, fn) { handlers[n] = (handlers[n] || []).filter(function (f) { return f !== fn; }); },
    emit: function (n, d) { (handlers[n] || []).slice().forEach(function (f) { try { f(d); } catch (e) { console.error(e); } }); }
  };

  Onyx.debounce = function (fn, ms) {
    var t;
    return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); };
  };

  Onyx.fmtTime = function (sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return h ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
  };

  /* Version affichée : « 1.1 » (le numéro de compilation reste interne) */
  Onyx.shortVersion = function (v) {
    var m = /^v?(\d+)\.(\d+)/.exec(String(v || ''));
    return m ? m[1] + '.' + m[2] : String(v || '');
  };
  Onyx.toast = function (msg, type, ms) {
    var box = document.getElementById('toasts');
    if (!box) return;
    var t = Onyx.h('div.toast' + (type ? '.' + type : ''), { text: msg });
    box.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () { t.classList.remove('in'); setTimeout(function () { t.remove(); }, 400); }, ms || 3200);
  };

  Onyx.settings = {
    defaults: {
      streamLang: 'fr', subLang: 'fr', player: 'internal', streamServer: 'http://127.0.0.1:11470',
      autoNext: true, splash: true, tvName: 'Onyx TV', sounds: true, ambience: true, launchFx: true
    },
    get: function (k) { var s = Onyx.store.get('settings', {}); return k in s ? s[k] : this.defaults[k]; },
    set: function (k, v) { var s = Onyx.store.get('settings', {}); s[k] = v; Onyx.store.set('settings', s); Onyx.bus.emit('settings', { key: k, value: v }); }
  };

  /* Icônes (SVG inline) */
  var I = function (d, extra) { return '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"' + (extra || '') + '><path d="' + d + '"/></svg>'; };
  Onyx.icons = {
    home: I('M12 3 2 11.5h3V21h5.5v-6h3v6H19v-9.5h3z'),
    search: I('M10.5 3a7.5 7.5 0 0 1 5.96 12.06l4.74 4.74-1.4 1.4-4.74-4.74A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z'),
    movie: I('M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v2h2V6zm12 0v2h2V6zM5 10v4h2v-4zm12 0v4h2v-4zM5 16v2h2v-2zm12 0v2h2v-2zM9 6v12h6V6z'),
    tv: I('M3 5h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v9h16V7z'),
    grid: I('M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z'),
    list: I('M6 3h12a1 1 0 0 1 1 1v17.5l-7-4.2-7 4.2V4a1 1 0 0 1 1-1z'),
    addons: I('M10 2a3 3 0 0 1 3 3v1h4a1 1 0 0 1 1 1v4h1a3 3 0 1 1 0 6h-1v4a1 1 0 0 1-1 1h-4v-1a2 2 0 1 0-4 0v1H5a1 1 0 0 1-1-1v-4h1a2 2 0 1 0 0-4H4V7a1 1 0 0 1 1-1h2V5a3 3 0 0 1 3-3z'),
    link: I('M17 7a5 5 0 0 1 0 10h-3v-2h3a3 3 0 1 0 0-6h-3V7zM7 7h3v2H7a3 3 0 1 0 0 6h3v2H7A5 5 0 0 1 7 7zm1 4h8v2H8z'),
    phone: I('M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v13h10V5zm5 14.2a1 1 0 1 0 0 .01z'),
    gear: I('M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.9h4l.4-2.9c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z'),
    play: I('M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z'),
    pause: I('M6 4h4v16H6zm8 0h4v16h-4z'),
    plus: I('M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z'),
    check: I('M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z'),
    info: I('M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 8v7h2v-7zm0-4v2h2V6z'),
    back: I('M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z'),
    rew: I('M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z'),
    fwd: I('M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z'),
    cc: I('M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm3.5 4A2.5 2.5 0 0 0 5 11.5v1a2.5 2.5 0 0 0 4.9.7l-1.4-.5a1 1 0 0 1-2-.2v-1a1 1 0 0 1 2-.2l1.4-.5A2.5 2.5 0 0 0 7.5 9zm7 0a2.5 2.5 0 0 0-2.5 2.5v1a2.5 2.5 0 0 0 4.9.7l-1.4-.5a1 1 0 0 1-2-.2v-1a1 1 0 0 1 2-.2l1.4-.5A2.5 2.5 0 0 0 14.5 9z'),
    trash: I('M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z'),
    up: I('M12 5l7 7-1.4 1.4L13 8.8V20h-2V8.8l-4.6 4.6L5 12z'),
    down: I('M12 19l-7-7 1.4-1.4 4.6 4.6V4h2v11.2l4.6-4.6L19 12z'),
    sync: I('M12 4V1L8 5l4 4V6a6 6 0 0 1 5.65 8.03l1.5 1.5A8 8 0 0 0 12 4zm-5.65 4.47-1.5-1.5A8 8 0 0 0 12 20v3l4-4-4-4v3a6 6 0 0 1-5.65-8.03z'),
    star: I('M12 2.5l2.9 6.2 6.6.7-5 4.5 1.4 6.6L12 17.2l-5.9 3.3 1.4-6.6-5-4.5 6.6-.7z'),
    globe: I('M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm6.9 9a7 7 0 0 0-3.4-5.2c.6 1.4 1 3.2 1.1 5.2zm-4.3 0c-.2-2.8-1.2-5-2.6-6-1.4 1-2.4 3.2-2.6 6zM8.6 11c.1-2 .5-3.8 1.1-5.2A7 7 0 0 0 5.1 11zm-3.5 2a7 7 0 0 0 4.6 5.2c-.6-1.4-1-3.2-1.1-5.2zm4.3 0c.2 2.8 1.2 5 2.6 6 1.4-1 2.4-3.2 2.6-6zm6 0c-.1 2-.5 3.8-1.1 5.2a7 7 0 0 0 4.6-5.2z'),
    close: I('M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z'),
    power: I('M11 2h2v10h-2zm6.1 2.9A9 9 0 1 1 6.9 4.9l1.4 1.4a7 7 0 1 0 7.4 0z')
  };

  /* Pierre d'onyx (petit logo) */
  Onyx.gemSvg = function (cls) {
    return '<svg viewBox="0 0 120 120" class="' + (cls || 'gem-sm') + '" aria-hidden="true">' +
      '<g stroke="rgba(255,255,255,.25)" stroke-width="1" stroke-linejoin="round">' +
      '<polygon points="32,28 10,50 35,50" fill="#2b2c35"/><polygon points="32,28 60,28 35,50" fill="#55586a"/>' +
      '<polygon points="60,28 35,50 85,50" fill="#3a3c48"/><polygon points="60,28 88,28 85,50" fill="#30313b"/>' +
      '<polygon points="88,28 85,50 110,50" fill="#191a20"/><polygon points="10,50 35,50 60,108" fill="#1e1f26"/>' +
      '<polygon points="35,50 60,50 60,108" fill="#2a2b33"/><polygon points="60,50 85,50 60,108" fill="#121318"/>' +
      '<polygon points="85,50 110,50 60,108" fill="#0c0c0f"/></g></svg>';
  };

  Onyx.wordmark = function () {
    return '<span class="wordmark"><span class="on">ON</span><span class="yx">YX</span></span>';
  };

  Onyx.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
})();
