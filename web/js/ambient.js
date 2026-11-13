/* Onyx — ambiance du film sélectionné + animation de lancement.
   - Couleurs : extraites de l'image du film (couleur vive + couleur profonde),
     elles teintent la lumière de fond de tout l'écran.
   - Effets : un décor animé discret choisi selon le film (toiles d'araignée pour
     Spider-Man, braises pour l'action, étoiles pour la science-fiction, neige pour
     Noël, pluie pour les polars, brume pour l'horreur…).
   - Lancement : comme sur une console, l'image du film s'ouvre en plein écran,
     le logo apparaît dans un éclat de lumière, pendant que le chargement a déjà commencé. */
(function () {
  'use strict';
  var Onyx = window.Onyx = window.Onyx || {};
  function setting(k) { try { return Onyx.settings ? Onyx.settings.get(k) !== false : true; } catch (e) { return true; } }
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Couleurs de l'image ---------- */
  var palCache = {};
  function hsv(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, hh = 0;
    if (d) { if (mx === r) hh = ((g - b) / d) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4; }
    return [(hh * 60 + 360) % 360, mx ? d / mx : 0, mx / 255];
  }
  function rgbOfHsv(h, s, v) {
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function palette(url) {
    if (palCache[url]) return Promise.resolve(palCache[url]);
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var w = 32, hgt = 18, cv = document.createElement('canvas');
          cv.width = w; cv.height = hgt;
          var g = cv.getContext('2d');
          g.drawImage(img, 0, 0, w, hgt);
          var d = g.getImageData(0, 0, w, hgt).data;
          // histogramme de teintes pondéré par saturation × luminosité
          var bins = [], dark = [0, 0, 0, 0];
          for (var i = 0; i < 36; i++) bins.push({ w: 0, s: 0, v: 0 });
          for (var p = 0; p < d.length; p += 4) {
            var x = hsv(d[p], d[p + 1], d[p + 2]);
            if (x[2] < 0.45) { dark[0] += d[p]; dark[1] += d[p + 1]; dark[2] += d[p + 2]; dark[3]++; }
            if (x[1] < 0.22 || x[2] < 0.18) continue;
            var wt = x[1] * x[1] * x[2], bn = bins[Math.floor(x[0] / 10) % 36];
            bn.w += wt; bn.s += x[1] * wt; bn.v += x[2] * wt;
          }
          var best = -1, bw = 0;
          bins.forEach(function (bn, i) {
            var sum = bn.w + bins[(i + 35) % 36].w * 0.5 + bins[(i + 1) % 36].w * 0.5;
            if (sum > bw) { bw = sum; best = i; }
          });
          var accent, deep;
          if (best >= 0 && bw > 0.6) {
            var bn = bins[best], hue = best * 10 + 5;
            var s = Math.min(0.9, Math.max(0.5, bn.s / bn.w)), v = Math.min(1, Math.max(0.78, bn.v / bn.w + 0.15));
            accent = rgbOfHsv(hue, s, v);
            deep = rgbOfHsv(hue, Math.min(0.85, s + 0.1), 0.22);
          } else {
            accent = [200, 205, 220];
            deep = dark[3] ? [dark[0] / dark[3] | 0, dark[1] / dark[3] | 0, dark[2] / dark[3] | 0] : [20, 20, 26];
          }
          resolve(palCache[url] = { accent: accent, deep: deep });
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }
  function css(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a === undefined ? 1 : a) + ')'; }

  /* ---------- Thème du décor selon le film ---------- */
  var THEMES = [
    ['web', /spider|araign|venom|arachn/],
    ['snow', /christmas|no[eë]l|frozen|reine des neiges|winter|hiver|snow|neige|ice age|[aâ]ge de glace|grinch|klaus|elf\b/],
    ['stars', /space|espace|star wars|star trek|galax|planet|plan[eè]te|astronaut|interstellar|alien|gravity|dune|mars|cosmos|guardians|gardiens/],
    ['magic', /magic|magie|wizard|sorci|harry potter|fairy|f[eé]e|enchant|disney|pixar|dragon|merlin|narnia/],
    ['embers', /fire|feu|flamme|explos|fast|furious|mad max|john wick|war\b|guerre|battle|bataille|gladiat|300\b|top gun/],
    ['rain', /rain|pluie|noir|batman|detective|d[eé]tective|murder|meurtre|crime|blade runner|seven|se7en|joker/],
    ['fog', /horror|horreur|ghost|fant[oô]me|haunt|hant[eé]|conjuring|exorc|demon|d[eé]mon|zombie|vampire|halloween|scream|it\b|ça\b/],
    ['hearts', /love|amour|romance|wedding|mariage|valentin|notebook|n'oublie jamais/]
  ];
  var GENRE_THEME = {
    'Sci-Fi': 'stars', 'Science Fiction': 'stars', Horror: 'fog', Action: 'embers', War: 'embers',
    Crime: 'rain', Thriller: 'rain', Mystery: 'rain', Romance: 'hearts', Fantasy: 'magic',
    Animation: 'magic', Family: 'magic', Western: 'dust', History: 'dust', Adventure: 'dust', Drama: 'bokeh'
  };
  function themeOf(m) {
    if (!m) return 'bokeh';
    var txt = ((m.name || '') + ' ' + (m.description || '')).toLowerCase();
    var name = (m.name || '').toLowerCase();
    // le titre compte plus que la description
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i][1].test(name)) return THEMES[i][0];
    var gs = m.genres || m.genre || [];
    for (var j = 0; j < gs.length; j++) if (GENRE_THEME[gs[j]]) return GENRE_THEME[gs[j]];
    for (var k = 0; k < THEMES.length; k++) if (THEMES[k][1].test(txt)) return THEMES[k][0];
    return 'bokeh';
  }

  /* ---------- Calques d'ambiance ---------- */
  var root = null, glows = [], gi = 0, canvas = null, g2 = null, sprite = null, webArt = null;
  var state = { theme: null, accent: [200, 205, 220], deep: [20, 20, 26], parts: [], alpha: 0, target: 0, t0: 0 };
  function build() {
    if (root) return true;
    var bd = document.getElementById('backdrop');
    if (!bd) return false;
    root = document.createElement('div');
    root.id = 'ambient';
    glows = [document.createElement('div'), document.createElement('div')];
    glows.forEach(function (g) { g.className = 'amb-glow'; root.appendChild(g); });
    canvas = document.createElement('canvas');
    canvas.className = 'amb-fx';
    root.appendChild(canvas);
    bd.parentNode.insertBefore(root, bd.nextSibling);
    g2 = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    return true;
  }
  function resize() {
    if (!canvas) return;
    // demi-résolution : léger pour la TV, invisible à l'œil (effets doux)
    canvas.width = Math.round(window.innerWidth / 2);
    canvas.height = Math.round(window.innerHeight / 2);
    webArt = null;
  }
  function makeSprite(c) {
    var s = document.createElement('canvas'); s.width = s.height = 64;
    var x = s.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, css(c, 1)); gr.addColorStop(0.35, css(c, 0.45)); gr.addColorStop(1, css(c, 0));
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return s;
  }
  /* Toile d'araignée dessinée une fois (coin haut droit), puis seulement déplacée */
  function makeWeb(W, H, c) {
    var s = document.createElement('canvas'); s.width = W; s.height = H;
    var x = s.getContext('2d');
    function web(cx, cy, R, a0, a1, spokes, rings, alpha) {
      var angs = [];
      for (var i = 0; i <= spokes; i++) angs.push(a0 + (a1 - a0) * i / spokes + (Math.random() - 0.5) * 0.05);
      x.lineWidth = 1;
      x.strokeStyle = css(c, alpha);
      angs.forEach(function (a) { x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); x.stroke(); });
      for (var r = 1; r <= rings; r++) {
        var rr = R * Math.pow(r / rings, 1.15);
        x.strokeStyle = css(c, alpha * (1 - r / (rings + 3)));
        x.beginPath();
        for (var k = 0; k < angs.length; k++) {
          var px = cx + Math.cos(angs[k]) * rr, py = cy + Math.sin(angs[k]) * rr;
          if (!k) x.moveTo(px, py);
          else {
            // fils qui pendent légèrement entre deux rayons
            var pa = (angs[k - 1] + angs[k]) / 2, sag = rr * 0.86;
            x.quadraticCurveTo(cx + Math.cos(pa) * sag, cy + Math.sin(pa) * sag, px, py);
          }
        }
        x.stroke();
      }
    }
    web(W * 1.0, 0, Math.min(W, H) * 0.62, Math.PI / 2, Math.PI, 12, 11, 0.32);
    web(0, H, Math.min(W, H) * 0.32, -Math.PI / 2, 0, 8, 7, 0.18);
    return s;
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function spawn(theme, W, H, initial) {
    var p = { x: rnd(0, W), y: initial ? rnd(0, H) : 0, life: rnd(0, 6.28) };
    switch (theme) {
      case 'snow': p.r = rnd(1, 3.2); p.vy = rnd(14, 40); p.vx = rnd(-6, 6); p.a = rnd(0.35, 0.8); p.white = true; if (!initial) p.y = -6; break;
      case 'embers': p.r = rnd(0.8, 2.4); p.vy = -rnd(18, 50); p.vx = rnd(-8, 8); p.a = rnd(0.4, 0.9); if (!initial) p.y = H + 6; break;
      case 'stars': p.r = rnd(0.5, 1.8); p.vy = 0; p.vx = -rnd(1, 4); p.a = rnd(0.3, 1); p.white = Math.random() < 0.7; break;
      case 'rain': p.len = rnd(8, 18); p.vy = rnd(260, 420); p.vx = -p.vy * 0.18; p.a = rnd(0.08, 0.2); if (!initial) p.y = -20; break;
      case 'fog': p.r = rnd(H * 0.35, H * 0.7); p.vy = 0; p.vx = rnd(4, 10) * (Math.random() < 0.5 ? -1 : 1); p.a = rnd(0.05, 0.1); p.y = rnd(H * 0.35, H); break;
      case 'magic': p.r = rnd(1, 2.6); p.vy = -rnd(4, 14); p.vx = rnd(-5, 5); p.a = rnd(0.4, 1); p.star = Math.random() < 0.35; break;
      case 'hearts': case 'bokeh': p.r = rnd(6, 26); p.vy = -rnd(3, 10); p.vx = rnd(-3, 3); p.a = rnd(0.06, 0.2); if (!initial) p.y = H + 30; break;
      case 'web': p.r = rnd(0.6, 1.6); p.vy = rnd(-4, 4); p.vx = rnd(2, 8); p.a = rnd(0.2, 0.6); break;
      default: p.r = rnd(0.6, 1.8); p.vy = rnd(-3, 3); p.vx = rnd(2, 6); p.a = rnd(0.15, 0.5); // poussière
    }
    return p;
  }
  var COUNT = { snow: 70, embers: 46, stars: 90, rain: 70, fog: 7, magic: 46, hearts: 18, bokeh: 18, web: 26, dust: 40 };

  var running = false, last = 0;
  function loop(t) {
    if (!running) return;
    requestAnimationFrame(loop);
    if (t - last < 33) return; // ~30 images/s suffisent pour un décor
    var dt = Math.min(0.1, (t - last) / 1000); last = t;
    if (document.hidden || document.body.classList.contains('playing')) return;
    var W = canvas.width, H = canvas.height, th = state.theme;
    state.alpha += (state.target - state.alpha) * Math.min(1, dt * 2.5);
    g2.clearRect(0, 0, W, H);
    if (state.alpha < 0.01) { if (state.target === 0) { running = false; } return; }
    g2.globalAlpha = state.alpha;
    var time = (t - state.t0) / 1000;
    if (th === 'web') {
      if (!webArt) webArt = makeWeb(W, H, [235, 238, 245]);
      g2.save();
      g2.globalAlpha = state.alpha * 0.9;
      g2.translate(Math.sin(time * 0.5) * 3, Math.sin(time * 0.37) * 2);
      g2.drawImage(webArt, 0, 0);
      g2.restore();
      g2.globalAlpha = state.alpha;
    }
    g2.globalCompositeOperation = 'lighter';
    var parts = state.parts;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.life += dt;
      p.x += (p.vx + (th === 'snow' || th === 'magic' ? Math.sin(p.life * 1.3) * 8 : 0)) * dt;
      p.y += p.vy * dt;
      if (p.y > H + 40 || p.y < -40 || p.x < -p.r * 2 - 40 || p.x > W + p.r * 2 + 40) {
        var n = spawn(th, W, H, th === 'stars' || th === 'fog' || th === 'web' || th === 'dust');
        if (th === 'stars') n.x = W + 2; else if (th === 'fog') n.x = n.vx > 0 ? -n.r : W + n.r; else if (th === 'web' || th === 'dust') n.x = -4;
        parts[i] = n; continue;
      }
      var a = p.a;
      if (th === 'stars' || th === 'magic') a *= 0.55 + 0.45 * Math.sin(p.life * 3 + i);
      if (th === 'embers') a *= 0.6 + 0.4 * Math.sin(p.life * 9 + i);
      g2.globalAlpha = state.alpha * a;
      if (th === 'rain') {
        g2.strokeStyle = 'rgba(210,225,255,1)'; g2.lineWidth = 1;
        g2.beginPath(); g2.moveTo(p.x, p.y); g2.lineTo(p.x - p.vx * 0.04, p.y - p.len); g2.stroke();
      } else {
        var r = p.r * (th === 'embers' ? 3 : th === 'fog' || th === 'bokeh' || th === 'hearts' ? 1 : 2.6);
        g2.drawImage(p.white ? whiteSprite : sprite, p.x - r, p.y - r, r * 2, r * 2);
        if (p.star) {
          g2.fillStyle = '#fff';
          g2.fillRect(p.x - p.r * 2.4, p.y - 0.4, p.r * 4.8, 0.8);
          g2.fillRect(p.x - 0.4, p.y - p.r * 2.4, 0.8, p.r * 4.8);
        }
      }
    }
    g2.globalCompositeOperation = 'source-over';
    g2.globalAlpha = 1;
  }
  var whiteSprite = null;

  function applyTheme(theme, pal) {
    var accent = pal ? pal.accent : state.accent, deep = pal ? pal.deep : state.deep;
    state.accent = accent; state.deep = deep;
    if (!build()) return;
    // lumière de fond : fondu entre deux calques
    var next = glows[gi = 1 - gi], prev = glows[1 - gi];
    next.style.background =
      'radial-gradient(60% 75% at 12% 100%, ' + css(accent, 0.30) + ', transparent 70%),' +
      'radial-gradient(55% 60% at 100% 0%, ' + css(accent, 0.16) + ', transparent 70%),' +
      'linear-gradient(180deg, transparent 40%, ' + css(deep, 0.55) + ' 100%)';
    next.classList.add('show'); prev.classList.remove('show');
    document.documentElement.style.setProperty('--amb', css(accent));
    document.documentElement.style.setProperty('--amb-soft', css(accent, 0.35));
    if (!setting('ambience') || reduce) { state.target = 0; return; }
    var tint = theme === 'embers' ? [255, 150, 60].map(function (v, i) { return Math.round(v * 0.6 + accent[i] * 0.4); }) : accent;
    sprite = makeSprite(tint);
    whiteSprite = whiteSprite || makeSprite([240, 244, 255]);
    if (theme !== state.theme) {
      state.theme = theme;
      var W = canvas.width, H = canvas.height, n = COUNT[theme] || 30;
      state.parts = [];
      for (var i = 0; i < n; i++) state.parts.push(spawn(theme, W, H, true));
      state.alpha = 0; state.t0 = performance.now();
    }
    state.target = 1;
    if (!running) { running = true; last = performance.now(); requestAnimationFrame(loop); }
  }

  var pending = null, cur = null;
  Onyx.ambient = {
    /* Film sélectionné (carte, fiche) : on adapte couleurs et décor, sans à-coups */
    meta: function (m) {
      clearTimeout(pending);
      pending = setTimeout(function () {
        if (!m) { cur = null; if (root) { glows.forEach(function (g) { g.classList.remove('show'); }); state.target = 0; } return; }
        var key = m.id || m.name;
        if (cur === key) return;
        cur = key;
        var url = Onyx.bgOf ? Onyx.bgOf(m) : m.background;
        var theme = themeOf(m);
        (url ? palette(url) : Promise.resolve(null)).then(function (pal) { if (cur === key) applyTheme(theme, pal); });
      }, 220);
    },
    palette: function () { return { accent: state.accent, deep: state.deep }; },
    themeOf: themeOf,
    paletteOf: palette
  };

  /* ---------- Animation de lancement ---------- */
  var launching = null;
  Onyx.launchFx = {
    /* Lance l'animation ; done() est appelé quand l'écran de chargement peut prendre le relais */
    play: function (meta, done) {
      if (!setting('launchFx') || reduce) { done(); return; }
      if (Onyx.sfx) Onyx.sfx('launch');
      var old = document.getElementById('launch');
      if (old) old.parentNode.removeChild(old);
      var url = (Onyx.bgOf && Onyx.bgOf(meta)) || meta.poster || '';
      var logo = (Onyx.logoOf && Onyx.logoOf(meta)) || '';
      var pal = (url && palCache[url]) ? palCache[url].accent : state.accent;
      var el = document.createElement('div');
      el.id = 'launch';
      el.style.setProperty('--lc', css(pal));
      el.style.setProperty('--lc-soft', css(pal, 0.45));
      el.innerHTML = '<div class="lc-bg"></div><div class="lc-glow"></div><div class="lc-ring"></div>' +
        '<div class="lc-center"><div class="lc-title"></div></div><div class="lc-sweep"></div><div class="lc-black"></div>';
      var bg = el.querySelector('.lc-bg');
      if (url) bg.style.backgroundImage = 'url("' + url + '")';
      var title = el.querySelector('.lc-title');
      title.textContent = meta.name || '';
      if (logo) {
        var li = new Image();
        li.onload = function () { if (li.naturalWidth > 10) { title.textContent = ''; li.className = 'lc-logo'; title.appendChild(li); } };
        li.src = logo;
      }
      // l'image part de la carte (ou du bouton) sélectionnée et s'ouvre en plein écran
      var from = Onyx.focus && Onyx.focus.cur && Onyx.focus.cur.isConnected ? Onyx.focus.cur.getBoundingClientRect() : null;
      if (from && from.width > 20) {
        var W = window.innerWidth, H = window.innerHeight;
        bg.style.clipPath = bg.style.webkitClipPath = 'inset(' + Math.max(0, from.top) + 'px ' + Math.max(0, W - from.right) + 'px ' + Math.max(0, H - from.bottom) + 'px ' + Math.max(0, from.left) + 'px round 12px)';
      }
      document.body.appendChild(el);
      void el.offsetWidth;
      el.classList.add('go');
      var finished = false, token = {};
      launching = token;
      function finish() {
        if (finished) return; finished = true;
        if (launching === token) launching = null;
        done();
        // l'écran noir reste un instant le temps que l'écran de chargement apparaisse
        setTimeout(function () { el.classList.add('out'); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 700); }, 450);
      }
      setTimeout(finish, 1750);
      return { cancel: function () { finished = true; if (el.parentNode) el.parentNode.removeChild(el); } };
    },
    active: function () { return !!launching; }
  };
})();
