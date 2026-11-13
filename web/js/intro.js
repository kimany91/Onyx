/* « Passer l'intro » pour le lecteur PC (HTML5).
 * 1. Bases communautaires gratuites : TheIntroDB, SkipDB, IntroDB.
 * 2. Sinon, pour un film : analyse de la luminosité des 2 premières minutes (logos de studio),
 *    sur une copie cachée de la vidéo. Même règle de décision que le lecteur natif (IntroDetect.kt).
 * Le saut est un simple déplacement dans la vidéo : rien ne se recharge. */
(function () {
  'use strict';
  var I = Onyx.intro = {};
  I.INTRO = 'Passer l\'intro';
  I.RECAP = 'Passer le résumé';

  function getJson(url) {
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) { clearTimeout(t); return r.ok ? r.json() : null; })
      .catch(function () { clearTimeout(t); return null; });
  }

  /* Segments connus : [{ start, end, label }] en secondes */
  I.lookup = function (videoId, duration) {
    var m = /^(tt\d{5,10})(?::(\d+):(\d+))?$/.exec(videoId || '');
    if (!m) return Promise.resolve([]);
    var q = m[2] ? '&season=' + m[2] + '&episode=' + m[3] : '';
    var out = [];
    function add(s, e, label, maxLen) {
      if (e === null || e === undefined || e <= 0) return;
      var a = s || 0;
      if (e - a < 3000 || e - a > maxLen) return;
      if (duration > 0 && e / 1000 > duration - 10) return;
      if (out.some(function (x) { return x.label === label; })) return;
      out.push({ start: a / 1000, end: e / 1000, label: label });
    }
    function has() { return out.some(function (x) { return x.label === I.INTRO; }); }
    return getJson('https://api.theintrodb.org/v4/media?imdb_id=' + m[1] + q + (duration > 0 ? '&duration_ms=' + Math.round(duration * 1000) : '')).then(function (o) {
      if (o && o.intro && o.intro[0]) add(o.intro[0].start_ms, o.intro[0].end_ms, I.INTRO, 300000);
      if (o && o.recap && o.recap[0]) add(o.recap[0].start_ms, o.recap[0].end_ms, I.RECAP, 1200000);
      if (has()) return null;
      return getJson('https://api.skipdb.tv/api/segments?imdb_id=' + m[1] + q).then(function (o2) {
        var sg = o2 && o2.segments;
        if (sg && sg.intro) add(sg.intro.start_ms, sg.intro.end_ms, I.INTRO, 300000);
        if (sg && sg.recap) add(sg.recap.start_ms, sg.recap.end_ms, I.RECAP, 1200000);
        if (has()) return null;
        return getJson('https://api.introdb.app/segments?imdb_id=' + m[1] + (m[2] ? q : '&is_movie=true')).then(function (o3) {
          if (o3 && o3.intro) add(o3.intro.start_ms, o3.intro.end_ms, I.INTRO, 300000);
          if (o3 && o3.recap) add(o3.recap.start_ms, o3.recap.end_ms, I.RECAP, 1200000);
        });
      });
    }).then(function () { return out.sort(function (a, b) { return a.start - b.start; }); });
  };

  /* Règle de décision (identique à IntroDetect.decide) : runs = passages au noir [{start, end}] */
  I.decide = function (runsIn, analyzed, maxEnd) {
    maxEnd = maxEnd || 120;
    var runs = runsIn.slice().sort(function (a, b) { return a.start - b.start; }).map(function (r) {
      return r.end - r.start > 6 ? { start: r.start, end: r.start + 1 } : r;
    });
    if (!runs.length || runs[0].start > 1) return -1;
    var prev = 0, cand = -1, count = 0, lastSeg = -1, stopped = false;
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      if (r.end <= prev) continue;
      if (r.start <= prev + 0.6) { prev = Math.max(prev, r.end); if (count > 0) cand = prev; continue; }
      var seg = r.start - prev;
      if (seg > 45) { lastSeg = seg; stopped = true; break; }
      if (seg < 2.5) { prev = r.end; if (count > 0) cand = prev; continue; }
      count++; cand = r.end; prev = r.end;
      if (count > 6 || cand > maxEnd) return -1;
    }
    if (count === 0 || cand < 4 || cand > maxEnd) return -1;
    if (!stopped && analyzed - cand < 40) return -1;
    if (stopped && lastSeg < 45) return -1;
    return cand;
  };

  /* Analyse : une copie cachée de la vidéo parcourt les 150 premières secondes (4 images/s),
   * chaque image est réduite à 32×18 pour mesurer sa luminosité. */
  I.analyze = function (url, stop) {
    return new Promise(function (resolve) {
      var v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
      var c = document.createElement('canvas'); c.width = 32; c.height = 18;
      var g = c.getContext('2d', { willReadFrequently: true });
      var step = 0.25, t = 0, limit = 150, runs = [], rs = -1, last = -1, done = false;
      var watchdog;
      function finish(res) {
        if (done) return; done = true;
        clearTimeout(watchdog);
        try { v.removeAttribute('src'); v.load(); } catch (e) { }
        resolve(res);
      }
      function next() {
        clearTimeout(watchdog);
        watchdog = setTimeout(function () { finish(null); }, 30000);
        if (stop && stop()) return finish(null);
        if (t > Math.min(limit, (v.duration || limit) - 1)) {
          if (rs >= 0) runs.push({ start: rs, end: last + step });
          var end = I.decide(runs, t);
          return finish(end > 0 ? { start: 0, end: end, label: I.INTRO } : null);
        }
        v.currentTime = t;
      }
      v.addEventListener('seeked', function () {
        if (done) return;
        var d;
        try { g.drawImage(v, 0, 0, 32, 18); d = g.getImageData(0, 0, 32, 18).data; } catch (e) { return finish(null); } // image protégée (CORS)
        var sum = 0, hi = 0, n = d.length / 4;
        for (var i = 0; i < d.length; i += 4) {
          var y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          sum += y; if (y > 40) hi++;
        }
        var black = sum / n < 16 && hi / n < 0.02;
        if (black) { if (rs < 0) rs = t; last = t; }
        else if (rs >= 0) { if (last + step - rs >= 0.3) runs.push({ start: rs, end: last + step }); rs = -1; }
        t += step;
        next();
      });
      v.addEventListener('error', function () { finish(null); });
      v.addEventListener('loadedmetadata', next, { once: true });
      v.src = url;
    });
  };
})();
