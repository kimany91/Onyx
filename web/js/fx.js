/* Onyx — moteur d'effets d'ambiance (lumières et animations par film).
   Qualité « cinéma » :
   - rendu net en pleine résolution, particules sur 3 plans de profondeur
     (premier plan flou façon bokeh d'objectif, fond petit et net) ;
   - brume, reflets sous l'eau, aurores, rayons et clair de lune calculés comme
     de vrais champs de lumière (bruit animé), puis agrandis : dégradés doux, sans bandes ;
   - lumières additives avec halos et cœurs brillants.
   Chaque film a 1 ou 2 effets (recette) teintés à ses couleurs ; fondu entre films.
   Les effets « signature » propres à certains films sont dans fx-signatures.js. */
(function () {
  'use strict';
  var Onyx = window.Onyx = window.Onyx || {};
  var PI2 = Math.PI * 2;
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function mix(a, b, t) { return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]; }
  function hex(h) { var m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return null; var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function lum(c) { return (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255; }
  /* couleur vive et lumineuse dérivée de la couleur du film (jamais grise ni sombre) */
  function vivid(c) { var l = lum(c); return l < 0.55 ? mix(c, [255, 255, 255], Math.min(0.6, (0.55 - l) * 1.2)) : c; }
  var WHITE = [255, 255, 255];

  /* ---------- Bruit animé (champs de lumière) ---------- */
  var PERM = new Uint8Array(512), GRAD = new Float32Array(256);
  (function () { var p = []; for (var i = 0; i < 256; i++) { p.push(i); GRAD[i] = Math.random(); } for (i = 255; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = p[i]; p[i] = p[j]; p[j] = t; } for (i = 0; i < 512; i++) PERM[i] = p[i & 255]; })();
  function vnoise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    xi &= 255; yi &= 255;
    var a = GRAD[PERM[xi + PERM[yi]]], b = GRAD[PERM[xi + 1 + PERM[yi]]], c = GRAD[PERM[xi + PERM[yi + 1]]], d = GRAD[PERM[xi + 1 + PERM[yi + 1]]];
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }
  function fbm(x, y) { return vnoise(x, y) * 0.55 + vnoise(x * 2.03, y * 2.03) * 0.3 + vnoise(x * 4.1, y * 4.1) * 0.15; }

  /* ---------- Sprites pré-calculés (haute qualité) ---------- */
  var cache = {};
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  /* halo doux (profil gaussien), avec cœur brillant optionnel */
  function soft(c, core) {
    var k = 's' + c.join(',') + (core || 0); if (cache[k]) return cache[k];
    var s = canvas(128, 128), x = s.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    var hot = mix(c, WHITE, 0.75);
    g.addColorStop(0, rgba(core ? hot : c, 1));
    if (core) g.addColorStop(core, rgba(mix(c, WHITE, 0.3), 0.85));
    g.addColorStop(Math.max(core || 0, 0.25) + 0.05, rgba(c, 0.42));
    g.addColorStop(0.6, rgba(c, 0.1)); g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return (cache[k] = s);
  }
  /* bokeh d'objectif : disque plat au bord légèrement plus lumineux */
  function bokeh(c) {
    var k = 'b' + c.join(','); if (cache[k]) return cache[k];
    var s = canvas(128, 128), x = s.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 60);
    g.addColorStop(0, rgba(c, 0.35)); g.addColorStop(0.82, rgba(c, 0.42)); g.addColorStop(0.93, rgba(mix(c, WHITE, 0.3), 0.6)); g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g; x.beginPath(); x.arc(64, 64, 60, 0, PI2); x.fill();
    return (cache[k] = s);
  }
  /* reflet étoilé (4 branches fines + cœur) */
  function glint(c) {
    var k = 'g' + c.join(','); if (cache[k]) return cache[k];
    var s = canvas(128, 128), x = s.getContext('2d');
    x.drawImage(soft(c, 0.08), 32, 32, 64, 64);
    [0, 1].forEach(function (i) {
      var g = i ? x.createLinearGradient(64, 0, 64, 128) : x.createLinearGradient(0, 64, 128, 64);
      g.addColorStop(0, rgba(c, 0)); g.addColorStop(0.5, rgba(mix(c, WHITE, 0.7), 0.95)); g.addColorStop(1, rgba(c, 0));
      x.fillStyle = g; if (i) x.fillRect(63, 0, 2, 128); else x.fillRect(0, 63, 128, 2);
    });
    return (cache[k] = s);
  }
  /* pétale (dégradé, bord doux) */
  function petal(c) {
    var k = 'p' + c.join(','); if (cache[k]) return cache[k];
    var s = canvas(64, 64), x = s.getContext('2d'), g = x.createLinearGradient(10, 32, 54, 32);
    g.addColorStop(0, rgba(mix(c, WHITE, 0.55), 0.95)); g.addColorStop(1, rgba(c, 0.9));
    x.shadowColor = rgba(c, 0.6); x.shadowBlur = 6; x.fillStyle = g;
    x.beginPath(); x.moveTo(8, 32); x.bezierCurveTo(20, 8, 46, 10, 56, 30); x.bezierCurveTo(46, 50, 22, 54, 8, 32); x.fill();
    return (cache[k] = s);
  }
  /* feuille avec nervure */
  function leaf(c) {
    var k = 'l' + c.join(','); if (cache[k]) return cache[k];
    var s = canvas(64, 64), x = s.getContext('2d'), g = x.createLinearGradient(6, 32, 58, 32);
    g.addColorStop(0, rgba(mix(c, [60, 30, 10], 0.35), 1)); g.addColorStop(1, rgba(mix(c, [255, 220, 120], 0.25), 1));
    x.fillStyle = g; x.beginPath(); x.moveTo(6, 32); x.quadraticCurveTo(30, 6, 58, 32); x.quadraticCurveTo(30, 58, 6, 32); x.fill();
    x.strokeStyle = 'rgba(60,30,10,0.45)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(6, 32); x.lineTo(56, 32); x.stroke();
    return (cache[k] = s);
  }
  function noiseTiles() {
    if (cache.noise) return cache.noise;
    var tiles = [];
    for (var t = 0; t < 4; t++) {
      var s = canvas(256, 256), x = s.getContext('2d'), d = x.createImageData(256, 256);
      for (var i = 0; i < d.data.length; i += 4) { var v = 128 + (Math.random() - 0.5) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
      x.putImageData(d, 0, 0); tiles.push(s);
    }
    return (cache.noise = tiles);
  }
  function blit(g, img, x, y, r, a) { if (a <= 0.003) return; g.globalAlpha = a; g.drawImage(img, x - r, y - r, r * 2, r * 2); }

  /* ---------- Champs de lumière : calculés en petit, agrandis avec lissage ---------- */
  var HAS_FILTER = (function () { try { return 'filter' in document.createElement('canvas').getContext('2d'); } catch (e) { return false; } })();
  function field(L, fn, comp) {
    var fw = Math.max(64, Math.round(L.W / 10)), fh = Math.max(36, Math.round(L.H / 10));
    var fc = canvas(fw, fh), fx2 = fc.getContext('2d'), fd = fx2.createImageData(fw, fh);
    return function (g, t, col) {
      var d = fd.data, i = 0, c = col || L.col;
      for (var y = 0; y < fh; y++) for (var x = 0; x < fw; x++, i += 4) {
        var v = fn(x / fw, y / fh, t);
        if (v <= 0) { d[i + 3] = 0; continue; }
        if (v > 1) v = 1;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = v * 255;
      }
      fx2.putImageData(fd, 0, 0);
      g.save();
      if (comp) g.globalCompositeOperation = comp;
      g.imageSmoothingEnabled = true; if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = 'high';
      g.globalAlpha = L.k;
      // agrandissement lissé + léger flou : dégradés parfaitement doux, aucun pixel visible
      if (HAS_FILTER) g.filter = 'blur(' + Math.round(L.W / fw * 0.9) + 'px)';
      g.drawImage(fc, -L.W * 0.02, -L.H * 0.02, L.W * 1.04, L.H * 1.04);
      if (HAS_FILTER) g.filter = 'none';
      g.restore();
    };
  }

  /* ---------- Particules sur 3 plans (profondeur de champ) ---------- */
  function depthParticles(n, make, opts) {
    return {
      init: function (L) {
        L.p = [];
        for (var i = 0; i < n; i++) { var p = make(L, true); p.z = Math.pow(Math.random(), 1.6); L.p.push(p); }
        L.p.sort(function (a, b) { return a.z - b.z; });
      },
      step: function (L, g, dt, t) {
        var W = L.W, H = L.H, S = L.S;
        for (var i = 0; i < L.p.length; i++) {
          var p = L.p[i], z = p.z, sp = 0.45 + z * 1.2;
          p.age = (p.age || 0) + dt;
          opts.move(p, dt * sp * S, t, L);
          var r = p.r * S * (0.75 + z * z * 2.4);
          if (p.y > H + r * 2 + 40 || p.y < -r * 2 - 60 || p.x < -r * 2 - 80 || p.x > W + r * 2 + 80 || (p.life && p.age > p.life)) {
            var q = make(L, false); q.z = z; L.p[i] = q; continue;
          }
          var a = opts.alpha ? opts.alpha(p, t) : p.a;
          // premier plan : flou d'objectif (gros, transparent) ; fond : petit et net
          if (z > 0.86 && opts.bokeh !== false) { g.globalAlpha = a * 0.22 * L.k; var br = r * 2.6; g.drawImage(opts.bokehImg ? opts.bokehImg(L) : L.bok, p.x - br, p.y - br, br * 2, br * 2); continue; }
          g.globalAlpha = Math.min(1, a * (0.65 + z * 0.45)) * L.k;
          opts.draw(p, g, r, L, t);
        }
      }
    };
  }

  var FX = {};
  FX.snow = depthParticles(110, function (L, init) {
    return { x: rnd(-40, L.W + 40), y: init ? rnd(0, L.H) : rnd(-60, -10), vx: rnd(-10, 10), vy: rnd(24, 52), r: rnd(1.2, 2.6), a: rnd(0.55, 0.95), ph: rnd(0, 6) };
  }, {
    move: function (p, dt) { p.ph += dt; p.x += (p.vx + Math.sin(p.ph * 0.9) * 14) * dt; p.y += p.vy * dt; },
    draw: function (p, g, r, L) { g.drawImage(L.snowS, p.x - r * 2, p.y - r * 2, r * 4, r * 4); }
  });
  FX.rain = {
    init: function (L) { L.p = []; for (var i = 0; i < 140; i++) L.p.push({ x: rnd(0, L.W * 1.2), y: rnd(-L.H, L.H), z: Math.random(), a: rnd(0.25, 0.6) }); },
    step: function (L, g, dt) {
      var c = mix(vivid(L.c), [200, 220, 255], 0.7);
      g.lineCap = 'round';
      for (var i = 0; i < L.p.length; i++) {
        var p = L.p[i], v = (500 + p.z * 900) * L.S, len = (10 + p.z * 34) * L.S;
        p.y += v * dt; p.x -= v * 0.12 * dt;
        if (p.y > L.H + len) { p.y = rnd(-80, -10); p.x = rnd(0, L.W * 1.2); }
        var gr = g.createLinearGradient(p.x, p.y - len, p.x, p.y);
        gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(1, rgba(c, p.a));
        g.globalAlpha = (0.25 + p.z * 0.55) * L.k; g.strokeStyle = gr; g.lineWidth = (0.6 + p.z * 1.4) * L.S;
        g.beginPath(); g.moveTo(p.x + len * 0.12, p.y - len); g.lineTo(p.x, p.y); g.stroke();
      }
    }
  };
  FX.embers = depthParticles(60, function (L, init) {
    return { x: rnd(0, L.W), y: init ? rnd(0, L.H) : L.H + rnd(10, 40), vx: rnd(-14, 14), vy: -rnd(30, 75), r: rnd(1.2, 2.6), a: rnd(0.6, 1), ph: rnd(0, 6) };
  }, {
    move: function (p, dt) { p.x += (p.vx + Math.sin(p.age * 1.7 + p.ph) * 18) * dt; p.y += p.vy * dt; },
    alpha: function (p) { return p.a * (0.6 + 0.4 * Math.sin(p.age * 8 + p.ph)) * Math.min(1, p.y / 300); },
    draw: function (p, g, r, L) { g.drawImage(L.emberS, p.x - r * 3, p.y - r * 3, r * 6, r * 6); }
  });
  FX.sparks = {
    init: function (L) { L.p = []; for (var i = 0; i < 46; i++) L.p.push(this.make(L, true)); },
    make: function (L, init) {
      var a = rnd(-2.5, -0.65), v = rnd(140, 340) * L.S;
      return { x: rnd(L.W * 0.05, L.W * 0.95), y: L.H + 6, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.9, 1.8), age: init ? rnd(0, 1.8) : 0, w: rnd(0.8, 1.8) };
    },
    step: function (L, g, dt) {
      g.lineCap = 'round';
      for (var i = 0; i < L.p.length; i++) {
        var p = L.p[i]; p.age += dt;
        if (p.age > p.life) { L.p[i] = this.make(L, false); continue; }
        p.vy += 260 * L.S * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        var f = 1 - p.age / p.life, tx = p.x - p.vx * 0.035, ty = p.y - p.vy * 0.035;
        var gr = g.createLinearGradient(tx, ty, p.x, p.y); gr.addColorStop(0, rgba(L.warm, 0)); gr.addColorStop(1, rgba(mix(L.warm, WHITE, 0.6), 1));
        g.globalAlpha = f * L.k; g.strokeStyle = gr; g.lineWidth = p.w * L.S;
        g.beginPath(); g.moveTo(tx, ty); g.lineTo(p.x, p.y); g.stroke();
        g.globalAlpha = f * 0.5 * L.k; g.drawImage(L.emberS, p.x - 6 * L.S, p.y - 6 * L.S, 12 * L.S, 12 * L.S);
      }
    }
  };
  FX.stars = {
    init: function (L) {
      L.p = []; for (var i = 0; i < 160; i++) L.p.push({ x: rnd(0, L.W), y: rnd(0, L.H), z: Math.pow(Math.random(), 2.5), ph: rnd(0, 6), w: Math.random() < 0.7 });
      L.shoot = null; L.next = rnd(3, 7);
    },
    step: function (L, g, dt, t) {
      for (var i = 0; i < L.p.length; i++) {
        var p = L.p[i]; p.x -= dt * (2 + p.z * 6) * L.S; if (p.x < -4) p.x = L.W + 4;
        var tw = 0.55 + 0.45 * Math.sin(t * (1 + p.z * 2) + p.ph), r = (0.6 + p.z * 2.4) * L.S;
        g.globalAlpha = (0.35 + p.z * 0.65) * tw * L.k;
        if (p.z > 0.82) g.drawImage(L.glintW, p.x - r * 5, p.y - r * 5, r * 10, r * 10);
        else g.drawImage(p.w ? L.whiteS : L.tintS, p.x - r * 2, p.y - r * 2, r * 4, r * 4);
      }
      L.next -= dt;
      if (L.next <= 0 && !L.shoot) { L.shoot = { x: rnd(L.W * 0.35, L.W), y: rnd(0, L.H * 0.35), age: 0 }; L.next = rnd(6, 12); }
      if (L.shoot) {
        var s = L.shoot; s.age += dt; s.x -= 700 * L.S * dt; s.y += 260 * L.S * dt;
        var f = Math.max(0, 1 - s.age / 0.9), len = 140 * L.S;
        var gr = g.createLinearGradient(s.x, s.y, s.x + len, s.y - len * 0.37); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.globalAlpha = f * L.k; g.strokeStyle = gr; g.lineWidth = 1.6 * L.S; g.lineCap = 'round';
        g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x + len, s.y - len * 0.37); g.stroke();
        g.drawImage(L.glintW, s.x - 10 * L.S, s.y - 10 * L.S, 20 * L.S, 20 * L.S);
        if (f <= 0) L.shoot = null;
      }
    }
  };
  FX.warp = {
    init: function (L) { L.p = []; for (var i = 0; i < 120; i++) L.p.push(this.make(L, true)); },
    make: function (L, init) { return { a: rnd(0, PI2), d: init ? rnd(10, L.W * 0.6) : rnd(4, 40) * L.S, v: rnd(40, 90) * L.S, w: rnd(0.6, 1.8) }; },
    step: function (L, g, dt) {
      var cx = L.W * 0.62, cy = L.H * 0.42, c = mix(vivid(L.c), WHITE, 0.55);
      g.lineCap = 'round';
      blit(g, L.tintS, cx, cy, 120 * L.S, 0.25 * L.k);
      for (var i = 0; i < L.p.length; i++) {
        var p = L.p[i]; p.v *= 1 + dt * 1.8; p.d += p.v * dt;
        if (p.d > L.W * 0.9) { L.p[i] = this.make(L, false); continue; }
        var len = Math.min(p.d * 0.6, p.v * 0.16), ca = Math.cos(p.a), sa = Math.sin(p.a);
        var x1 = cx + ca * p.d, y1 = cy + sa * p.d, x0 = x1 - ca * len, y0 = y1 - sa * len;
        var gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(1, rgba(c, 0.9));
        g.globalAlpha = Math.min(1, p.d / (260 * L.S)) * L.k; g.strokeStyle = gr; g.lineWidth = p.w * L.S * (0.6 + p.d / L.W);
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    }
  };
  FX.dust = depthParticles(70, function (L, init) {
    return { x: init ? rnd(0, L.W) : -10, y: rnd(0, L.H), vx: rnd(4, 12), vy: rnd(-4, 4), r: rnd(0.9, 1.8), a: rnd(0.35, 0.8), ph: rnd(0, 6) };
  }, {
    move: function (p, dt) { p.x += p.vx * dt; p.y += (p.vy + Math.sin(p.age * 0.6 + p.ph) * 4) * dt; },
    alpha: function (p) { return p.a * (0.55 + 0.45 * Math.sin(p.age * 0.9 + p.ph)); },
    draw: function (p, g, r, L) { g.drawImage(L.tintS, p.x - r * 2.2, p.y - r * 2.2, r * 4.4, r * 4.4); }
  });
  FX.bokeh = {
    init: function (L) { L.p = []; for (var i = 0; i < 22; i++) L.p.push({ x: rnd(0, L.W), y: rnd(0, L.H), r: rnd(14, 60), a: rnd(0.08, 0.26), vx: rnd(-4, 4), vy: -rnd(2, 7), ph: rnd(0, 6), c: Math.random() < 0.3 }); },
    step: function (L, g, dt, t) {
      for (var i = 0; i < L.p.length; i++) {
        var p = L.p[i]; p.x += p.vx * dt * L.S; p.y += p.vy * dt * L.S;
        if (p.y < -p.r * L.S * 2) { p.y = L.H + p.r * L.S; p.x = rnd(0, L.W); }
        var r = p.r * L.S * (1 + 0.04 * Math.sin(t * 0.7 + p.ph));
        g.globalAlpha = p.a * (0.75 + 0.25 * Math.sin(t * 0.5 + p.ph)) * L.k;
        g.drawImage(p.c ? L.bokW : L.bok, p.x - r, p.y - r, r * 2, r * 2);
      }
    }
  };
  FX.fireflies = depthParticles(34, function (L) {
    return { x: rnd(0, L.W), y: rnd(L.H * 0.25, L.H), r: rnd(1.4, 2.4), ph: rnd(0, 6), sp: rnd(0.3, 0.8), life: rnd(9, 18), a: 1 };
  }, {
    move: function (p, dt) { p.x += Math.sin(p.age * p.sp + p.ph) * 22 * dt; p.y += Math.cos(p.age * p.sp * 1.3 + p.ph) * 14 * dt; },
    alpha: function (p) { var f = Math.max(0, Math.min(1, p.age, p.life - p.age)); return f * (0.25 + 0.75 * Math.pow(Math.max(0, Math.sin(p.age * 1.9 + p.ph)), 2)); },
    draw: function (p, g, r, L) { g.drawImage(L.limeS, p.x - r * 5, p.y - r * 5, r * 10, r * 10); }
  });
  FX.lanterns = depthParticles(20, function (L, init) {
    return { x: rnd(0, L.W), y: init ? rnd(L.H * 0.15, L.H) : L.H + 30, vx: rnd(-4, 4), vy: -rnd(9, 18), r: rnd(3.5, 6), ph: rnd(0, 6), a: 1 };
  }, {
    bokehImg: function (L) { return L.bokWarm; },
    move: function (p, dt) { p.x += (p.vx + Math.sin(p.age * 0.6 + p.ph) * 5) * dt; p.y += p.vy * dt; },
    alpha: function (p) { return 0.85 + 0.15 * Math.sin(p.age * 5 + p.ph); },
    draw: function (p, g, r, L) {
      var a = g.globalAlpha;
      g.globalAlpha = a * 0.5; g.drawImage(L.warmS, p.x - r * 4, p.y - r * 4, r * 8, r * 8);
      g.globalAlpha = a;
      var gr = g.createLinearGradient(0, p.y - r, 0, p.y + r);
      gr.addColorStop(0, 'rgba(255,170,80,0.9)'); gr.addColorStop(1, 'rgba(255,236,170,1)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(p.x - r * 0.55, p.y - r * 0.8); g.lineTo(p.x + r * 0.55, p.y - r * 0.8); g.lineTo(p.x + r * 0.42, p.y + r * 0.8); g.lineTo(p.x - r * 0.42, p.y + r * 0.8); g.closePath(); g.fill();
    }
  });
  function tumbleMove(p, dt) { p.rot += p.vr * dt; p.flip += p.vf * dt; p.x += (p.vx + Math.sin(p.age * 1.3 + p.ph) * 16) * dt; p.y += p.vy * dt; }
  function tumbleDraw(img) {
    return function (p, g, r, L) {
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.abs(Math.sin(p.flip)) * 0.85 + 0.15);
      g.drawImage(img(p, L), -r * 2.2, -r * 2.2, r * 4.4, r * 4.4); g.restore();
    };
  }
  function flake(L, init, vy, vx) { return { x: rnd(-40, L.W), y: init ? rnd(0, L.H) : rnd(-60, -10), vx: vx || rnd(6, 20), vy: vy || rnd(22, 40), r: rnd(2.2, 3.6), a: rnd(0.65, 0.95), rot: rnd(0, 6), vr: rnd(-1.6, 1.6), flip: rnd(0, 6), vf: rnd(0.8, 2.4), ph: rnd(0, 6) }; }
  FX.petals = depthParticles(36, function (L, i) { return flake(L, i); }, { move: tumbleMove, draw: tumbleDraw(function (p, L) { return L.petalS; }) });
  var LEAF_COLS = [[214, 120, 40], [190, 70, 32], [232, 172, 60], [150, 96, 40]];
  FX.leaves = depthParticles(26, function (L, i) { var f = flake(L, i, rnd(26, 46), rnd(10, 26)); f.ci = Math.floor(rnd(0, 4)); f.r = rnd(2.8, 4.2); return f; }, {
    bokehImg: function (L) { return L.bokWarm; }, move: tumbleMove, draw: tumbleDraw(function (p) { return leaf(LEAF_COLS[p.ci]); })
  });
  FX.ash = depthParticles(70, function (L, i) { var f = flake(L, i, rnd(10, 24), rnd(-6, 8)); f.r = rnd(1, 2); f.a = rnd(0.35, 0.7); return f; }, {
    bokehImg: function (L) { return L.bokGrey; }, move: tumbleMove,
    draw: function (p, g, r) { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.abs(Math.sin(p.flip)) * 0.8 + 0.2); g.fillStyle = 'rgba(200,198,196,1)'; g.fillRect(-r, -r * 0.7, r * 2, r * 1.4); g.restore(); }
  });
  FX.bubbles = depthParticles(34, function (L, init) {
    return { x: rnd(0, L.W), y: init ? rnd(0, L.H) : L.H + 20, vy: -rnd(20, 44), r: rnd(1.8, 4.5), a: rnd(0.5, 0.9), ph: rnd(0, 6) };
  }, {
    move: function (p, dt) { p.x += Math.sin(p.age * 2.6 + p.ph) * 10 * dt; p.y += p.vy * dt; },
    draw: function (p, g, r, L) {
      var gr = g.createRadialGradient(p.x - r * 0.3, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.0)'); gr.addColorStop(0.75, rgba(L.cool, 0.12)); gr.addColorStop(0.95, rgba(mix(L.cool, WHITE, 0.6), 0.7)); gr.addColorStop(1, rgba(L.cool, 0));
      g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, r, 0, PI2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(p.x - r * 0.38, p.y - r * 0.4, Math.max(0.6, r * 0.16), 0, PI2); g.fill();
    }
  });
  FX.magic = depthParticles(56, function (L, init) {
    return { x: rnd(0, L.W), y: init ? rnd(0, L.H) : L.H + 10, vx: rnd(-6, 6), vy: -rnd(8, 22), r: rnd(1, 2.2), a: rnd(0.6, 1), ph: rnd(0, 6), star: Math.random() < 0.3 };
  }, {
    move: function (p, dt) { p.x += (p.vx + Math.sin(p.age * 1.2 + p.ph) * 8) * dt; p.y += p.vy * dt; },
    alpha: function (p) { return p.a * (0.3 + 0.7 * Math.pow(Math.abs(Math.sin(p.age * 2 + p.ph)), 1.5)); },
    draw: function (p, g, r, L) { if (p.star) g.drawImage(L.glintT, p.x - r * 6, p.y - r * 6, r * 12, r * 12); else g.drawImage(L.tintS, p.x - r * 2.5, p.y - r * 2.5, r * 5, r * 5); }
  });
  FX.gold = depthParticles(80, function (L, init) {
    return { x: rnd(0, L.W), y: init ? rnd(0, L.H) : rnd(-40, -6), vx: rnd(-5, 5), vy: rnd(14, 30), r: rnd(0.8, 1.6), a: rnd(0.6, 1), ph: rnd(0, 6), sp: rnd(2, 5) };
  }, {
    bokehImg: function (L) { return L.bokGold; },
    move: function (p, dt) { p.x += (p.vx + Math.sin(p.age + p.ph) * 6) * dt; p.y += p.vy * dt; },
    alpha: function (p) { return p.a * (0.3 + 0.7 * Math.pow(Math.abs(Math.sin(p.age * p.sp + p.ph)), 8)); },
    draw: function (p, g, r, L) { g.drawImage(L.glintG, p.x - r * 5, p.y - r * 5, r * 10, r * 10); }
  });
  FX.sand = {
    init: function (L) {
      L.p = []; for (var i = 0; i < 160; i++) L.p.push({ x: rnd(0, L.W), y: rnd(L.H * 0.2, L.H), z: Math.random(), a: rnd(0.3, 0.7) });
      L.haze = field(L, function (x, y, t) { return Math.max(0, fbm(x * 3 - t * 0.35, y * 2) - 0.45) * 1.1 * Math.min(1, y * 1.4); });
    },
    step: function (L, g, dt, t) {
      L.haze(g, t, L.sandC);
      g.lineCap = 'round';
      for (var i = 0; i < L.p.length; i++) {
        var p = L.p[i], v = (90 + p.z * 260) * L.S; p.x += v * dt; p.y += Math.sin(t * 2 + i) * 8 * dt;
        if (p.x > L.W + 20) { p.x = -20; p.y = rnd(L.H * 0.2, L.H); }
        g.globalAlpha = p.a * (0.3 + p.z * 0.7) * L.k; g.strokeStyle = rgba(L.sandC, 1); g.lineWidth = (0.5 + p.z * 1.5) * L.S;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - v * 0.04, p.y); g.stroke();
      }
    }
  };
  /* --- champs de lumière --- */
  FX.smoke = {
    init: function (L) { L.sc = mix(L.c, [190, 190, 200], 0.55); L.f = field(L, function (x, y, t) { var n = fbm(x * 2.6 + t * 0.05, y * 2.2 - t * 0.02); return Math.max(0, n - 0.42) * 1.15 * (0.35 + y * 0.9); }); },
    step: function (L, g, dt, t) { L.f(g, t, L.sc); }
  };
  FX.caustics = {
    init: function (L) {
      L.cc = mix(vivid(L.c), [150, 235, 255], 0.55);
      L.f = field(L, function (x, y, t) {
        var a = Math.sin(x * 14 + Math.sin(y * 7 + t * 0.8) * 2 + t * 0.5), b = Math.sin(y * 12 + Math.sin(x * 8 - t * 0.6) * 2.2 - t * 0.4);
        return Math.pow(1 - Math.abs(a * b), 7) * 0.6 * (1.1 - y * 0.9);
      });
    },
    step: function (L, g, dt, t) { L.f(g, t, L.cc); blit(g, L.coolS, L.W * 0.5, -L.H * 0.15, L.H * 0.9, 0.22 * L.k); }
  };
  FX.aurora = {
    init: function (L) {
      L.ac = mix(vivid(L.c), [90, 255, 190], 0.45);
      L.f = field(L, function (x, y, t) {
        var band = 0.24 + Math.sin(x * 5 + t * 0.25) * 0.07 + Math.sin(x * 11 - t * 0.4) * 0.03;
        var d = y - band; if (d < -0.05 || d > 0.4) return 0;
        var curtain = Math.pow(vnoise(x * 34 + t * 0.6, t * 0.2), 2) * 0.8 + 0.2;
        return (d < 0 ? Math.max(0, 1 + d / 0.05) : Math.exp(-d * 6)) * curtain * 0.75;
      });
    },
    step: function (L, g, dt, t) { L.f(g, t, L.ac); }
  };
  FX.rays = {
    init: function (L) {
      var ox = L.ox = rnd(0.3, 0.7); L.rc = mix(vivid(L.c), [255, 246, 220], 0.55);
      L.f = field(L, function (x, y, t) {
        var dx = x - ox, dy = y + 0.12, ang = Math.atan2(dx, dy), dist = Math.sqrt(dx * dx * 3 + dy * dy);
        var r = vnoise(ang * 9 + 50, t * 0.12) * 0.7 + vnoise(ang * 23 + 9, t * 0.2) * 0.3;
        return Math.pow(Math.max(0, r - 0.35), 1.6) * 1.6 * Math.max(0, 1 - dist * 0.85);
      });
    },
    step: function (L, g, dt, t) { L.f(g, t, L.rc); blit(g, L.coolS, L.W * L.ox, -L.H * 0.05, L.H * 0.35, 0.25 * L.k); }
  };
  FX.moon = {
    init: function (L) { L.mist = field(L, function (x, y, t) { return Math.max(0, fbm(x * 2.4 + t * 0.06, y * 3) - 0.48) * 1.3 * Math.max(0, y - 0.35) * 1.6; }); },
    step: function (L, g, dt, t) {
      var x = L.W * 0.82, y = L.H * 0.2, r = L.H * 0.07;
      blit(g, L.moonS, x, y, r * 7, 0.32 * L.k);
      g.globalAlpha = 0.85 * L.k; var gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      gr.addColorStop(0, 'rgba(255,253,245,1)'); gr.addColorStop(1, 'rgba(210,214,226,1)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, PI2); g.fill();
      L.mist(g, t, [200, 210, 230]);
    }
  };
  FX.flare = {
    init: function (L) { L.fx0 = rnd(0.25, 0.75); L.fy = rnd(0.14, 0.32); },
    step: function (L, g, dt, t) {
      var x = L.W * (L.fx0 + Math.sin(t * 0.06) * 0.12), y = L.H * L.fy, k = (0.85 + 0.15 * Math.sin(t * 1.1)) * L.k;
      var c = mix(vivid(L.c), [110, 170, 255], 0.45), w = L.W * 0.7;
      var gr = g.createLinearGradient(x - w, 0, x + w, 0);
      gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.42, rgba(c, 0.35)); gr.addColorStop(0.5, rgba(mix(c, WHITE, 0.7), 0.95)); gr.addColorStop(0.58, rgba(c, 0.35)); gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr;
      g.globalAlpha = 0.9 * k; g.fillRect(x - w, y - 1 * L.S, w * 2, 2 * L.S);
      g.globalAlpha = 0.3 * k; g.fillRect(x - w, y - 5 * L.S, w * 2, 10 * L.S);
      blit(g, L.coolS, x, y, 70 * L.S, 0.55 * k);
      blit(g, soft(mix(c, WHITE, 0.8), 0.1), x, y, 22 * L.S, 1 * k);
      var dx = L.W / 2 - x, dy = L.H / 2 - y;
      [[0.45, 14, 0.18], [0.9, 34, 0.1], [1.3, 9, 0.22], [1.7, 54, 0.07]].forEach(function (q) { blit(g, q[1] > 30 ? bokeh(c) : soft(c), x + dx * q[0] * 2, y + dy * q[0] * 2, q[1] * L.S, q[2] * k); });
    }
  };
  FX.glow = {
    init: function () { },
    step: function (L, g, dt, t) {
      blit(g, L.tintS, L.W * 0.16, L.H * 0.9, L.H * (0.9 + 0.08 * Math.sin(t * 0.6)), 0.34 * L.k);
      blit(g, L.tintS, L.W * 0.9, L.H * 0.1, L.H * (0.6 + 0.06 * Math.sin(t * 0.5 + 2)), 0.18 * L.k);
    }
  };
  FX.beam = {
    init: function (L) {
      var bx = L.bx = rnd(0.35, 0.75); L.bc = mix(vivid(L.c), WHITE, 0.65);
      L.f = field(L, function (x, y, t) {
        var v = 0;
        for (var i = 0; i < 2; i++) {
          var a = Math.sin(t * 0.32 + i * 2.1) * 0.55, ox = bx + (i ? 0.12 : 0), dx = x - ox, dy = 1.05 - y;
          var ang = Math.atan2(dx, dy) - a, w = 0.07 + dy * 0.02;
          v += Math.max(0, 1 - Math.abs(ang) / w) * (0.5 + 0.5 * fbm(x * 4, y * 4 - t * 0.1)) * (i ? 0.6 : 1) * (1 - dy * 0.35);
        }
        return v * 0.42;
      });
    },
    step: function (L, g, dt, t) { L.f(g, t, L.bc); }
  };
  FX.neon = {
    init: function (L) { L.n = [[0.06, 0.78, [255, 40, 170]], [0.94, 0.3, [40, 220, 255]], [0.55, 1.02, null]]; L.off = 0; },
    step: function (L, g, dt, t) {
      if (Math.random() < dt * 0.5) L.off = rnd(0.05, 0.18);
      L.off = Math.max(0, L.off - dt);
      for (var i = 0; i < L.n.length; i++) {
        var n = L.n[i], c = n[2] ? mix(n[2], vivid(L.c), 0.3) : vivid(L.c), fl = (i === 0 && L.off > 0) ? 0.4 : 1;
        blit(g, soft(c), L.W * n[0], L.H * n[1], L.H * 0.62, 0.36 * fl * L.k * (0.9 + 0.1 * Math.sin(t * 2.5 + i)));
        blit(g, soft(mix(c, WHITE, 0.4)), L.W * n[0], L.H * n[1], L.H * 0.16, 0.25 * fl * L.k);
      }
    }
  };
  FX.lightning = {
    init: function (L) { L.next = rnd(2.5, 6); L.flash = 0; L.bolt = null; },
    bolt: function (x, y, len, ang, depth, out) {
      var pts = [[x, y]];
      for (var i = 0; i < 14; i++) { ang += rnd(-0.45, 0.45); x += Math.sin(ang) * len / 14; y += Math.cos(ang) * len / 14; pts.push([x, y]); if (depth < 2 && Math.random() < 0.18) this.bolt(x, y, len * 0.45, ang + rnd(-0.9, 0.9), depth + 1, out); }
      out.push({ pts: pts, w: 3 - depth });
    },
    step: function (L, g, dt) {
      L.next -= dt;
      if (L.next <= 0) { L.next = rnd(7, 14); L.flash = 1; L.bolt = []; this.bolt(rnd(L.W * 0.35, L.W * 0.95), -10, L.H * 0.8, rnd(-0.3, 0.3), 0, L.bolt); }
      if (L.flash <= 0) return;
      var c = mix(vivid(L.c), [210, 220, 255], 0.6);
      g.globalAlpha = L.flash * 0.28 * L.k; g.fillStyle = rgba(c, 1); g.fillRect(0, 0, L.W, L.H);
      if (L.bolt && L.flash > 0.35) {
        g.lineCap = 'round'; g.lineJoin = 'round';
        [[8, 0.18, c], [3, 0.5, mix(c, WHITE, 0.4)], [1.2, 1, WHITE]].forEach(function (s) {
          L.bolt.forEach(function (b) {
            g.globalAlpha = L.flash * s[1] * L.k * (b.w / 3); g.strokeStyle = rgba(s[2], 1); g.lineWidth = s[0] * L.S * (b.w / 3);
            g.beginPath(); b.pts.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.stroke();
          });
        });
      }
      L.flash = Math.max(0, L.flash - dt * (L.flash > 0.6 ? 2.2 : 1.2));
    }
  };
  FX.sun = {
    init: function () { },
    step: function (L, g, dt, t) {
      var x = L.W * 0.8, y = L.H * 0.17, c = mix(vivid(L.c), [255, 196, 110], 0.55), s = 1 + Math.sin(t * 0.8) * 0.02;
      blit(g, soft(c), x, y, L.H * 1.1 * s, 0.32 * L.k);
      blit(g, soft(mix(c, WHITE, 0.5), 0.15), x, y, L.H * 0.2 * s, 0.75 * L.k);
      blit(g, soft(WHITE, 0.3), x, y, L.H * 0.05, 0.9 * L.k);
    }
  };
  FX.pulse = {
    init: function () { },
    step: function (L, g, dt, t) {
      var ph = (t % 1.7) / 1.7, beat = Math.max(Math.exp(-Math.pow((ph - 0.08) / 0.05, 2)), 0.7 * Math.exp(-Math.pow((ph - 0.28) / 0.06, 2)));
      var gr = g.createRadialGradient(L.W / 2, L.H / 2, L.H * 0.3, L.W / 2, L.H / 2, L.W * 0.72);
      var c = mix(L.c, [110, 0, 12], 0.55);
      gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(1, rgba(c, 0.55));
      g.save(); g.globalCompositeOperation = 'source-over';
      g.globalAlpha = (0.25 + beat * 0.5) * L.k; g.fillStyle = gr; g.fillRect(0, 0, L.W, L.H); g.restore();
    }
  };
  FX.portal = {
    init: function (L) { L.p = []; for (var i = 0; i < 90; i++) L.p.push({ a: rnd(0, PI2), d: 0, v: rnd(30, 90), life: rnd(0.4, 1.1), age: rnd(0, 1.1) }); },
    step: function (L, g, dt, t) {
      var cx = L.W * 0.8, cy = L.H * 0.35, R = L.H * 0.2, c = L.warm;
      blit(g, L.warmS, cx, cy, R * 1.9, 0.22 * L.k);
      g.lineCap = 'round';
      for (var i = 0; i < L.p.length; i++) {
        var p = L.p[i]; p.age += dt;
        if (p.age > p.life) { p.a = t * 2.4 + rnd(0, PI2); p.age = 0; p.d = 0; p.v = rnd(30, 90); }
        var a = p.a + p.age * 0.7, tx = -Math.sin(a), ty = Math.cos(a); p.d += p.v * L.S * dt;
        var x = cx + Math.cos(a) * R + tx * p.d, y = cy + Math.sin(a) * R + ty * p.d + p.age * p.age * 40 * L.S;
        g.globalAlpha = (1 - p.age / p.life) * L.k; g.strokeStyle = rgba(mix(c, WHITE, 0.45), 1); g.lineWidth = 1.3 * L.S;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - tx * 7 * L.S, y - ty * 7 * L.S); g.stroke();
      }
      g.globalAlpha = 0.55 * L.k; g.strokeStyle = rgba(c, 1); g.lineWidth = 2.2 * L.S; g.beginPath(); g.arc(cx, cy, R, 0, PI2); g.stroke();
      g.globalAlpha = 0.9 * L.k; g.strokeStyle = rgba(mix(c, WHITE, 0.6), 1); g.lineWidth = 0.9 * L.S; g.beginPath(); g.arc(cx, cy, R, 0, PI2); g.stroke();
    }
  };
  FX.code = {
    init: function (L) {
      var fs = Math.round(15 * L.S), n = Math.floor(L.W / (fs * 1.6));
      L.fs = fs; L.cols = [];
      for (var i = 0; i < n; i++) if (Math.random() < 0.55) L.cols.push({ x: (i + 0.5) * fs * 1.6, y: rnd(-L.H, L.H), v: rnd(60, 150) * L.S, len: Math.floor(rnd(8, 22)), z: Math.random() });
      L.glyphs = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ0123456789Z';
      L.cc = mix(vivid(L.c), [40, 255, 120], 0.7);
    },
    step: function (L, g, dt, t) {
      g.textAlign = 'center';
      for (var i = 0; i < L.cols.length; i++) {
        var c = L.cols[i], fs = L.fs * (0.7 + c.z * 0.5); c.y += c.v * dt;
        if (c.y - c.len * fs > L.H) { c.y = rnd(-L.H * 0.4, 0); c.v = rnd(60, 150) * L.S; }
        g.font = Math.round(fs) + 'px monospace';
        for (var k = 0; k < c.len; k++) {
          var y = c.y - k * fs;
          if (y < -fs || y > L.H + fs) continue;
          var gl = L.glyphs[(Math.floor(y / fs + t * (k === 0 ? 8 : 0.5)) * 7 + i * 13) % L.glyphs.length];
          g.globalAlpha = (k === 0 ? 1 : 0.7 * Math.pow(1 - k / c.len, 1.4)) * (0.35 + c.z * 0.65) * L.k;
          g.fillStyle = k === 0 ? '#eaffef' : rgba(L.cc, 1);
          g.fillText(gl, c.x, y);
        }
        g.globalAlpha = 0.25 * (0.35 + c.z * 0.65) * L.k; g.drawImage(L.codeS, c.x - fs * 1.4, c.y - fs * 1.6, fs * 2.8, fs * 2.8);
      }
    }
  };
  FX.web = {
    init: function (L) { L.art = null; FX.dust.init(L); },
    step: function (L, g, dt, t) {
      if (!L.art) L.art = makeWeb(L.W, L.H, L.S);
      g.save(); g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 0.9 * L.k; g.translate(Math.sin(t * 0.45) * 2 * L.S, Math.sin(t * 0.33) * 1.5 * L.S); g.drawImage(L.art, 0, 0);
      g.restore();
      // reflet de lumière qui glisse le long des fils
      var sx = ((t * 0.07) % 1.6 - 0.3) * L.W;
      g.save(); g.globalCompositeOperation = 'lighter';
      g.beginPath(); g.rect(sx - L.W * 0.06, 0, L.W * 0.12, L.H); g.clip();
      g.globalAlpha = 0.55 * L.k; g.drawImage(L.art, 0, 0); g.restore();
      FX.dust.step(L, g, dt, t);
    }
  };
  /* Toile d'araignée réaliste : rayons + spirale de capture qui pend, perles de rosée, en pleine résolution */
  function makeWeb(W, H, S) {
    var s = canvas(W, H), x = s.getContext('2d');
    x.lineCap = 'round';
    function web(cx, cy, R, a0, a1, spokes, turns, alpha) {
      var angs = [], len = [];
      for (var i = 0; i <= spokes; i++) { angs.push(a0 + (a1 - a0) * i / spokes + rnd(-0.025, 0.025)); len.push(R * rnd(0.9, 1.05)); }
      [[3.2 * S, alpha * 0.08], [0.9 * S, alpha]].forEach(function (pass) {
        x.lineWidth = pass[0]; x.strokeStyle = 'rgba(236,240,248,' + pass[1] + ')';
        angs.forEach(function (a, i) { x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * len[i], cy + Math.sin(a) * len[i]); x.stroke(); });
        x.beginPath();
        var steps = spokes * turns;
        for (var k = 0; k <= steps; k++) {
          var si = k % (spokes + 1), rr = R * (0.08 + 0.9 * k / steps);
          if (rr > len[si]) continue;
          var a = angs[si], px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
          if (si === 0) x.moveTo(px, py);
          else { var pa = (angs[si - 1] + a) / 2, sag = rr * 0.9; x.quadraticCurveTo(cx + Math.cos(pa) * sag, cy + Math.sin(pa) * sag, px, py); }
        }
        x.stroke();
      });
      for (var d = 0; d < spokes * turns * 0.5; d++) {
        var a2 = a0 + (a1 - a0) * Math.random(), rr2 = R * rnd(0.15, 0.95), r = rnd(0.7, 1.7) * S;
        x.globalAlpha = rnd(0.4, 0.9); x.drawImage(soft(WHITE, 0.25), cx + Math.cos(a2) * rr2 - r * 3, cy + Math.sin(a2) * rr2 - r * 3, r * 6, r * 6);
      }
      x.globalAlpha = 1;
    }
    web(W, 0, Math.min(W, H) * 0.66, Math.PI / 2, Math.PI, 14, 16, 0.55);
    web(0, H, Math.min(W, H) * 0.34, -Math.PI / 2, 0, 9, 10, 0.32);
    return s;
  }
  FX.grain = {
    init: function (L) { L.tiles = noiseTiles(); L.scratch = 0; },
    step: function (L, g, dt, t) {
      g.save(); g.globalCompositeOperation = 'overlay';
      var tile = L.tiles[Math.floor(t * 24) % 4], sz = 256;
      g.globalAlpha = 0.16 * L.k;
      var ox = Math.floor(Math.random() * sz), oy = Math.floor(Math.random() * sz);
      for (var x = -ox; x < L.W; x += sz) for (var y = -oy; y < L.H; y += sz) g.drawImage(tile, x, y);
      g.globalCompositeOperation = 'source-over';
      if (Math.random() < dt * 0.6) L.scratch = 0.2; L.scratch = Math.max(0, L.scratch - dt);
      if (L.scratch > 0) { g.globalAlpha = 0.18 * L.k; g.fillStyle = '#fff'; g.fillRect(L.W * (0.15 + Math.random() * 0.7), 0, Math.max(1, L.S), L.H); }
      g.restore();
    }
  };
  /* anciens noms (effets jugés trop « dessin animé ») → remplacés par leur version soignée */
  var ALIAS = { bats: 'moon', hearts: 'bokeh', confetti: 'gold', scan: 'flare' };

  /* ---------- Moteur ---------- */
  function layerOf(name, c, W, H, S, extra) {
    name = ALIAS[name] || name;
    var fx = FX[name]; if (!fx) return null;
    var L = { _fx: fx, name: name, W: W, H: H, S: S, c: c, k: 1, extra: extra || {} };
    var v = vivid(c);
    L.col = v; L.tintS = soft(v); L.whiteS = soft(WHITE); L.glintW = glint([220, 230, 255]); L.glintT = glint(mix(v, WHITE, 0.3));
    L.warm = mix(v, [255, 150, 60], 0.65); L.warmS = soft(L.warm); L.emberS = soft(L.warm, 0.12);
    L.cool = mix(v, [140, 210, 255], 0.5); L.coolS = soft(L.cool);
    L.limeS = soft(mix(v, [215, 255, 130], 0.65), 0.1);
    L.glintG = glint([255, 216, 130]); L.sandC = mix(v, [230, 196, 146], 0.65);
    L.snowS = soft([248, 250, 255], 0.2); L.petalS = petal(mix(v, [255, 176, 205], 0.55));
    L.bok = bokeh(v); L.bokW = bokeh([235, 240, 255]); L.bokWarm = bokeh([255, 190, 110]); L.bokGold = bokeh([255, 214, 140]); L.bokGrey = bokeh([190, 190, 196]);
    L.moonS = soft([200, 215, 240]); L.codeS = soft(mix(v, [40, 255, 120], 0.7));
    fx.init(L);
    return L;
  }

  Onyx.Fx = {
    names: function () { return Object.keys(FX).concat(Object.keys(ALIAS)); },
    has: function (n) { return !!(FX[n] || ALIAS[n]); },
    /* ajoute un effet (utilisé par les effets « signature » de certains films) */
    register: function (name, def) { FX[name] = def; },
    util: { rnd: rnd, rgba: rgba, mix: mix, vivid: vivid, soft: soft, bokeh: bokeh, glint: glint, blit: blit, field: field, fbm: fbm, vnoise: vnoise, canvas: canvas, depthParticles: depthParticles, FX: FX, WHITE: WHITE },
    /* Crée un moteur sur un canevas ; set(effets, couleur) change d'ambiance en fondu */
    create: function (cv) {
      var g = cv.getContext('2d'), cur = [], old = [], fade = 1, running = false, last = 0, t0 = performance.now(), hidden = function () { return false; };
      function scale() { return Math.max(0.5, cv.width / 1280); }
      function frame(now) {
        if (!running) return;
        requestAnimationFrame(frame);
        if (now - last < 32) return;
        var dt = Math.min(0.1, (now - last) / 1000); last = now;
        if (hidden()) return;
        var t = (now - t0) / 1000;
        fade = Math.min(1, fade + dt * 1.1);
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
        g.clearRect(0, 0, cv.width, cv.height);
        g.globalCompositeOperation = 'lighter';
        var i;
        for (i = 0; i < old.length; i++) { old[i].k = old[i].k0 * (1 - fade); if (old[i].k > 0.01) { old[i]._fx.step(old[i], g, dt, t); g.globalCompositeOperation = 'lighter'; } }
        if (fade >= 1) old = [];
        for (i = 0; i < cur.length; i++) { cur[i].k = cur[i].k0 * fade; cur[i]._fx.step(cur[i], g, dt, t); g.globalCompositeOperation = 'lighter'; }
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
        if (!cur.length && !old.length) { running = false; g.clearRect(0, 0, cv.width, cv.height); }
      }
      return {
        set: function (names, color, intensity, extra) {
          old = cur.concat(old.filter(function (l) { return l.k > 0.02; })).slice(0, 3);
          old.forEach(function (l) { l.k0 = l.k; });
          fade = 0;
          var W = cv.width, H = cv.height, S = scale(), seen = {};
          cur = (names || []).map(function (n) { return ALIAS[n] || n; }).filter(function (n) { if (seen[n]) return false; seen[n] = 1; return true; }).slice(0, 3)
            .map(function (n, i) { var L = layerOf(n, color || WHITE, W, H, S, extra); if (L) L.k0 = (intensity || 1) * (i ? 0.8 : 1); return L; }).filter(Boolean);
          if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
        },
        clear: function () { this.set([], null); },
        resize: function () { var S = scale(); cur = cur.map(function (l) { var L = layerOf(l.name, l.c, cv.width, cv.height, S, l.extra); if (L) L.k0 = l.k0; return L; }).filter(Boolean); old = []; },
        pauseWhen: function (fn) { hidden = fn; }
      };
    },
    /* ambiance de l'image demandée par un effet (ex. noir et blanc) */
    moodOf: function (names) { for (var i = 0; i < (names || []).length; i++) { var f = FX[ALIAS[names[i]] || names[i]]; if (f && f.mood) return f.mood; } return null; },
    hex: hex
  };
})();
