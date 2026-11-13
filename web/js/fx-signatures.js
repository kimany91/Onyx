/* Onyx — effets « signature » : une image culte de chaque grand film, évoquée en lumière
   (sans logo ni personnage) : fils de marionnette du Parrain, plume de Forrest Gump,
   ondes dans le verre d'eau de Jurassic Park, trou noir d'Interstellar, manteau rouge
   de La Liste de Schindler, Anneau incandescent, papillon de nuit du Silence des agneaux…
   + « spots » : lumières posées sur les vraies zones lumineuses de l'image de chaque film. */
(function () {
  'use strict';
  var Onyx = window.Onyx;
  if (!Onyx || !Onyx.Fx) return;
  var U = Onyx.Fx.util, rnd = U.rnd, rgba = U.rgba, mix = U.mix, vivid = U.vivid, soft = U.soft, blit = U.blit, field = U.field, fbm = U.fbm, vnoise = U.vnoise, FX = U.FX, WHITE = U.WHITE;
  var PI2 = Math.PI * 2;
  function reg(n, d) { Onyx.Fx.register(n, d); }
  function line(g, pts) { g.beginPath(); pts.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.stroke(); }

  /* Lumières de l'image : halos qui respirent sur les zones claires du fond du film */
  reg('spots', {
    init: function (L) { L.sp = (L.extra.spots || []).slice(0, 4).map(function (s) { return { x: s[0], y: s[1], w: s[2], c: s[3], ph: rnd(0, 6) }; }); },
    step: function (L, g, dt, t) {
      L.sp.forEach(function (s) {
        var a = (0.16 + 0.08 * Math.sin(t * 0.8 + s.ph)) * L.k * s.w, x = s.x * L.W, y = s.y * L.H;
        blit(g, soft(s.c), x, y, L.H * 0.32, a);
        blit(g, soft(mix(s.c, WHITE, 0.6), 0.2), x, y, L.H * 0.05, a * 1.4);
      });
    }
  });

  /* Le Parrain : fils de marionnette éclairés par le haut */
  reg('strings', {
    init: function (L) { L.s = [0.18, 0.31, 0.46, 0.62, 0.78].map(function (x) { return { x: x + rnd(-0.03, 0.03), ph: rnd(0, 6), len: rnd(0.55, 0.85) }; }); },
    step: function (L, g, dt, t) {
      var c = mix(vivid(L.c), [255, 214, 160], 0.6);
      blit(g, soft(c), L.W * 0.5, -L.H * 0.1, L.H * 0.9, 0.22 * L.k);
      g.lineCap = 'round';
      L.s.forEach(function (s) {
        var x0 = s.x * L.W, sway = Math.sin(t * 0.55 + s.ph) * 26 * L.S, len = s.len * L.H;
        var gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, rgba(c, 0.9)); gr.addColorStop(1, rgba(c, 0));
        g.strokeStyle = gr; g.lineWidth = 1 * L.S; g.globalAlpha = 0.7 * L.k;
        g.beginPath(); g.moveTo(x0, 0); g.quadraticCurveTo(x0 + sway * 0.4, len * 0.5, x0 + sway, len); g.stroke();
        g.globalAlpha = 0.18 * L.k; g.lineWidth = 4 * L.S; g.stroke();
      });
    }
  });
  /* The Truman Show : ciel peint qui dérive + projecteur de studio qui tombe */
  reg('clouds', {
    init: function (L) { L.f = field(L, function (x, y, t) { return Math.max(0, fbm(x * 2.2 + t * 0.03, y * 3.4) - 0.5) * 1.4 * Math.max(0, 0.75 - y); }); },
    step: function (L, g, dt, t) { L.f(g, t, [245, 248, 255]); }
  });
  reg('studiolight', {
    init: function (L) { L.y = -1; L.next = rnd(2, 5); },
    step: function (L, g, dt, t) {
      L.next -= dt;
      if (L.next <= 0 && L.y < 0) { L.y = 0; L.x = rnd(0.55, 0.85) * L.W; L.v = 0; }
      if (L.y >= 0) {
        L.v += 900 * L.S * dt; L.y += L.v * dt;
        var x = L.x, y = L.y;
        g.lineCap = 'round'; g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.4 * L.S; g.globalAlpha = 0.6 * L.k;
        g.beginPath(); g.moveTo(x, y - 60 * L.S); g.lineTo(x, y); g.stroke();
        blit(g, U.glint([255, 250, 230]), x, y, 30 * L.S, L.k);
        blit(g, soft([255, 240, 200]), x, y, 120 * L.S, 0.3 * L.k);
        if (y > L.H + 40) { L.y = -1; L.next = rnd(7, 12); }
      }
    }
  });
  /* Interstellar : trou noir, disque d'accrétion et anneau de lumière déviée */
  reg('blackhole', {
    init: function () { },
    step: function (L, g, dt, t) {
      var cx = L.W * 0.86, cy = L.H * 0.17, R = L.H * 0.042, c = [255, 214, 160];
      blit(g, soft(c), cx, cy, R * 6, 0.22 * L.k);
      g.save(); g.translate(cx, cy);
      // disque (vu par la tranche) : plus lumineux du côté qui s'approche
      for (var i = 0; i < 3; i++) {
        var gr = g.createLinearGradient(-R * 3.4, 0, R * 3.4, 0);
        gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.25, rgba(mix(c, WHITE, 0.4), 0.9)); gr.addColorStop(0.5, rgba(c, 0.25)); gr.addColorStop(0.75, rgba(c, 0.55)); gr.addColorStop(1, rgba(c, 0));
        g.strokeStyle = gr; g.globalAlpha = (i ? 0.25 : 0.85) * L.k; g.lineWidth = (i ? 9 : 2.4) * L.S;
        g.beginPath(); g.ellipse(0, 0, R * (2.6 + i * 0.25), R * 0.42, Math.sin(t * 0.1) * 0.03, 0, PI2); g.stroke();
      }
      // anneau courbé par la gravité (au-dessus et en dessous de la sphère)
      g.strokeStyle = rgba(mix(c, WHITE, 0.5), 1); g.lineWidth = 2 * L.S; g.globalAlpha = 0.75 * L.k;
      g.beginPath(); g.arc(0, 0, R * 1.18, 0, PI2); g.stroke();
      g.globalAlpha = 0.2 * L.k; g.lineWidth = 8 * L.S; g.stroke();
      // ombre du trou noir
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.85 * L.k;
      var sh = g.createRadialGradient(0, 0, R * 0.7, 0, 0, R * 1.02); sh.addColorStop(0, '#000'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sh; g.beginPath(); g.arc(0, 0, R * 1.02, 0, PI2); g.fill();
      g.restore(); g.globalCompositeOperation = 'lighter';
    }
  });
  /* Jurassic Park / Jaws : ondes concentriques, au rythme de pas lourds */
  reg('ripples', {
    init: function (L) { L.r = []; L.next = 1; },
    step: function (L, g, dt, t) {
      L.next -= dt;
      if (L.next <= 0) { L.r.push({ age: 0 }); L.next = L.r.length % 2 ? 0.55 : 2.4; }
      var cx = L.W * 0.5, cy = L.H * 0.86, c = mix(vivid(L.c), [200, 230, 255], 0.6);
      L.r = L.r.filter(function (r) { r.age += dt; return r.age < 2.6; });
      L.r.forEach(function (r) {
        for (var k = 0; k < 3; k++) {
          var a = r.age - k * 0.16; if (a <= 0) continue;
          var rad = a * 230 * L.S, f = Math.max(0, 1 - a / 2.4);
          g.strokeStyle = rgba(c, 1); g.lineWidth = (1.6 - k * 0.4) * L.S; g.globalAlpha = f * (0.55 - k * 0.15) * L.k;
          g.beginPath(); g.ellipse(cx, cy, rad, rad * 0.22, 0, 0, PI2); g.stroke();
        }
      });
    }
  });
  /* Pulp Fiction : lueur dorée qui sort de la mallette */
  reg('briefcase', {
    init: function (L) { L.f = field(L, function (x, y, t) { var dx = x - 0.5, dy = 1.02 - y, ang = Math.atan2(dx, dy); if (Math.abs(ang) > 0.9) return 0; return Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 1.4) * (0.5 + 0.5 * vnoise(ang * 14, t * 0.4)) * 0.9; }); },
    step: function (L, g, dt, t) {
      L.f(g, t, [255, 206, 110]);
      blit(g, soft([255, 214, 130], 0.2), L.W * 0.5, L.H * 1.0, L.H * (0.32 + 0.03 * Math.sin(t * 3)), 0.8 * L.k);
    }
  });
  /* Forrest Gump : la plume qui flotte au vent */
  function feather(c) {
    var s = U.canvas(160, 60), x = s.getContext('2d');
    x.strokeStyle = rgba(c, 0.9); x.lineCap = 'round';
    for (var i = 0; i < 44; i++) {
      var u = i / 44, px = 10 + u * 140, w = Math.sin(u * Math.PI) * 22 * (1 - u * 0.3);
      x.globalAlpha = 0.55 + 0.4 * Math.random(); x.lineWidth = 0.9;
      x.beginPath(); x.moveTo(px, 30); x.quadraticCurveTo(px + 6, 30 - w * 0.6, px + 10, 30 - w); x.stroke();
      x.beginPath(); x.moveTo(px, 30); x.quadraticCurveTo(px + 6, 30 + w * 0.6, px + 10, 30 + w); x.stroke();
    }
    x.globalAlpha = 1; x.lineWidth = 1.6; x.strokeStyle = 'rgba(255,255,255,1)'; x.beginPath(); x.moveTo(2, 30); x.lineTo(150, 30); x.stroke();
    return s;
  }
  reg('feather', {
    init: function (L) { L.img = feather([250, 248, 240]); L.x = L.W * 0.1; L.y = L.H * 0.15; L.a = 0; },
    step: function (L, g, dt, t) {
      L.x += (22 + Math.sin(t * 0.3) * 14) * L.S * dt; L.y += (10 + Math.sin(t * 0.9) * 26) * L.S * dt;
      if (L.x > L.W + 100 || L.y > L.H + 60) { L.x = -100; L.y = rnd(0.05, 0.4) * L.H; }
      var rot = Math.sin(t * 0.7) * 0.5 + Math.sin(t * 1.9) * 0.12, w = 120 * L.S;
      g.save(); g.globalCompositeOperation = 'source-over'; g.translate(L.x, L.y); g.rotate(rot); g.scale(1, 0.8 + 0.2 * Math.sin(t * 1.3));
      g.globalAlpha = 0.85 * L.k; g.drawImage(L.img, -w / 2, -w * 0.19, w, w * 0.375); g.restore();
      blit(g, soft([255, 246, 220]), L.x, L.y, 70 * L.S, 0.12 * L.k);
    }
  });
  /* The Dark Knight : un projecteur fin qui monte vers des nuages bas éclairés */
  reg('signal', {
    init: function (L) { L.f = field(L, function (x, y, t) {
      var cloud = Math.max(0, fbm(x * 3 + t * 0.04, y * 5) - 0.42) * Math.max(0, 0.42 - y) * 3;
      var dx = (x - 0.7) * 1.6, dy = (y - 0.16) * 3.2, d = Math.sqrt(dx * dx + dy * dy), disc = Math.exp(-d * d * 30);
      var bx = 0.7 + (y - 0.16) * 0.18, bw = 0.006 + Math.max(0, y - 0.16) * 0.03;
      var beam = y > 0.16 ? Math.exp(-Math.pow((x - bx) / bw, 2)) * 0.22 * (1 - y * 0.6) : 0;
      return cloud * 0.5 + disc * (0.35 + cloud * 1.5) + beam;
    }); },
    step: function (L, g, dt, t) { L.f(g, t, [226, 232, 245]); }
  });
  /* Retour vers le futur : deux traînées de feu continues, en perspective, qui brûlent puis s'éteignent */
  reg('firetrails', {
    init: function (L) { L.age = rnd(0, 2); },
    step: function (L, g, dt, t) {
      L.age += dt; if (L.age > 5) L.age = 0;
      var prog = Math.min(1, L.age / 0.5), fade = Math.max(0, 1 - Math.max(0, L.age - 0.5) / 4);
      if (fade <= 0) return;
      var vx = L.W * 0.47, vy = L.H * 0.5; // point de fuite (lointain : les traces restent parallèles)
      [[0.36, 1.02], [0.6, 1.02]].forEach(function (st) {
        var x0 = L.W * st[0], y0 = L.H * st[1];
        g.lineCap = 'round';
        // flamme : plusieurs passes du plus large/diffus au plus fin/brûlant
        [[26, 0.10, [255, 90, 20]], [11, 0.28, [255, 140, 40]], [4, 0.6, [255, 200, 90]], [1.6, 0.9, [255, 245, 210]]].forEach(function (pass) {
          g.beginPath();
          var n = 30;
          for (var i = 0; i <= n * prog * 0.62; i++) {
            var u = i / n, x = x0 + (vx - x0) * u, y = y0 + (vy - y0) * u, fl = (vnoise(u * 18, t * 5 + st[0] * 9) - 0.5) * 10 * L.S * (1 - u);
            if (!i) g.moveTo(x, y + fl); else g.lineTo(x, y - Math.abs(fl));
          }
          g.strokeStyle = rgba(pass[2], 1); g.lineWidth = pass[0] * L.S; g.globalAlpha = pass[1] * fade * L.k;
          g.stroke();
        });
      });
    }
  });
  /* Inception : pluie suspendue dans le temps (gouttes presque immobiles) */
  reg('suspended', {
    init: function (L) { L.p = []; for (var i = 0; i < 90; i++) L.p.push({ x: rnd(0, L.W), y: rnd(0, L.H), z: Math.random(), ph: rnd(0, 6) }); },
    step: function (L, g, dt, t) {
      var c = mix(vivid(L.c), [210, 225, 245], 0.7);
      L.p.forEach(function (p) {
        p.y += (3 + p.z * 6) * L.S * dt; if (p.y > L.H + 10) p.y = -10;
        var len = (6 + p.z * 14) * L.S, a = (0.25 + p.z * 0.5) * L.k;
        var gr = g.createLinearGradient(p.x, p.y - len, p.x, p.y); gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(1, rgba(c, 0.9));
        g.strokeStyle = gr; g.globalAlpha = a; g.lineWidth = (0.7 + p.z) * L.S; g.lineCap = 'round';
        g.beginPath(); g.moveTo(p.x, p.y - len); g.lineTo(p.x, p.y); g.stroke();
        blit(g, U.glint([235, 240, 255]), p.x, p.y, (2 + p.z * 4) * L.S, a * (0.5 + 0.5 * Math.sin(t * 2 + p.ph)));
      });
    }
  });
  /* Gladiator : épis de blé à contre-jour, caressés par le vent */
  reg('wheat', {
    init: function (L) { L.s = []; for (var i = 0; i < 70; i++) L.s.push({ x: rnd(-0.02, 1.02), h: rnd(0.12, 0.26), ph: rnd(0, 6), z: Math.random() }); L.s.sort(function (a, b) { return a.z - b.z; }); },
    step: function (L, g, dt, t) {
      var c = [255, 206, 120];
      blit(g, soft(c), L.W * 0.3, L.H * 1.02, L.H * 0.7, 0.28 * L.k);
      g.lineCap = 'round';
      L.s.forEach(function (s) {
        var x = s.x * L.W, base = L.H + 4, h = s.h * L.H * (0.7 + s.z * 0.6), bend = (Math.sin(t * 0.9 + s.x * 6) * 0.5 + 0.5) * 30 * L.S * (0.5 + s.z);
        var tx = x + bend, ty = base - h;
        g.strokeStyle = rgba(mix(c, [120, 80, 30], 0.5 - s.z * 0.3), 1); g.globalAlpha = (0.35 + s.z * 0.5) * L.k; g.lineWidth = (0.8 + s.z * 1.2) * L.S;
        g.beginPath(); g.moveTo(x, base); g.quadraticCurveTo(x, base - h * 0.5, tx, ty); g.stroke();
        // épi : grains lumineux en contre-jour
        for (var k = 0; k < 6; k++) blit(g, soft(c, 0.2), tx + (bend / h) * k * 6 * L.S, ty + k * 5 * L.S, (2.4 + s.z * 2) * L.S, (0.3 + s.z * 0.5) * L.k);
      });
    }
  });
  /* Fight Club : images subliminales (éclairs d'une image, décalage de couleur) */
  reg('subliminal', {
    init: function (L) { L.next = rnd(3, 7); L.on = 0; },
    step: function (L, g, dt) {
      L.next -= dt; if (L.next <= 0) { L.on = 0.07; L.next = rnd(5, 11); L.y = rnd(0.2, 0.8); }
      if (L.on > 0) {
        L.on -= dt;
        g.globalAlpha = 0.12 * L.k; g.fillStyle = 'rgb(255,60,90)'; g.fillRect(0, 0, L.W, L.H);
        g.globalAlpha = 0.35 * L.k; g.fillStyle = 'rgb(80,220,255)'; g.fillRect(0, L.H * L.y, L.W, 3 * L.S);
        g.fillStyle = 'rgb(255,80,120)'; g.fillRect(4 * L.S, L.H * L.y + 5 * L.S, L.W, 2 * L.S);
      }
    }
  });
  /* Les Aventuriers de l'arche perdue : rai de lumière du temple, poussière dorée dedans */
  reg('templebeam', {
    init: function (L) { L.f = field(L, function (x, y, t) { var cx = 0.22 + y * 0.32, w = 0.06 + y * 0.05; return Math.max(0, 1 - Math.abs(x - cx) / w) * (0.6 + 0.4 * fbm(x * 6, y * 6 - t * 0.1)) * 0.7 * (1 - y * 0.4); });
      L.d = []; for (var i = 0; i < 60; i++) L.d.push({ y: rnd(0, 1), o: rnd(-1, 1), ph: rnd(0, 6), z: Math.random() }); },
    step: function (L, g, dt, t) {
      L.f(g, t, [255, 222, 150]);
      L.d.forEach(function (p) {
        p.y += 0.012 * dt; if (p.y > 1) p.y = 0;
        var cx = (0.22 + p.y * 0.32) * L.W, w = (0.06 + p.y * 0.05) * L.W, x = cx + p.o * w * 0.8 + Math.sin(t * 0.5 + p.ph) * 6 * L.S;
        blit(g, U.glint([255, 230, 170]), x, p.y * L.H, (1.5 + p.z * 3) * L.S, (0.3 + 0.7 * Math.pow(Math.abs(Math.sin(t + p.ph)), 4)) * L.k);
      });
    }
  });
  /* Le Silence des agneaux : papillon de nuit qui volette */
  function moth() {
    var s = U.canvas(200, 140), x = s.getContext('2d');
    function wing(sx) {
      x.save(); x.translate(100, 66); x.scale(sx, 1);
      var g1 = x.createRadialGradient(30, -10, 4, 30, -10, 70); g1.addColorStop(0, 'rgba(214,190,150,0.95)'); g1.addColorStop(0.6, 'rgba(120,96,70,0.95)'); g1.addColorStop(1, 'rgba(60,46,34,0.9)');
      x.fillStyle = g1; x.beginPath(); x.moveTo(4, -6); x.bezierCurveTo(30, -46, 92, -40, 92, -8); x.bezierCurveTo(80, 8, 40, 10, 4, 4); x.fill();
      var g2 = x.createRadialGradient(24, 24, 2, 24, 24, 40); g2.addColorStop(0, 'rgba(232,170,80,0.95)'); g2.addColorStop(1, 'rgba(90,60,30,0.95)');
      x.fillStyle = g2; x.beginPath(); x.moveTo(4, 4); x.bezierCurveTo(30, 6, 62, 22, 50, 46); x.bezierCurveTo(30, 54, 10, 30, 4, 10); x.fill();
      x.restore();
    }
    wing(1); wing(-1);
    var gb = x.createLinearGradient(94, 50, 106, 100); gb.addColorStop(0, 'rgba(70,52,38,1)'); gb.addColorStop(1, 'rgba(30,22,16,1)');
    x.fillStyle = gb; x.beginPath(); x.ellipse(100, 76, 7, 26, 0, 0, PI2); x.fill();
    x.fillStyle = 'rgba(230,214,180,0.9)'; x.beginPath(); x.ellipse(100, 62, 5, 6, 0, 0, PI2); x.fill();
    return s;
  }
  reg('moth', {
    init: function (L) { L.img = moth(); },
    step: function (L, g, dt, t) {
      var x = L.W * (0.72 + Math.sin(t * 0.23) * 0.08), y = L.H * (0.28 + Math.sin(t * 0.37) * 0.06), flap = 0.55 + 0.45 * Math.abs(Math.sin(t * 7)), w = 80 * L.S;
      blit(g, soft([255, 224, 170]), x, y, 160 * L.S, 0.14 * L.k);
      g.save(); g.globalCompositeOperation = 'source-over'; g.translate(x, y); g.rotate(Math.sin(t * 0.8) * 0.15); g.scale(flap, 1);
      g.globalAlpha = 0.9 * L.k; g.drawImage(L.img, -w / 2, -w * 0.35, w, w * 0.7); g.restore();
    }
  });
  /* La Liste de Schindler : noir et blanc, une seule lumière rouge qui dérive */
  reg('redcoat', {
    mood: 'mono',
    init: function (L) { L.x = 0.3; L.y = 0.7; },
    step: function (L, g, dt, t) {
      var x = L.W * (0.3 + Math.sin(t * 0.06) * 0.2), y = L.H * (0.72 + Math.sin(t * 0.21) * 0.04);
      blit(g, soft([220, 20, 40]), x, y, 70 * L.S, 0.45 * L.k);
      blit(g, soft([255, 60, 70], 0.2), x, y, 9 * L.S, 0.9 * L.k);
    }
  });
  /* Le Seigneur des anneaux : l'Anneau doré et son inscription de feu */
  reg('ring', {
    init: function () { },
    step: function (L, g, dt, t) {
      var cx = L.W * 0.86, cy = L.H * 0.18, R = L.H * 0.06, tilt = 0.32 + Math.sin(t * 0.4) * 0.05;
      blit(g, soft([255, 170, 60]), cx, cy, R * 3.4, 0.22 * L.k);
      g.save(); g.translate(cx, cy); g.rotate(Math.sin(t * 0.2) * 0.1);
      var gr = g.createLinearGradient(-R, -R, R, R); gr.addColorStop(0, 'rgba(255,236,170,1)'); gr.addColorStop(0.5, 'rgba(210,150,50,1)'); gr.addColorStop(1, 'rgba(255,220,140,1)');
      g.strokeStyle = gr; g.globalAlpha = 0.9 * L.k; g.lineWidth = R * 0.16;
      g.beginPath(); g.ellipse(0, 0, R, R * tilt, 0, 0, PI2); g.stroke();
      // inscription : petits traits de feu qui défilent sur l'anneau
      g.lineWidth = 1.4 * L.S; g.strokeStyle = 'rgba(255,120,40,1)';
      for (var i = 0; i < 26; i++) {
        var a = i / 26 * PI2 + t * 0.25, x = Math.cos(a) * R, y = Math.sin(a) * R * tilt;
        g.globalAlpha = (0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i))) * L.k * (Math.sin(a) > 0 ? 1 : 0.35);
        g.beginPath(); g.moveTo(x - 3 * L.S, y); g.quadraticCurveTo(x, y - 3 * L.S, x + 3 * L.S, y); g.stroke();
      }
      g.restore();
    }
  });
  /* Le Retour du roi : l'Œil de feu */
  reg('eye', {
    init: function (L) { L.f = field(L, function (x, y, t) { var dx = (x - 0.86) * 1.8, dy = y - 0.18, d = Math.sqrt(dx * dx + dy * dy); return Math.max(0, 0.12 - d) * 8 * (0.6 + 0.4 * fbm(Math.atan2(dy, dx) * 3 + t * 0.8, d * 20 - t * 1.5)); }); },
    step: function (L, g, dt, t) {
      L.f(g, t, [255, 120, 30]);
      var cx = L.W * 0.86, cy = L.H * 0.18, h = L.H * 0.045;
      g.save(); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.85 * L.k; g.fillStyle = '#120400';
      g.beginPath(); g.ellipse(cx, cy, h * 0.12 * (0.8 + 0.2 * Math.sin(t)), h, 0, 0, PI2); g.fill(); g.restore();
    }
  });
  /* Terminator 2 : métal liquide (reflets chromés qui ondulent) */
  reg('chrome', {
    init: function (L) { L.f = field(L, function (x, y, t) { var n = fbm(x * 2.2 + t * 0.12, y * 2.2 - t * 0.08), b = Math.sin(n * 11); return Math.pow(Math.max(0, b), 16) * 0.32 * Math.max(0, y - 0.25) * 1.4; }); },
    step: function (L, g, dt, t) { L.f(g, t, [220, 232, 245]); }
  });
  /* Il faut sauver le soldat Ryan : balles traçantes au loin */
  reg('tracers', {
    init: function (L) { L.p = []; },
    step: function (L, g, dt) {
      if (Math.random() < dt * 3) { var y = rnd(0.2, 0.6) * L.H; L.p.push({ x: -20, y: y, vx: rnd(700, 1100) * L.S, vy: rnd(-60, 30) * L.S }); }
      g.lineCap = 'round';
      L.p = L.p.filter(function (p) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        var gr = g.createLinearGradient(p.x - 60 * L.S, p.y, p.x, p.y); gr.addColorStop(0, 'rgba(255,150,60,0)'); gr.addColorStop(1, 'rgba(255,220,150,1)');
        g.strokeStyle = gr; g.globalAlpha = 0.7 * L.k; g.lineWidth = 1.4 * L.S;
        g.beginPath(); g.moveTo(p.x - 60 * L.S, p.y - p.vy * 0.06); g.lineTo(p.x, p.y); g.stroke();
        return p.x < L.W + 80;
      });
    }
  });
  /* Seven : faisceaux de lampes torches dans la pénombre */
  reg('flashlights', {
    init: function (L) { L.f = field(L, function (x, y, t) {
      var v = 0;
      for (var i = 0; i < 2; i++) {
        var ox = i ? 0.15 : 0.85, oy = 0.95, a = (i ? -0.7 : 0.7) + Math.sin(t * 0.4 + i * 3) * 0.35, dx = x - ox, dy = oy - y;
        var ang = Math.atan2(dx, dy) - a, d = Math.sqrt(dx * dx + dy * dy);
        v += Math.max(0, 1 - Math.abs(ang) / 0.16) * Math.max(0, 1 - d * 0.9) * (0.6 + 0.4 * fbm(x * 5, y * 5 + t * 0.2));
      }
      return v * 0.5;
    }); },
    step: function (L, g, dt, t) { L.f(g, t, [240, 236, 214]); }
  });
  /* Léon / films noirs : lumière à travers des stores */
  reg('blinds', {
    init: function () { },
    step: function (L, g, dt, t) {
      var c = mix(vivid(L.c), [255, 226, 180], 0.6), off = Math.sin(t * 0.12) * 20 * L.S;
      g.save(); g.translate(L.W * 0.55 + off, -L.H * 0.1); g.rotate(-0.32);
      for (var i = 0; i < 9; i++) {
        var y = i * 34 * L.S, gr = g.createLinearGradient(0, 0, L.W * 0.7, 0);
        gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.3, rgba(c, 0.5)); gr.addColorStop(1, rgba(c, 0));
        g.fillStyle = gr; g.globalAlpha = 0.18 * L.k; g.fillRect(0, y, L.W * 0.7, 18 * L.S);
      }
      g.restore();
    }
  });
  /* Shining : motif hexagonal du tapis de l'hôtel, en perspective */
  reg('carpet', {
    init: function () { },
    step: function (L, g, dt, t) {
      g.save(); g.globalAlpha = 0.16 * L.k; g.strokeStyle = 'rgb(255,120,60)'; g.lineWidth = 1.4 * L.S;
      var hy = L.H * 0.62, rows = 9;
      for (var r = 0; r < rows; r++) {
        var y0 = hy + Math.pow(r / rows, 1.7) * (L.H - hy) * 1.2, sc = 0.25 + r / rows * 1.6, w = 46 * L.S * sc;
        for (var x = -w + ((t * 6 * L.S * sc) % (w * 2)); x < L.W + w; x += w * 2) {
          var cx = L.W / 2 + (x - L.W / 2) * (0.4 + r / rows), h = w * 0.35;
          g.beginPath(); g.moveTo(cx - w * 0.5, y0); g.lineTo(cx - w * 0.25, y0 - h); g.lineTo(cx + w * 0.25, y0 - h); g.lineTo(cx + w * 0.5, y0); g.lineTo(cx + w * 0.25, y0 + h); g.lineTo(cx - w * 0.25, y0 + h); g.closePath(); g.stroke();
        }
      }
      g.restore();
    }
  });
  /* Alien : détecteur de mouvement (balayage et écho) */
  reg('tracker', {
    init: function (L) { L.blip = rnd(0, 6); },
    step: function (L, g, dt, t) {
      var cx = L.W * 0.12, cy = L.H * 0.82, R = L.H * 0.22, ph = (t % 2.2) / 2.2, c = [120, 255, 170];
      for (var k = 1; k <= 3; k++) { g.strokeStyle = rgba(c, 1); g.globalAlpha = 0.12 * L.k; g.lineWidth = 1 * L.S; g.beginPath(); g.arc(cx, cy, R * k / 3, -Math.PI * 0.95, -Math.PI * 0.05); g.stroke(); }
      g.globalAlpha = (1 - ph) * 0.5 * L.k; g.lineWidth = 2 * L.S; g.beginPath(); g.arc(cx, cy, R * ph, -Math.PI * 0.95, -Math.PI * 0.05); g.stroke();
      var a = -Math.PI / 2 + Math.sin(t * 0.3 + L.blip) * 0.8, d = R * (0.55 + 0.2 * Math.sin(t * 0.17));
      blit(g, soft(c, 0.2), cx + Math.cos(a) * d, cy + Math.sin(a) * d, 12 * L.S, (ph < 0.15 ? 1 : 0.4) * L.k);
    }
  });
  /* Taxi Driver : vapeur qui monte des bouches d'égout */
  reg('steam', {
    init: function (L) { L.f = field(L, function (x, y, t) { var col = Math.max(0, 1 - Math.abs(x - 0.32) / 0.12) + Math.max(0, 1 - Math.abs(x - 0.7) / 0.09) * 0.8; return col * Math.max(0, fbm(x * 5, y * 4 + t * 0.35) - 0.35) * 1.4 * y; }); },
    step: function (L, g, dt, t) { L.f(g, t, [230, 230, 236]); }
  });
  /* Psychose : douche (filets d'eau en diagonale), noir et blanc */
  reg('shower', {
    mood: 'mono',
    init: function (L) { L.p = []; for (var i = 0; i < 70; i++) L.p.push({ t: Math.random(), o: rnd(-1, 1), v: rnd(0.5, 0.9) }); },
    step: function (L, g, dt) {
      var sx = L.W * 0.85, sy = -L.H * 0.05;
      g.lineCap = 'round'; g.strokeStyle = 'rgba(230,236,245,1)';
      L.p.forEach(function (p) {
        p.t += p.v * dt; if (p.t > 1) p.t = 0;
        var ang = Math.PI * 0.62 + p.o * 0.22, d = p.t * L.H * 1.3, x = sx + Math.cos(ang) * d, y = sy + Math.sin(ang) * d;
        g.globalAlpha = 0.35 * (1 - p.t) * L.k; g.lineWidth = 1 * L.S;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.cos(ang) * 18 * L.S, y - Math.sin(ang) * 18 * L.S); g.stroke();
      });
      blit(g, soft([235, 240, 250]), sx, sy + 20 * L.S, 140 * L.S, 0.2 * L.k);
    }
  });
  /* 2001 : le monolithe et l'alignement lumineux */
  reg('monolith', {
    init: function () { },
    step: function (L, g, dt, t) {
      var x = L.W * 0.88, top = L.H * 0.42, w = L.H * 0.05, h = L.H * 0.6;
      var sx = x, sy = top - L.H * 0.02, pulse = 0.85 + 0.15 * Math.sin(t * 0.6);
      blit(g, soft([255, 240, 210]), sx, sy, L.H * 0.5, 0.3 * pulse * L.k);
      blit(g, U.glint([255, 250, 235]), sx, sy, L.H * 0.12, 0.9 * pulse * L.k);
      g.save(); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.9 * L.k;
      var gr = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0); gr.addColorStop(0, '#050506'); gr.addColorStop(0.5, '#141418'); gr.addColorStop(1, '#030304');
      g.fillStyle = gr; g.fillRect(x - w / 2, top, w, h); g.restore();
    }
  });
  /* Apocalypse Now : ombres de pales d'hélicoptère qui balayent un ciel orange */
  reg('rotor', {
    init: function () { },
    step: function (L, g, dt, t) {
      blit(g, soft([255, 140, 50]), L.W * 0.7, L.H * 0.3, L.H * 1.1, 0.25 * L.k);
      g.save(); g.globalCompositeOperation = 'source-over'; g.translate(L.W * 0.62, -L.H * 0.4);
      g.rotate(t * 2.2);
      for (var i = 0; i < 2; i++) { g.rotate(Math.PI); g.globalAlpha = 0.16 * L.k; g.fillStyle = '#000'; g.fillRect(0, -L.H * 0.03, L.W * 1.4, L.H * 0.06); }
      g.restore();
    }
  });
  /* Lumières de ville qui défilent (trajet de nuit) */
  reg('citylights', {
    init: function (L) { L.p = []; for (var i = 0; i < 26; i++) L.p.push({ x: rnd(0, L.W), y: rnd(0.45, 0.95), r: rnd(10, 46), c: [[255, 190, 110], [255, 230, 200], [255, 80, 70], [120, 180, 255]][Math.floor(rnd(0, 4))], v: rnd(40, 120) }); },
    step: function (L, g, dt) {
      L.p.forEach(function (p) {
        p.x -= p.v * L.S * dt * (p.r / 30); if (p.x < -60) { p.x = L.W + 60; p.y = rnd(0.45, 0.95); }
        g.globalAlpha = 0.22 * L.k; var r = p.r * L.S; g.drawImage(U.bokeh(p.c), p.x - r, p.y * L.H - r, r * 2, r * 2);
      });
    }
  });
  /* Le Prestige : arcs électriques entre deux bobines */
  reg('tesla', {
    init: function (L) { L.t = 0; },
    step: function (L, g, dt, t) {
      var ax = L.W * 0.66, bx = L.W * 0.9, y = L.H * 0.3, c = [150, 200, 255];
      blit(g, soft(c), ax, y, 60 * L.S, 0.4 * L.k); blit(g, soft(c), bx, y, 60 * L.S, 0.4 * L.k);
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (var k = 0; k < 3; k++) {
        var pts = [[ax, y]], n = 12;
        for (var i = 1; i < n; i++) pts.push([ax + (bx - ax) * i / n, y + Math.sin(i / n * Math.PI) * rnd(-40, 20) * L.S + rnd(-8, 8) * L.S]);
        pts.push([bx, y]);
        g.strokeStyle = rgba(c, 1); g.globalAlpha = 0.18 * L.k; g.lineWidth = 6 * L.S; line(g, pts);
        g.strokeStyle = 'rgba(235,245,255,1)'; g.globalAlpha = 0.7 * L.k * Math.random(); g.lineWidth = 1.2 * L.S; line(g, pts);
      }
    }
  });
  /* Whiplash : projecteur de scène en douche de lumière */
  reg('stage', {
    init: function (L) { L.f = field(L, function (x, y, t) { var w = 0.06 + y * 0.16, v = Math.max(0, 1 - Math.abs(x - 0.66) / w); return v * v * (0.55 + 0.45 * fbm(x * 8, y * 6 - t * 0.2)) * 0.7; }); },
    step: function (L, g, dt, t) { L.f(g, t, [255, 222, 170]); blit(g, soft([255, 230, 180]), L.W * 0.66, L.H * 0.96, L.H * 0.3, 0.3 * L.k); }
  });
  /* Maman, j'ai raté l'avion : guirlande de Noël floue */
  reg('xmaslights', {
    init: function (L) { L.n = []; for (var i = 0; i < 18; i++) L.n.push({ x: i / 17, c: [[255, 70, 60], [80, 220, 120], [255, 200, 80], [90, 150, 255]][i % 4], ph: rnd(0, 6) }); },
    step: function (L, g, dt, t) {
      L.n.forEach(function (n) {
        var x = n.x * L.W, y = (0.08 + Math.sin(n.x * Math.PI) * 0.08) * L.H, r = 26 * L.S, a = (0.5 + 0.5 * Math.sin(t * 1.4 + n.ph)) * L.k;
        g.globalAlpha = 0.35 * a; g.drawImage(U.bokeh(n.c), x - r, y - r, r * 2, r * 2);
        blit(g, soft(n.c, 0.2), x, y, 7 * L.S, a);
      });
    }
  });
})();
