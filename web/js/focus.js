/* Onyx — navigation à la télécommande (focus spatial) */
(function () {
  'use strict';
  var Onyx = window.Onyx;

  var F = Onyx.focus = { cur: null };

  function visible(el) {
    if (!el.isConnected || el.offsetParent === null) return false;
    if (el.classList.contains('disabled')) return false;
    return true;
  }

  F.scopeRoot = function () {
    var modals = Onyx.$$('#modals > .modal');
    if (modals.length) return modals[modals.length - 1];
    if (Onyx.player && Onyx.player.active) return Onyx.$('#player');
    return null; // tout le document (sidebar + vue)
  };

  F.candidates = function () {
    var root = F.scopeRoot();
    var list;
    if (root) list = Onyx.$$('.f', root);
    else list = Onyx.$$('#sidebar .f').concat(Onyx.$$('#view > .view.active .f'));
    return list.filter(visible);
  };

  F.set = function (el, opts) {
    if (!el) return;
    opts = opts || {};
    var prev = F.cur;
    F.prev = prev;
    if (prev && prev !== el) {
      prev.classList.remove('focused');
      prev.dispatchEvent(new CustomEvent('unfocus'));
    }
    F.cur = el;
    el.classList.add('focused');
    // mémorise le dernier élément focalisé par conteneur
    var p = el.parentElement;
    while (p) {
      if (p.hasAttribute && p.hasAttribute('data-remember')) p._last = el;
      p = p.parentElement;
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { if (opts.typing) el.focus(); }
    else if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
    if (!opts.noScroll) F.reveal(el, opts.instant);
    document.body.classList.toggle('in-sidebar', !!el.closest('#sidebar'));
    if (prev !== el) el.dispatchEvent(new CustomEvent('focus', { bubbles: false }));
    Onyx.bus.emit('focus', el);
  };

  F.first = function (root) {
    var els = Onyx.$$('.f', root || document).filter(visible);
    return els[0] || null;
  };
  F.restore = function (root) {
    if (root && root._last && root._last.isConnected && visible(root._last)) { F.set(root._last); return true; }
    var el = Onyx.$('.f.default', root);
    if (el && visible(el)) { F.set(el); return true; }
    el = F.first(root);
    if (el) { F.set(el); return true; }
    return false;
  };

  /* Défilement par transformations (fluide sur les TV peu puissantes) */
  function offsetIn(el, ancestor, prop) {
    var v = 0, n = el;
    while (n && n !== ancestor) { v += n[prop]; n = n.offsetParent; }
    return v;
  }
  F.reveal = function (el, instant) {
    var h = el.closest('.track-h');
    if (h && h.parentElement) {
      var vp = h.parentElement;
      var x = offsetIn(el, h, 'offsetLeft');
      var pad = parseFloat(getComputedStyle(h).paddingLeft) || 0;
      var mode = h.getAttribute('data-hmode') || 'start';
      var max = Math.max(0, h.scrollWidth - vp.clientWidth);
      var cur = h._x || 0, target;
      if (mode === 'start') target = x - pad;
      else {
        target = cur;
        if (x - pad < cur) target = x - pad;
        else if (x + el.offsetWidth + pad > cur + vp.clientWidth) target = x + el.offsetWidth + pad - vp.clientWidth;
      }
      target = Math.max(0, Math.min(max, target));
      setT(h, 'translateX', target, instant);
    }
    var v = el.closest('.track-v');
    while (v) {
      var vvp = v.parentElement;
      var anchor = el;
      // l'élément enfant direct du rail qui contient la cible
      while (anchor.parentElement && anchor.parentElement !== v) anchor = anchor.parentElement;
      var y = offsetIn(anchor, v, 'offsetTop');
      var vmode = v.getAttribute('data-vmode') || 'visible';
      var offset = parseFloat(v.getAttribute('data-voffset') || '0') * vvp.clientHeight;
      var vmax = Math.max(0, v.scrollHeight - vvp.clientHeight);
      var vcur = v._x || 0, vt;
      if (vmode === 'top') vt = y - offset;
      else {
        var margin = vvp.clientHeight * 0.12;
        var top = offsetIn(el, v, 'offsetTop');
        vt = vcur;
        if (top - margin < vcur) vt = top - margin;
        else if (top + el.offsetHeight + margin > vcur + vvp.clientHeight) vt = top + el.offsetHeight + margin - vvp.clientHeight;
      }
      vt = Math.max(0, Math.min(vmax, vt));
      setT(v, 'translateY', vt, instant);
      // index de ligne active (pour les effets de fondu)
      Onyx.$$(':scope > .active-row', v).forEach(function (r) { if (r !== anchor) r.classList.remove('active-row'); });
      anchor.classList.add('active-row');
      v = v.parentElement && v.parentElement.closest('.track-v');
    }
  };
  function setT(node, fn, val, instant) {
    node._x = val;
    if (instant) { node.style.transition = 'none'; }
    node.style.transform = fn + '(' + (-val) + 'px)';
    if (instant) { node.offsetWidth; node.style.transition = ''; }
  }
  F.resetTrack = function (node) { if (node) { node._x = 0; node.style.transform = ''; } };

  /* Déplacement directionnel */
  F.move = function (dir) {
    var cur = F.cur;
    if (!cur || !cur.isConnected || !visible(cur)) {
      var root = F.scopeRoot() || Onyx.$('#view > .view.active');
      F.restore(root);
      return;
    }
    var ev = new CustomEvent('nav', { detail: dir, cancelable: true, bubbles: true });
    if (!cur.dispatchEvent(ev)) return;

    var r = cur.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var best = null, bestScore = Infinity;
    // haut/bas ne quittent jamais la page vers le menu latéral (on y va avec la flèche gauche),
    // et dans le menu, haut/bas restent dans le menu
    var inSide = !!cur.closest('#sidebar'), vertical = dir === 'up' || dir === 'down';
    F.candidates().forEach(function (c) {
      if (c === cur) return;
      if (vertical && !!c.closest('#sidebar') !== inSide) return;
      var b = c.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) return;
      var bx = b.left + b.width / 2, by = b.top + b.height / 2;
      var primary, secondary, overlap;
      if (dir === 'right') {
        if (b.left < r.right - Math.min(r.width, b.width) * 0.5 || bx <= cx) return;
        primary = Math.max(0, b.left - r.right);
        overlap = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
        secondary = overlap > 0 ? 0 : Math.abs(by - cy);
      } else if (dir === 'left') {
        if (b.right > r.left + Math.min(r.width, b.width) * 0.5 || bx >= cx) return;
        primary = Math.max(0, r.left - b.right);
        overlap = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
        secondary = overlap > 0 ? 0 : Math.abs(by - cy);
      } else if (dir === 'down') {
        if (b.top < r.bottom - Math.min(r.height, b.height) * 0.5 || by <= cy) return;
        primary = Math.max(0, b.top - r.bottom);
        overlap = Math.min(r.right, b.right) - Math.max(r.left, b.left);
        secondary = overlap > 0 ? Math.abs(b.left - r.left) * 0.1 : Math.abs(bx - cx);
      } else {
        if (b.bottom > r.top + Math.min(r.height, b.height) * 0.5 || by >= cy) return;
        primary = Math.max(0, r.top - b.bottom);
        overlap = Math.min(r.right, b.right) - Math.max(r.left, b.left);
        secondary = overlap > 0 ? Math.abs(b.left - r.left) * 0.1 : Math.abs(bx - cx);
      }
      var score = primary + secondary * (dir === 'left' || dir === 'right' ? 4 : 1.5);
      if (score < bestScore) { bestScore = score; best = c; }
    });

    if (best) {
      // mémoire de colonne : si on change de ligne, revenir sur le dernier élément de cette ligne
      if (dir === 'up' || dir === 'down') {
        var row = best.closest('[data-remember]');
        if (row && row !== cur.closest('[data-remember]') && row._last && row._last.isConnected && visible(row._last)) best = row._last;
      }
      // entrée dans la barre latérale : élément actif
      if (best.closest('#sidebar') && !cur.closest('#sidebar')) {
        var act = Onyx.$('#sidebar .f.active');
        if (act) best = act;
      }
      F.set(best);
      return true;
    }
    if (dir === 'left' && !F.scopeRoot() && !cur.closest('#sidebar')) {
      var a = Onyx.$('#sidebar .f.active') || Onyx.$('#sidebar .f');
      if (a) F.set(a);
    }
    return false;
  };

  F.ok = function () {
    var c = F.cur;
    if (!c || !c.isConnected) return;
    if (c.tagName === 'INPUT') { c.focus(); return; }
    c.classList.add('pressed');
    setTimeout(function () { c.classList.remove('pressed'); }, 160);
    c.click();
  };

  /* Clavier / télécommande */
  var KEYS = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down',
    13: 'ok', 23: 'ok', 32: 'ok',
    27: 'back', 8: 'back', 4: 'back', 461: 'back', 10009: 'back', 166: 'back',
    179: 'playpause', 415: 'play', 19: 'pause', 85: 'playpause', 126: 'play', 127: 'pause',
    417: 'ff', 412: 'rw', 90: 'ff', 89: 'rw', 228: 'ff', 227: 'rw', 413: 'stop', 178: 'stop'
  };
  var lastMove = 0;
  F.handleKey = function (action, repeat) {
    if (Onyx.bus) {
      var handled = { stop: false };
      Onyx.bus.emit('key', { action: action, repeat: repeat, handled: handled });
      if (handled.stop) return true;
    }
    if (action === 'left' || action === 'right' || action === 'up' || action === 'down') {
      var now = Date.now();
      if (repeat && now - lastMove < 90) return true;
      lastMove = now;
      var before = F.cur;
      F.move(action);
      if (Onyx.sfx) Onyx.sfx(F.cur !== before ? 'move' : 'bump', { vertical: action === 'up' || action === 'down' });
      return true;
    }
    if (action === 'ok') { if (Onyx.sfx && F.cur && !F.cur.hasAttribute('data-nosfx')) Onyx.sfx('select'); F.ok(); return true; }
    if (action === 'back') { if (Onyx.sfx) Onyx.sfx('back'); Onyx.app && Onyx.app.back(); return true; }
    return false;
  };

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    var action = KEYS[e.keyCode];
    if (e.key === 'MediaPlayPause') action = 'playpause';
    if (!action) return;
    if (typing) {
      if (action === 'left' || action === 'right' || (action === 'ok' && e.keyCode === 32) || (action === 'back' && e.keyCode === 8)) return;
      if (action === 'up' || action === 'down' || action === 'back' || action === 'ok') t.blur();
    }
    if (F.handleKey(action, e.repeat)) e.preventDefault();
  }, true);

  // Souris / tactile (version PC) : le survol déplace le focus
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest && e.target.closest('.f');
    if (el && el !== F.cur && document.body.classList.contains('mouse')) F.set(el, { noScroll: true });
  });
  document.addEventListener('mousemove', function () { document.body.classList.add('mouse'); });
  document.addEventListener('keydown', function () { document.body.classList.remove('mouse'); });
  document.addEventListener('wheel', function (e) {
    if (!F.cur) return;
    F.handleKey(e.deltaY > 0 ? 'down' : 'up', true);
  }, { passive: true });
})();
