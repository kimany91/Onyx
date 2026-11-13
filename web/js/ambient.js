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
          // zones lumineuses de l'image (lampes, soleil, néons…) : de petites lumières y seront posées
          var spots = [], lumA = [];
          for (var q = 0; q < d.length; q += 4) lumA.push((d[q] * 0.3 + d[q + 1] * 0.59 + d[q + 2] * 0.11) / 255);
          for (var yy = 1; yy < hgt - 1; yy++) for (var xx = 1; xx < w - 1; xx++) {
            var li = yy * w + xx, lv = lumA[li];
            if (lv < 0.72) continue;
            var peak = true;
            for (var oy = -1; oy <= 1 && peak; oy++) for (var ox = -1; ox <= 1; ox++) if ((ox || oy) && lumA[li + oy * w + ox] > lv) { peak = false; break; }
            if (peak) spots.push([xx / w, yy / hgt, lv, [d[li * 4], d[li * 4 + 1], d[li * 4 + 2]]]);
          }
          spots.sort(function (a, b) { return b[2] - a[2]; });
          var kept = [];
          spots.forEach(function (s) { if (kept.length < 4 && kept.every(function (k) { return Math.abs(k[0] - s[0]) + Math.abs(k[1] - s[1]) > 0.18; })) kept.push([s[0], s[1], Math.min(1, (s[2] - 0.6) * 2.5), s[3]]); });
          resolve(palCache[url] = { accent: accent, deep: deep, spots: kept });
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }
  function css(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a === undefined ? 1 : a) + ')'; }

  /* ---------- Recette d'effets du film ----------
     1) liste de films connus (fx-data.js) par identifiant IMDb puis par titre ;
     2) sinon mots-clés du titre / de la description ; 3) sinon le genre. */
  var KEYWORDS = [
    [['web', 'flare'], /spider|araign|venom|arachn/],
    [['snow', 'bokeh'], /christmas|no[eë]l|frozen|reine des neiges|winter|hiver|snow|neige|grinch|klaus/],
    [['warp', 'stars'], /star wars|star trek|hyperspace/],
    [['stars', 'flare'], /space|espace|galax|planet|plan[eè]te|astronaut|interstellar|alien|gravity|cosmos|guardians|gardiens/],
    [['sand', 'sun'], /dune|desert|d[eé]sert|sahara|egypt|[eé]gypte|mad max/],
    [['caustics', 'bubbles'], /ocean|oc[eé]an|sea\b|mer\b|underwater|shark|requin|mermaid|sir[eè]ne|aqua|moana|vaiana|titanic|nemo/],
    [['magic', 'portal'], /magic|magie|wizard|sorci|harry potter|witch|doctor strange/],
    [['embers', 'sparks'], /fire|feu|flamme|dragon|explos|furious|john wick|gladiat/],
    [['rain', 'neon'], /noir|batman|joker|blade runner|cyber|detective|d[eé]tective|gotham/],
    [['pulse', 'smoke'], /horror|horreur|ghost|fant[oô]me|haunt|hant[eé]|conjuring|exorc|demon|d[eé]mon|zombie|halloween|scream/],
    [['bats', 'pulse'], /vampire|dracula|nosferatu/],
    [['lightning', 'rays'], /thor|zeus|olymp|god of|dieux/],
    [['code', 'scan'], /matrix|hacker|robot|artificial|intelligence artificielle|ai\b/],
    [['hearts', 'bokeh'], /love|amour|romance|wedding|mariage|valentin/],
    [['lanterns', 'fireflies'], /lantern|lanterne|raiponce|tangled|coco|spirit|esprit/]
  ];
  var GENRE_FX = {
    'Sci-Fi': ['stars', 'scan'], 'Science Fiction': ['stars', 'scan'], Horror: ['pulse', 'smoke'], Action: ['sparks', 'flare'],
    War: ['ash', 'smoke'], Crime: ['rain', 'neon'], Thriller: ['pulse', 'rain'], Mystery: ['smoke', 'beam'], Romance: ['bokeh', 'hearts'],
    Fantasy: ['magic', 'rays'], Animation: ['magic', 'bokeh'], Family: ['magic', 'bokeh'], Western: ['dust', 'sun'],
    History: ['dust', 'rays'], Adventure: ['dust', 'rays'], Drama: ['bokeh', 'rays'], Comedy: ['confetti', 'bokeh'],
    Music: ['gold', 'bokeh'], Musical: ['gold', 'confetti'], Sport: ['flare', 'confetti'], Documentary: ['dust', 'rays'], Biography: ['grain', 'rays']
  };
  function norm(s) { return String(s || '').toLowerCase().normalize ? String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() : String(s || '').toLowerCase(); }
  function parseRecipe(r) {
    if (!r) return null;
    if (r === '-' || r.indexOf('-|') === 0) return { fx: [], color: r.split('|')[1] || null }; // film sans effet : couleurs + lumières de l'image
    var parts = r.split('|');
    return { fx: parts[0].split(',').filter(function (n) { return Onyx.Fx && Onyx.Fx.has(n); }), color: parts[1] || null };
  }
  function recipeOf(m) {
    if (!m) return null;
    var db = Onyx.FX_DB || { ids: {}, names: {} };
    var id = String(m.id || '').split(':')[0];
    var r = parseRecipe(db.ids[id]);
    if (!r) {
      var n = norm(m.name), y = String(m.releaseInfo || m.year || '').slice(0, 4);
      r = parseRecipe(db.names[n + '|' + y] || db.names[n]);
    }
    if (r) return r;
    // film inconnu : un effet seulement si son titre l'évoque clairement (sinon : couleurs + lumières de son image,
    // plutôt qu'un effet générique sans rapport avec le film)
    var name = (m.name || '').toLowerCase();
    for (var i = 0; i < KEYWORDS.length; i++) if (KEYWORDS[i][1].test(name)) return { fx: KEYWORDS[i][0].slice(0, 1), color: null };
    return { fx: [], color: null };
  }

  /* ---------- Calques d'ambiance ---------- */
  var root = null, glows = [], gi = 0, canvas = null, engine = null;
  var state = { accent: [200, 205, 220], deep: [20, 20, 26] };
  function build() {
    if (root) return true;
    var bd = document.getElementById('backdrop');
    if (!bd || !Onyx.Fx) return false;
    root = document.createElement('div');
    root.id = 'ambient';
    glows = [document.createElement('div'), document.createElement('div')];
    glows.forEach(function (g) { g.className = 'amb-glow'; root.appendChild(g); });
    canvas = document.createElement('canvas');
    canvas.className = 'amb-fx';
    root.appendChild(canvas);
    bd.parentNode.insertBefore(root, bd.nextSibling);
    resize();
    engine = Onyx.Fx.create(canvas);
    engine.pauseWhen(function () { return document.hidden || document.body.classList.contains('playing'); });
    window.addEventListener('resize', function () { resize(); if (engine) engine.resize(); });
    return true;
  }
  function resize() {
    if (!canvas) return;
    // demi-résolution : léger pour la TV, invisible à l'œil (effets doux)
    // pleine résolution (plafonnée au 1080p) : effets nets
    var dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.min(1920, Math.round(window.innerWidth * dpr));
    canvas.width = w;
    canvas.height = Math.round(w * window.innerHeight / window.innerWidth);
  }

  function apply(recipe, pal) {
    var accent = pal ? pal.accent : state.accent, deep = pal ? pal.deep : state.deep;
    var forced = recipe && recipe.color && Onyx.Fx ? Onyx.Fx.hex(recipe.color) : null;
    if (forced && !pal) accent = forced;
    state.accent = accent; state.deep = deep;
    if (!build()) return;
    var next = glows[gi = 1 - gi], prev = glows[1 - gi];
    next.style.background =
      'radial-gradient(60% 75% at 12% 100%, ' + css(accent, 0.30) + ', transparent 70%),' +
      'radial-gradient(55% 60% at 100% 0%, ' + css(accent, 0.16) + ', transparent 70%),' +
      'linear-gradient(180deg, transparent 40%, ' + css(deep, 0.55) + ' 100%)';
    next.classList.add('show'); prev.classList.remove('show');
    document.documentElement.style.setProperty('--amb', css(accent));
    document.documentElement.style.setProperty('--amb-soft', css(accent, 0.35));
    var bd = document.getElementById('backdrop');
    var mood = setting('ambience') ? Onyx.Fx.moodOf(recipe.fx) : null;
    if (bd) { bd.classList.toggle('mood-mono', mood === 'mono'); }
    if (!setting('ambience') || reduce) { engine.clear(); return; }
    // couleur des effets : celle du film (recette) mêlée à celle de l'image
    var fxColor = forced ? forced.map(function (v, i) { return Math.round(v * 0.7 + accent[i] * 0.3); }) : accent;
    var names = recipe.fx.slice(0, 3);
    // + lumières posées sur les zones claires de l'image du film (rend chaque fond unique)
    if (pal && pal.spots && pal.spots.length && mood !== 'mono' && names.length < 3) names.push('spots');
    engine.set(names, fxColor, 1, { spots: pal && pal.spots });
  }

  var pending = null, cur = null;
  Onyx.ambient = {
    /* Film sélectionné (carte, fiche) : on adapte couleurs et effets, sans à-coups */
    meta: function (m) {
      clearTimeout(pending);
      pending = setTimeout(function () {
        if (!m) {
          cur = null;
          if (root) { glows.forEach(function (g) { g.classList.remove('show'); }); engine.clear(); }
          var bd0 = document.getElementById('backdrop'); if (bd0) bd0.classList.remove('mood-mono');
          return;
        }
        var key = m.id || m.name;
        if (cur === key) return;
        cur = key;
        var url = Onyx.bgOf ? Onyx.bgOf(m) : m.background;
        var recipe = recipeOf(m);
        (url ? palette(url) : Promise.resolve(null)).then(function (pal) { if (cur === key) apply(recipe, pal); });
      }, 220);
    },
    palette: function () { return { accent: state.accent, deep: state.deep }; },
    recipeOf: recipeOf,
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
