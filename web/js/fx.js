/* Onyx — moteur d'effets d'ambiance (lumières et animations par film).
   Chaque film a une « recette » : 1 ou 2 effets (+ couleur). Les effets sont
   dessinés sur un seul canevas à demi-résolution, ~30 images/s, en mode additif,
   avec des sprites pré-calculés : léger pour une TV. Les changements de film
   se font en fondu enchaîné. */
(function () {
  'use strict';
  var Onyx = window.Onyx = window.Onyx || {};
  var PI2 = Math.PI * 2;
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function mix(a, b, t) { return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]; }
  function hex(h) { var m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return null; var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  var WHITE = [245, 247, 255];

  /* ---------- Sprites ---------- */
  var cache = {};
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function soft(c, hard) {
    var k = 's' + c.join(',') + (hard ? 'h' : '');
    if (cache[k]) return cache[k];
    var s = canvas(64, 64), x = s.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, rgba(c, 1)); g.addColorStop(hard ? 0.2 : 0.35, rgba(c, hard ? 0.9 : 0.45)); g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return (cache[k] = s);
  }
  function heart(c) {
    var k = 'h' + c.join(','); if (cache[k]) return cache[k];
    var s = canvas(64, 64), x = s.getContext('2d');
    x.shadowColor = rgba(c, 0.9); x.shadowBlur = 10; x.fillStyle = rgba(mix(c, WHITE, 0.35), 0.95);
    x.beginPath(); x.moveTo(32, 50);
    x.bezierCurveTo(8, 34, 12, 12, 32, 22); x.bezierCurveTo(52, 12, 56, 34, 32, 50); x.fill();
    return (cache[k] = s);
  }
  function wedge(c, len, spread) {
    var k = 'w' + c.join(',') + len + spread; if (cache[k]) return cache[k];
    var w = Math.round(len * spread * 2 + 4), s = canvas(w, len), x = s.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, len); g.addColorStop(0, rgba(c, 0.55)); g.addColorStop(0.5, rgba(c, 0.18)); g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g; x.beginPath(); x.moveTo(w / 2 - 2, 0); x.lineTo(w / 2 + 2, 0); x.lineTo(w, len); x.lineTo(0, len); x.closePath(); x.fill();
    return (cache[k] = s);
  }
  function noiseTiles() {
    if (cache.noise) return cache.noise;
    var tiles = [];
    for (var t = 0; t < 3; t++) {
      var s = canvas(128, 128), x = s.getContext('2d'), d = x.createImageData(128, 128);
      for (var i = 0; i < d.data.length; i += 4) { var v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
      x.putImageData(d, 0, 0); tiles.push(s);
    }
    return (cache.noise = tiles);
  }

  /* ---------- Systèmes de particules génériques ---------- */
  function particles(n, make, draw, opts) {
    opts = opts || {};
    return {
      init: function (L) { L.p = []; for (var i = 0; i < n; i++) L.p.push(make(L, true)); },
      step: function (L, g, dt, t) {
        var W = L.W, H = L.H;
        for (var i = 0; i < L.p.length; i++) {
          var p = L.p[i];
          p.age = (p.age || 0) + dt;
          if (opts.move) opts.move(p, dt, t, L); else { p.x += p.vx * dt; p.y += p.vy * dt; }
          if (p.dead || p.y > H + 60 || p.y < -60 || p.x < -80 || p.x > W + 80 || (p.life && p.age > p.life)) { L.p[i] = make(L, false); continue; }
          draw(p, g, L, t);
        }
      }
    };
  }
  function blit(g, img, x, y, r, a) { if (a <= 0.003) return; g.globalAlpha = a; g.drawImage(img, x - r, y - r, r * 2, r * 2); }

  /* ---------- Les effets ---------- */
  var FX = {};
  FX.snow = particles(70, function (L, init) {
    return { x: rnd(0, L.W), y: init ? rnd(0, L.H) : -6, vx: rnd(-6, 6), vy: rnd(14, 38), r: rnd(1, 3.2), a: rnd(0.35, 0.85), ph: rnd(0, 6) };
  }, function (p, g, L) { blit(g, L.white, p.x, p.y, p.r * 2.4, p.a * L.k); }, {
    move: function (p, dt) { p.ph += dt; p.x += (p.vx + Math.sin(p.ph * 1.2) * 9) * dt; p.y += p.vy * dt; }
  });
  FX.rain = {
    init: function (L) { L.p = []; for (var i = 0; i < 90; i++) L.p.push({ x: rnd(0, L.W * 1.2), y: rnd(-L.H, L.H), l: rnd(8, 20), v: rnd(300, 460), a: rnd(0.07, 0.2) }); },
    step: function (L, g, dt) {
      g.strokeStyle = rgba(mix(L.c, [210, 225, 255], 0.75), 1); g.lineWidth = 1;
      for (var i = 0; i < L.p.length; i++) {
        var p = L.p[i]; p.y += p.v * dt; p.x -= p.v * 0.16 * dt;
        if (p.y > L.H + 20) { p.y = rnd(-40, -10); p.x = rnd(0, L.W * 1.2); }
        g.globalAlpha = p.a * L.k; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + p.l * 0.16, p.y - p.l); g.stroke();
      }
    }
  };
  FX.embers = particles(46, function (L, init) {
    return { x: rnd(0, L.W), y: init ? rnd(0, L.H) : L.H + 6, vx: rnd(-10, 10), vy: -rnd(18, 55), r: rnd(0.8, 2.4), a: rnd(0.45, 1), ph: rnd(0, 6) };
  }, function (p, g, L) { blit(g, L.warm, p.x, p.y, p.r * 3, p.a * L.k * (0.55 + 0.45 * Math.sin(p.age * 9 + p.ph))); }, {
    move: function (p, dt) { p.x += (p.vx + Math.sin(p.age * 2 + p.ph) * 10) * dt; p.y += p.vy * dt; }
  });
  FX.sparks = particles(34, function (L) {
    var a = rnd(-2.6, -0.5);
    return { x: rnd(L.W * 0.1, L.W * 0.9), y: L.H + 4, vx: Math.cos(a) * rnd(60, 160), vy: Math.sin(a) * rnd(90, 220), life: rnd(0.8, 1.8), a: rnd(0.6, 1), age: rnd(0, 1.5) };
  }, function (p, g, L) {
    var f = 1 - p.age / p.life;
    g.globalAlpha = f * p.a * L.k; g.strokeStyle = rgba(mix(L.warmC, WHITE, 0.3), 1); g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); g.stroke();
  }, { move: function (p, dt) { p.vy += 140 * dt; p.x += p.vx * dt; p.y += p.vy * dt; } });
  FX.stars = {
    init: function (L) { L.p = []; for (var i = 0; i < 110; i++) L.p.push({ x: rnd(0, L.W), y: rnd(0, L.H), r: rnd(0.4, 1.6), a: rnd(0.3, 1), ph: rnd(0, 6), w: Math.random() < 0.75 }); L.shoot = null; L.next = rnd(3, 7); },
    step: function (L, g, dt, t) {
      for (var i = 0; i < L.p.length; i++) {
        var p = L.p[i]; p.x -= dt * 2; if (p.x < -4) p.x = L.W + 4;
        blit(g, p.w ? L.white : L.tint, p.x, p.y, p.r * 2.6, p.a * L.k * (0.55 + 0.45 * Math.sin(t * 2 + p.ph)));
      }
      L.next -= dt;
      if (L.next <= 0 && !L.shoot) { L.shoot = { x: rnd(L.W * 0.3, L.W), y: rnd(0, L.H * 0.4), age: 0 }; L.next = rnd(5, 11); }
      if (L.shoot) {
        var s = L.shoot; s.age += dt; s.x -= 420 * dt; s.y += 160 * dt;
        var f = Math.max(0, 1 - s.age / 0.8);
        g.globalAlpha = f * L.k; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x + 60, s.y - 23); g.stroke();
        if (f <= 0) L.shoot = null;
      }
    }
  };
  FX.warp = {
    init: function (L) { L.p = []; for (var i = 0; i < 80; i++) L.p.push(this.make(L, true)); },
    make: function (L, init) { var a = rnd(0, PI2); return { a: a, d: init ? rnd(5, L.W * 0.6) : rnd(2, 30), v: rnd(30, 70), w: rnd(0.6, 1.6) }; },
    step: function (L, g, dt) {
      var cx = L.W * 0.62, cy = L.H * 0.42;
      g.lineCap = 'round';
      for (var i = 0; i < L.p.length; i++) {
        var p = L.p[i]; p.v *= 1 + dt * 1.6; p.d += p.v * dt;
        if (p.d > L.W) { L.p[i] = this.make(L, false); continue; }
        var len = Math.min(p.d * 0.5, p.v * 0.12), x1 = cx + Math.cos(p.a) * p.d, y1 = cy + Math.sin(p.a) * p.d;
        g.globalAlpha = Math.min(1, p.d / 200) * 0.7 * L.k; g.strokeStyle = rgba(mix(L.c, WHITE, 0.6), 1); g.lineWidth = p.w;
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - Math.cos(p.a) * len, y1 - Math.sin(p.a) * len); g.stroke();
      }
    }
  };
  FX.dust = particles(42, function (L, init) {
    return { x: init ? rnd(0, L.W) : -4, y: rnd(0, L.H), vx: rnd(3, 9), vy: rnd(-3, 3), r: rnd(0.6, 1.8), a: rnd(0.15, 0.55), ph: rnd(0, 6) };
  }, function (p, g, L) { blit(g, L.tint, p.x, p.y, p.r * 2.4, p.a * L.k * (0.6 + 0.4 * Math.sin(p.age + p.ph))); });
  FX.bokeh = particles(16, function (L, init) {
    return { x: rnd(0, L.W), y: init ? rnd(0, L.H) : L.H + 40, vx: rnd(-3, 3), vy: -rnd(3, 9), r: rnd(8, 28), a: rnd(0.06, 0.2) };
  }, function (p, g, L) { blit(g, L.tint, p.x, p.y, p.r, p.a * L.k); });
  FX.fireflies = particles(26, function (L) {
    return { x: rnd(0, L.W), y: rnd(L.H * 0.3, L.H), vx: 0, vy: 0, r: rnd(1.2, 2.4), ph: rnd(0, 6), sp: rnd(0.3, 0.8), life: rnd(8, 16) };
  }, function (p, g, L) {
    var fade = Math.min(1, p.age, p.life - p.age);
    blit(g, L.lime, p.x, p.y, p.r * 4, Math.max(0, fade) * L.k * (0.35 + 0.65 * Math.max(0, Math.sin(p.age * 2.2 + p.ph))));
  }, { move: function (p, dt) { p.x += Math.sin(p.age * p.sp + p.ph) * 14 * dt; p.y += Math.cos(p.age * p.sp * 1.3 + p.ph) * 10 * dt; } });
  FX.lanterns = particles(14, function (L, init) {
    return { x: rnd(0, L.W), y: init ? rnd(L.H * 0.2, L.H) : L.H + 20, vx: rnd(-3, 3), vy: -rnd(6, 14), r: rnd(3, 7), ph: rnd(0, 6) };
  }, function (p, g, L) {
    var fl = 0.8 + 0.2 * Math.sin(p.age * 5 + p.ph);
    blit(g, L.warm, p.x, p.y, p.r * 3.4, 0.35 * fl * L.k);
    g.globalAlpha = 0.85 * fl * L.k; g.fillStyle = 'rgba(255,200,120,1)'; g.fillRect(p.x - p.r * 0.5, p.y - p.r * 0.7, p.r, p.r * 1.3);
  }, { move: function (p, dt) { p.x += (p.vx + Math.sin(p.age * 0.7 + p.ph) * 4) * dt; p.y += p.vy * dt; } });
  function flakeDraw(colorFn) {
    return function (p, g, L) {
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.abs(Math.sin(p.flip)) * 0.9 + 0.1);
      g.globalAlpha = p.a * L.k; g.fillStyle = colorFn(p, L);
      g.beginPath(); g.ellipse(0, 0, p.r * 1.6, p.r, 0, 0, PI2); g.fill(); g.restore();
    };
  }
  function tumble(p, dt) { p.rot += p.vr * dt; p.flip += p.vf * dt; p.x += (p.vx + Math.sin(p.age * 1.5 + p.ph) * 12) * dt; p.y += p.vy * dt; }
  function flake(L, init, vy, vx) { return { x: rnd(-20, L.W), y: init ? rnd(0, L.H) : -10, vx: vx || rnd(4, 16), vy: vy || rnd(18, 36), r: rnd(2, 4.2), a: rnd(0.4, 0.85), rot: rnd(0, 6), vr: rnd(-2, 2), flip: rnd(0, 6), vf: rnd(1, 3), ph: rnd(0, 6) }; }
  FX.petals = particles(28, function (L, i) { return flake(L, i); }, flakeDraw(function (p, L) { return rgba(L.pink, 1); }), { move: tumble });
  FX.leaves = particles(20, function (L, i) { var f = flake(L, i, rnd(20, 40), rnd(8, 22)); f.r = rnd(3, 5); f.col = [[214, 120, 40], [196, 74, 34], [230, 170, 60], [150, 90, 40]][Math.floor(rnd(0, 4))]; return f; },
    flakeDraw(function (p) { return rgba(p.col, 1); }), { move: tumble });
  FX.ash = particles(50, function (L, i) { var f = flake(L, i, rnd(8, 20), rnd(-4, 6)); f.r = rnd(1, 2.4); f.a = rnd(0.25, 0.6); return f; },
    flakeDraw(function () { return 'rgba(190,190,195,1)'; }), { move: tumble });
  FX.confetti = particles(50, function (L, i) {
    var f = flake(L, i, rnd(30, 60), rnd(-8, 8)); f.r = rnd(2, 3.4);
    f.col = [L.c, mix(L.c, WHITE, 0.5), [255, 210, 80], [90, 200, 255], [255, 110, 170]][Math.floor(rnd(0, 5))]; return f;
  }, function (p, g, L) {
    g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.sin(p.flip));
    g.globalAlpha = p.a * L.k; g.fillStyle = rgba(p.col, 1); g.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2); g.restore();
  }, { move: tumble });
  FX.bubbles = particles(26, function (L, init) {
    return { x: rnd(0, L.W), y: init ? rnd(0, L.H) : L.H + 10, vx: 0, vy: -rnd(14, 34), r: rnd(1.5, 5), a: rnd(0.25, 0.6), ph: rnd(0, 6) };
  }, function (p, g, L) {
    g.globalAlpha = p.a * L.k; g.strokeStyle = rgba(mix(L.c, WHITE, 0.6), 1); g.lineWidth = 0.8;
    g.beginPath(); g.arc(p.x, p.y, p.r, 0, PI2); g.stroke();
    g.globalAlpha = p.a * 0.8 * L.k; g.fillStyle = 'rgba(255,255,255,1)'; g.fillRect(p.x - p.r * 0.45, p.y - p.r * 0.5, 1, 1);
  }, { move: function (p, dt) { p.x += Math.sin(p.age * 3 + p.ph) * 8 * dt; p.y += p.vy * dt; } });
  FX.hearts = particles(14, function (L, init) {
    return { x: rnd(0, L.W), y: init ? rnd(0, L.H) : L.H + 20, vx: rnd(-4, 4), vy: -rnd(8, 18), r: rnd(4, 9), a: rnd(0.25, 0.6), ph: rnd(0, 6) };
  }, function (p, g, L) { blit(g, L.heart, p.x, p.y, p.r * (1 + 0.08 * Math.sin(p.age * 6)), p.a * L.k); },
  { move: function (p, dt) { p.x += (p.vx + Math.sin(p.age + p.ph) * 6) * dt; p.y += p.vy * dt; } });
  FX.magic = particles(44, function (L, init) {
    return { x: rnd(0, L.W), y: init ? rnd(0, L.H) : L.H + 6, vx: rnd(-5, 5), vy: -rnd(4, 16), r: rnd(0.8, 2.4), a: rnd(0.4, 1), ph: rnd(0, 6), star: Math.random() < 0.4 };
  }, function (p, g, L) {
    var tw = 0.4 + 0.6 * Math.abs(Math.sin(p.age * 2.5 + p.ph)), a = p.a * tw * L.k;
    blit(g, L.tint, p.x, p.y, p.r * 2.8, a);
    if (p.star) { g.globalAlpha = a; g.fillStyle = '#fff'; g.fillRect(p.x - p.r * 2.6, p.y - 0.4, p.r * 5.2, 0.8); g.fillRect(p.x - 0.4, p.y - p.r * 2.6, 0.8, p.r * 5.2); }
  }, { move: function (p, dt) { p.x += (p.vx + Math.sin(p.age * 1.3 + p.ph) * 6) * dt; p.y += p.vy * dt; } });
  FX.gold = particles(60, function (L, init) {
    return { x: rnd(0, L.W), y: init ? rnd(0, L.H) : -6, vx: rnd(-4, 4), vy: rnd(10, 24), r: rnd(0.6, 1.8), a: rnd(0.5, 1), ph: rnd(0, 6) };
  }, function (p, g, L) {
    var gl = Math.pow(Math.abs(Math.sin(p.age * 3 + p.ph)), 6);
    blit(g, L.gold, p.x, p.y, p.r * (2 + gl * 3), p.a * (0.35 + gl * 0.65) * L.k);
  }, { move: function (p, dt) { p.x += (p.vx + Math.sin(p.age + p.ph) * 5) * dt; p.y += p.vy * dt; } });
  FX.sand = particles(80, function (L, init) {
    return { x: init ? rnd(0, L.W) : -10, y: rnd(L.H * 0.25, L.H), vx: rnd(60, 140), vy: rnd(-6, 10), r: rnd(0.5, 1.4), a: rnd(0.2, 0.55) };
  }, function (p, g, L) {
    g.globalAlpha = p.a * L.k; g.strokeStyle = rgba(L.sandC, 1); g.lineWidth = p.r;
    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05); g.stroke();
  });
  FX.smoke = particles(9, function (L, init) {
    return { x: init ? rnd(0, L.W) : -L.H * 0.5, y: rnd(L.H * 0.3, L.H * 1.05), vx: rnd(5, 12), vy: rnd(-3, 1), r: rnd(L.H * 0.3, L.H * 0.6), a: rnd(0.05, 0.11) };
  }, function (p, g, L) { blit(g, L.smoke, p.x, p.y, p.r * (1 + p.age * 0.01), p.a * L.k); });
  FX.bats = particles(6, function (L, init) {
    return { x: init ? rnd(0, L.W) : -20, y: rnd(L.H * 0.05, L.H * 0.5), vx: rnd(30, 60), vy: rnd(-6, 6), s: rnd(3, 7), ph: rnd(0, 6), life: rnd(10, 20) };
  }, function (p, g, L) {
    var f = Math.sin(p.age * 14 + p.ph), s = p.s;
    // silhouettes sombres : dessinées en mode normal (le mode additif ne peut pas assombrir)
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 0.75 * L.k; g.fillStyle = 'rgba(6,6,10,1)';
    g.beginPath(); g.moveTo(p.x, p.y);
    g.quadraticCurveTo(p.x - s, p.y - s * f, p.x - s * 2, p.y - s * 0.3 * f); g.quadraticCurveTo(p.x - s, p.y + s * 0.2, p.x, p.y + s * 0.3);
    g.quadraticCurveTo(p.x + s, p.y + s * 0.2, p.x + s * 2, p.y - s * 0.3 * f); g.quadraticCurveTo(p.x + s, p.y - s * f, p.x, p.y); g.fill();
    g.globalCompositeOperation = 'lighter';
  }, { move: function (p, dt) { p.x += p.vx * dt; p.y += (p.vy + Math.sin(p.age * 2) * 10) * dt; } });
  FX.code = {
    init: function (L) {
      L.cols = []; var n = 22, fs = Math.max(8, Math.round(L.H / 34));
      L.fs = fs; for (var i = 0; i < n; i++) L.cols.push({ x: (i + rnd(0, 0.6)) * L.W / n, y: rnd(-L.H, L.H), v: rnd(40, 110), ch: [] });
      L.glyphs = 'アイウエオカキクケコサシスセソタチツテト0123456789ABCDEFZ';
    },
    step: function (L, g, dt) {
      g.font = L.fs + 'px monospace'; g.textAlign = 'center';
      for (var i = 0; i < L.cols.length; i++) {
        var c = L.cols[i]; c.y += c.v * dt;
        if (c.y - 12 * L.fs > L.H) { c.y = rnd(-L.H * 0.5, 0); c.v = rnd(40, 110); }
        for (var k = 0; k < 12; k++) {
          var y = c.y - k * L.fs;
          if (y < -L.fs || y > L.H + L.fs) continue;
          g.globalAlpha = (k === 0 ? 0.9 : 0.5 * (1 - k / 12)) * L.k;
          g.fillStyle = k === 0 ? '#d8ffe0' : rgba(L.codeC, 1);
          g.fillText(L.glyphs[(Math.floor(y / L.fs) * 7 + i * 13) % L.glyphs.length], c.x, y);
        }
      }
    }
  };
  /* --- lumières --- */
  FX.rays = {
    init: function (L) { L.rays = []; for (var i = 0; i < 7; i++) L.rays.push({ a: rnd(-0.55, 0.55), s: rnd(0.04, 0.09), ph: rnd(0, 6), al: rnd(0.12, 0.24) }); L.ox = rnd(0.25, 0.6); },
    step: function (L, g, dt, t) {
      var len = L.H * 1.3, ox = L.W * L.ox, img = wedge(mix(L.c, WHITE, 0.55), Math.round(len), 0.09);
      for (var i = 0; i < L.rays.length; i++) {
        var r = L.rays[i], a = r.a + Math.sin(t * 0.12 + r.ph) * 0.08;
        g.save(); g.translate(ox, -L.H * 0.08); g.rotate(a);
        g.globalAlpha = r.al * (0.7 + 0.3 * Math.sin(t * 0.5 + r.ph)) * L.k;
        g.drawImage(img, -img.width / 2, 0); g.restore();
      }
    }
  };
  FX.flare = {
    init: function (L) { L.fx = rnd(0.2, 0.8); L.fy = rnd(0.12, 0.35); },
    step: function (L, g, dt, t) {
      var x = L.W * (L.fx + Math.sin(t * 0.07) * 0.15), y = L.H * L.fy, k = (0.8 + 0.2 * Math.sin(t * 1.3)) * L.k;
      var c = mix(L.c, [120, 180, 255], 0.5), gr = g.createLinearGradient(x - L.W * 0.6, 0, x + L.W * 0.6, 0);
      gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.5, rgba(mix(c, WHITE, 0.6), 0.75)); gr.addColorStop(1, rgba(c, 0));
      g.globalAlpha = 0.55 * k; g.fillStyle = gr; g.fillRect(x - L.W * 0.6, y - 1, L.W * 1.2, 2);
      g.globalAlpha = 0.25 * k; g.fillRect(x - L.W * 0.6, y - 4, L.W * 1.2, 8);
      blit(g, soft(mix(c, WHITE, 0.7)), x, y, 18, 0.9 * k);
      // reflets (« ghosts ») sur l'axe opposé
      var dx = L.W / 2 - x, dy = L.H / 2 - y;
      [[0.6, 10, 0.12], [1.1, 22, 0.08], [1.5, 7, 0.14]].forEach(function (q) { blit(g, soft(c), x + dx * q[0] * 2, y + dy * q[0] * 2, q[1], q[2] * k); });
    }
  };
  FX.glow = {
    init: function () { },
    step: function (L, g, dt, t) { blit(g, L.tint, L.W * 0.18, L.H * 0.85, L.H * (0.75 + 0.06 * Math.sin(t * 0.8)), 0.22 * L.k); }
  };
  FX.beam = {
    init: function (L) { L.bx = rnd(0.3, 0.8); },
    step: function (L, g, dt, t) {
      var img = wedge(mix(L.c, WHITE, 0.7), Math.round(L.H * 1.4), 0.12);
      [[0, 1], [2.1, 0.7]].forEach(function (b) {
        g.save(); g.translate(L.W * L.bx + b[0] * 40, L.H * 1.05); g.rotate(Math.PI + Math.sin(t * 0.35 + b[0]) * 0.6);
        g.globalAlpha = 0.26 * b[1] * L.k; g.drawImage(img, -img.width / 2, 0); g.restore();
      });
    }
  };
  FX.neon = {
    init: function (L) { L.n = [{ x: 0.05, y: 0.75, c: [255, 40, 160] }, { x: 0.95, y: 0.35, c: [40, 220, 255] }, { x: 0.6, y: 1.0, c: null }]; L.off = 0; },
    step: function (L, g, dt, t) {
      if (Math.random() < dt * 0.6) L.off = rnd(0.05, 0.2);
      L.off = Math.max(0, L.off - dt);
      var fl = L.off > 0 ? 0.35 : 1;
      for (var i = 0; i < L.n.length; i++) {
        var n = L.n[i], img = soft(n.c || L.c);
        blit(g, img, L.W * n.x, L.H * n.y, L.H * 0.5, 0.26 * (i === 0 ? fl : 1) * L.k * (0.85 + 0.15 * Math.sin(t * 3 + i)));
      }
      // reflets horizontaux (sol mouillé)
      g.globalAlpha = 0.06 * L.k; g.fillStyle = rgba(L.c, 1);
      for (var y = L.H * 0.86; y < L.H; y += 6) g.fillRect(0, y + Math.sin(t * 2 + y) * 1.5, L.W, 1);
    }
  };
  FX.lightning = {
    init: function (L) { L.next = rnd(2, 6); L.flash = 0; L.bolt = null; },
    step: function (L, g, dt) {
      L.next -= dt;
      if (L.next <= 0) {
        L.next = rnd(6, 13); L.flash = 1;
        var x = rnd(L.W * 0.3, L.W * 0.95), y = 0, pts = [[x, y]];
        while (y < L.H * 0.7) { y += rnd(10, 26); x += rnd(-18, 18); pts.push([x, y]); }
        L.bolt = pts;
      }
      if (L.flash > 0) {
        g.globalAlpha = L.flash * 0.22 * L.k; g.fillStyle = rgba(mix(L.c, WHITE, 0.8), 1); g.fillRect(0, 0, L.W, L.H);
        if (L.bolt && L.flash > 0.5) {
          g.globalAlpha = L.flash * L.k; g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.beginPath();
          L.bolt.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.stroke();
        }
        L.flash = Math.max(0, L.flash - dt * (L.flash > 0.6 ? 2.5 : 1.4));
      }
    }
  };
  FX.aurora = {
    init: function (L) { L.b = [0, 1, 2].map(function (i) { return { y: L.H * (0.12 + i * 0.08), ph: rnd(0, 6), c: i === 1 ? null : [80, 255, 190] }; }); },
    step: function (L, g, dt, t) {
      for (var i = 0; i < L.b.length; i++) {
        var b = L.b[i], c = b.c ? mix(b.c, L.c, 0.4) : L.c, h = L.H * 0.16;
        var gr = g.createLinearGradient(0, b.y - h, 0, b.y + h);
        gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.5, rgba(c, 0.5)); gr.addColorStop(1, rgba(c, 0));
        g.globalAlpha = 0.28 * L.k; g.fillStyle = gr; g.beginPath();
        var step = L.W / 24;
        for (var x = 0; x <= L.W + step; x += step) { var y = b.y + Math.sin(x * 0.012 + t * 0.4 + b.ph) * h * 0.6; if (!x) g.moveTo(x, y - h); else g.lineTo(x, y - h); }
        for (x = L.W + step; x >= 0; x -= step) { y = b.y + Math.sin(x * 0.012 + t * 0.4 + b.ph) * h * 0.6 + Math.sin(x * 0.03 + t) * h * 0.2; g.lineTo(x, y + h); }
        g.closePath(); g.fill();
      }
    }
  };
  FX.caustics = {
    init: function (L) { L.w = []; for (var i = 0; i < 7; i++) L.w.push({ y: rnd(0, L.H * 0.55), a: rnd(6, 16), f: rnd(0.01, 0.025), s: rnd(0.3, 0.8), ph: rnd(0, 6) }); },
    step: function (L, g, dt, t) {
      g.strokeStyle = rgba(mix(L.c, [140, 230, 255], 0.5), 1); g.lineWidth = 2;
      for (var i = 0; i < L.w.length; i++) {
        var w = L.w[i]; g.globalAlpha = 0.09 * L.k * (0.6 + 0.4 * Math.sin(t * 0.7 + w.ph)); g.beginPath();
        for (var x = 0; x <= L.W; x += 10) { var y = w.y + Math.sin(x * w.f + t * w.s + w.ph) * w.a + Math.sin(x * w.f * 2.3 - t * w.s) * w.a * 0.5; if (!x) g.moveTo(x, y); else g.lineTo(x, y); }
        g.stroke();
      }
      blit(g, L.tint, L.W * 0.5, -L.H * 0.1, L.H * 0.8, 0.14 * L.k);
    }
  };
  FX.sun = {
    init: function () { },
    step: function (L, g, dt, t) {
      var x = L.W * 0.8, y = L.H * 0.18, c = mix(L.c, [255, 200, 120], 0.5), s = 1 + Math.sin(t * 6) * 0.01;
      blit(g, soft(c), x, y, L.H * 0.9 * s, 0.22 * L.k);
      blit(g, soft(mix(c, WHITE, 0.6), true), x, y, L.H * 0.12 * s, 0.6 * L.k);
      // brume de chaleur : lignes ondulantes très légères en bas
      g.globalAlpha = 0.05 * L.k; g.fillStyle = rgba(c, 1);
      for (var yy = L.H * 0.72; yy < L.H; yy += 5) g.fillRect(Math.sin(t * 3 + yy * 0.3) * 3, yy, L.W, 1);
    }
  };
  FX.pulse = {
    init: function () { },
    step: function (L, g, dt, t) {
      var ph = (t % 1.6) / 1.6, beat = Math.max(Math.exp(-Math.pow((ph - 0.08) / 0.05, 2)), 0.7 * Math.exp(-Math.pow((ph - 0.28) / 0.06, 2)));
      var gr = g.createRadialGradient(L.W / 2, L.H / 2, L.H * 0.25, L.W / 2, L.H / 2, L.W * 0.75);
      var c = mix(L.c, [120, 0, 10], 0.5);
      gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(1, rgba(c, 0.5));
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = (0.25 + beat * 0.45) * L.k; g.fillStyle = gr; g.fillRect(0, 0, L.W, L.H);
      g.globalCompositeOperation = 'lighter';
    }
  };
  FX.scan = {
    init: function () { },
    step: function (L, g, dt, t) {
      var c = mix(L.c, [120, 220, 255], 0.5), y = (t * 40) % (L.H + 40) - 20;
      var gr = g.createLinearGradient(0, y - 18, 0, y + 2); gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(1, rgba(c, 0.35));
      g.globalAlpha = 0.6 * L.k; g.fillStyle = gr; g.fillRect(0, y - 18, L.W, 20);
      g.globalAlpha = 0.04 * L.k; g.fillStyle = rgba(c, 1);
      for (var yy = 0; yy < L.H; yy += 4) g.fillRect(0, yy, L.W, 1);
      // cercles d'interface qui tournent dans un coin
      g.strokeStyle = rgba(c, 1); g.lineWidth = 1; g.globalAlpha = 0.25 * L.k;
      var cx = L.W * 0.86, cy = L.H * 0.24;
      [[34, 1, 1.4], [26, -1.6, 0.9], [44, 0.6, 0.5]].forEach(function (r) {
        g.beginPath(); g.arc(cx, cy, r[0], t * r[1], t * r[1] + Math.PI * r[2]); g.stroke();
      });
    }
  };
  FX.portal = {
    init: function (L) { L.p = []; for (var i = 0; i < 60; i++) L.p.push({ a: rnd(0, PI2), d: 0, v: rnd(20, 60), life: rnd(0.4, 1.2), age: rnd(0, 1.2) }); },
    step: function (L, g, dt, t) {
      var cx = L.W * 0.8, cy = L.H * 0.35, R = L.H * 0.2, c = L.warmC;
      blit(g, soft(c), cx, cy, R * 1.6, 0.12 * L.k);
      for (var i = 0; i < L.p.length; i++) {
        var p = L.p[i]; p.age += dt;
        if (p.age > p.life) { p.a = t * 2.2 + rnd(0, PI2); p.age = 0; p.d = 0; p.v = rnd(20, 60); }
        var a = p.a + p.age * 0.6, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
        // étincelle projetée tangentiellement
        var tx = -Math.sin(a), ty = Math.cos(a); p.d += p.v * dt;
        x += tx * p.d; y += ty * p.d + p.age * p.age * 30;
        g.globalAlpha = (1 - p.age / p.life) * 0.9 * L.k; g.strokeStyle = rgba(mix(c, WHITE, 0.3), 1); g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - tx * 5, y - ty * 5); g.stroke();
      }
      g.globalAlpha = 0.6 * L.k; g.strokeStyle = rgba(c, 1); g.lineWidth = 1.4;
      g.beginPath(); g.arc(cx, cy, R, 0, PI2); g.stroke();
    }
  };
  FX.web = {
    init: function (L) { L.art = null; L.dust = FX.dust; FX.dust.init(L); },
    step: function (L, g, dt, t) {
      if (!L.art) L.art = makeWeb(L.W, L.H);
      g.save(); g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 0.85 * L.k; g.translate(Math.sin(t * 0.5) * 3, Math.sin(t * 0.37) * 2); g.drawImage(L.art, 0, 0); g.restore();
      g.globalCompositeOperation = 'lighter';
      FX.dust.step(L, g, dt, t);
    }
  };
  function makeWeb(W, H) {
    var s = canvas(W, H), x = s.getContext('2d');
    function web(cx, cy, R, a0, a1, spokes, rings, alpha) {
      var angs = [];
      for (var i = 0; i <= spokes; i++) angs.push(a0 + (a1 - a0) * i / spokes + rnd(-0.03, 0.03));
      x.lineWidth = 1; x.strokeStyle = 'rgba(235,238,245,' + alpha + ')';
      angs.forEach(function (a) { x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); x.stroke(); });
      for (var r = 1; r <= rings; r++) {
        var rr = R * Math.pow(r / rings, 1.15);
        x.strokeStyle = 'rgba(235,238,245,' + alpha * (1 - r / (rings + 3)) + ')'; x.beginPath();
        for (var k = 0; k < angs.length; k++) {
          var px = cx + Math.cos(angs[k]) * rr, py = cy + Math.sin(angs[k]) * rr;
          if (!k) x.moveTo(px, py); else { var pa = (angs[k - 1] + angs[k]) / 2, sag = rr * 0.86; x.quadraticCurveTo(cx + Math.cos(pa) * sag, cy + Math.sin(pa) * sag, px, py); }
        }
        x.stroke();
      }
    }
    web(W, 0, Math.min(W, H) * 0.62, Math.PI / 2, Math.PI, 12, 11, 0.3);
    web(0, H, Math.min(W, H) * 0.32, -Math.PI / 2, 0, 8, 7, 0.16);
    return s;
  }
  FX.grain = {
    init: function (L) { L.tiles = noiseTiles(); L.scratch = 0; },
    step: function (L, g, dt, t) {
      g.save(); g.globalCompositeOperation = 'source-over';
      var tile = L.tiles[Math.floor(t * 24) % 3];
      g.globalAlpha = 0.05 * L.k;
      var ox = Math.floor(Math.random() * 128), oy = Math.floor(Math.random() * 128);
      for (var x = -ox; x < L.W; x += 128) for (var y = -oy; y < L.H; y += 128) g.drawImage(tile, x, y);
      // scintillement de projection et rayure verticale occasionnelle
      g.globalAlpha = (0.03 + Math.random() * 0.03) * L.k; g.fillStyle = '#fff'; g.fillRect(0, 0, L.W, L.H);
      if (Math.random() < dt * 0.8) L.scratch = 0.25; L.scratch = Math.max(0, L.scratch - dt);
      if (L.scratch > 0) { g.globalAlpha = 0.25 * L.k; g.fillRect(L.W * (0.2 + Math.random() * 0.6), 0, 1, L.H); }
      g.restore(); g.globalCompositeOperation = 'lighter';
    }
  };

  /* ---------- Moteur ---------- */
  function layerOf(name, c, W, H) {
    var fx = FX[name]; if (!fx) return null;
    var L = { _fx: fx, name: name, W: W, H: H, c: c, k: 1 };
    L.tint = soft(c); L.white = soft(WHITE);
    L.warmC = mix(c, [255, 140, 50], 0.6); L.warm = soft(L.warmC);
    L.lime = soft(mix(c, [210, 255, 120], 0.6)); L.pink = mix(c, [255, 170, 200], 0.6);
    L.gold = soft([255, 214, 120]); L.sandC = mix(c, [225, 190, 140], 0.6); L.smoke = soft(mix(c, [170, 170, 180], 0.7));
    L.heart = heart(mix(c, [255, 70, 110], 0.5)); L.codeC = mix(c, [40, 255, 110], 0.75);
    fx.init(L);
    return L;
  }

  Onyx.Fx = {
    names: Object.keys(FX),
    has: function (n) { return !!FX[n]; },
    /* Crée un moteur sur un canevas ; set(recette, couleur) change d'ambiance en fondu */
    create: function (cv) {
      var g = cv.getContext('2d'), cur = [], old = [], fade = 1, running = false, last = 0, t0 = performance.now(), hidden = function () { return false; };
      function frame(now) {
        if (!running) return;
        requestAnimationFrame(frame);
        if (now - last < 33) return;
        var dt = Math.min(0.1, (now - last) / 1000); last = now;
        if (hidden()) return;
        var t = (now - t0) / 1000;
        fade = Math.min(1, fade + dt * 1.2);
        g.clearRect(0, 0, cv.width, cv.height);
        g.globalCompositeOperation = 'lighter';
        var i;
        for (i = 0; i < old.length; i++) { old[i].k = old[i].k0 * (1 - fade); if (old[i].k > 0.01) old[i]._fx.step(old[i], g, dt, t); }
        if (fade >= 1) old = [];
        for (i = 0; i < cur.length; i++) { cur[i].k = cur[i].k0 * fade; cur[i]._fx.step(cur[i], g, dt, t); }
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
        if (!cur.length && !old.length) { running = false; g.clearRect(0, 0, cv.width, cv.height); }
      }
      return {
        set: function (names, color, intensity) {
          old = cur.concat(old.filter(function (l) { return l.k > 0.02; })).slice(0, 3);
          old.forEach(function (l) { l.k0 = l.k; });
          fade = 0;
          var W = cv.width, H = cv.height;
          cur = (names || []).slice(0, 2).map(function (n, i) { var L = layerOf(n, color || WHITE, W, H); if (L) L.k0 = (intensity || 1) * (i ? 0.75 : 1); return L; }).filter(Boolean);
          if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
        },
        clear: function () { this.set([], null); },
        resize: function () { cur = cur.map(function (l) { var L = layerOf(l.name, l.c, cv.width, cv.height); L.k0 = l.k0; return L; }); old = []; },
        pauseWhen: function (fn) { hidden = fn; }
      };
    },
    hex: hex
  };
})();
