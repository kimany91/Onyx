/* Onyx — « ce que je choisis est ce qui est lancé ».
 * 1. Onyx.match.fits(stream, meta, video) : la source correspond-elle vraiment au titre demandé ?
 *    Les addons (Comet…) renvoient parfois d'autres séries au nom proche (« My Hero Academia
 *    Vigilantes », « … 7th Season S01E01 », « … Memories ») ou d'autres films (« Spiderman 2 »).
 * 2. Onyx.match.episodeFile(files, s, e, abs) : dans un pack (saison complète, intégrale),
 *    le fichier exact de l'épisode — ou -1 plutôt qu'un autre épisode.
 * Même logique côté Android : TorrentEngine.chooseFile. */
(function () {
  'use strict';
  var M = Onyx.match = {};

  function norm(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  M.norm = norm;

  /* Nom du fichier / de la release annoncé par l'addon */
  M.releaseName = function (st) {
    var hb = st.behaviorHints || {};
    if (hb.filename) return hb.filename;
    var d = String(st.description || st.title || '');
    var line = d.split('\n')[0].replace(/^[^\w\[(]+/, '');
    return line;
  };

  var NOISE = /^(the|a|an|and|of|complete|integrale|integral|tv|series|serie|us|uk|multi|vostfr|vf|vff|vfq|french|truefrench|dual|audio|dub|dubbed|sub|subs|subbed|raw|eng|english|jap|japanese|ita|esp|spa|ger|web|webrip|bluray|bdrip|remux|hdtv|dl|uncut|uncensored|repack|proper|remastered|extended|hd|uhd|fhd|sd|batch|pack|collection|tvrip|dvdrip|ep|eps|episode|episodes|vol|part|cr|nf|amzn|dsnp|hmax|atvp|bd|vostf|by|zone|rus|ext|fre|fra|ukr|pol|hin|tam|tel|chi|kor|lat|cast|castellano|latino|ita|ger|deu|jpn|chs|cht|subita|softsub|hardsub|vo|vost|tv1|tv2)$/;

  function seasonsIn(n) {
    var out = [], m, re;
    re = /\b(?:season|saison|temporada|stagione)\s*0*(\d{1,2})\b/g; while ((m = re.exec(n))) out.push(+m[1]);
    re = /\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/g; while ((m = re.exec(n))) out.push(+m[1]);
    re = /\bs0*(\d{1,2})\b(?!\s*e\s*\d)/g; while ((m = re.exec(n))) out.push(+m[1]);
    return out;
  }

  /* La source correspond-elle au titre (et à l'épisode) demandé ? */
  M.fits = function (st, meta, video) {
    if (!st || !meta) return true;
    var raw = M.releaseName(st);
    if (!raw) return true;
    // faux fichiers (programmes, archives) : jamais une vidéo, parfois dangereux
    if (/\.(exe|scr|bat|cmd|msi|lnk|apk|zip|rar|7z)\b|\bexe\s*$/i.test(raw)) return false;
    var n = norm(raw);
    var title = norm(meta.name);
    if (!n || !title) return true;
    var tTok = title.split(' ').filter(function (w) { return w && !/^(the|a|an|and|of|le|la|les)$/.test(w); });
    var isEp = video && video.season !== undefined && video.season !== null && (video.episode || video.number);
    if (isEp) {
      var s = Number(video.season), e = Number(video.episode || video.number);
      // SxxEyy ou NxM présents : il faut le bon épisode
      var eps = [], m2, re2 = /\bs\s*0*(\d{1,2})\s*e\s*0*(\d{1,4})\b/g;
      while ((m2 = re2.exec(n))) eps.push([+m2[1], +m2[2]]);
      var re3 = /\b0*(\d{1,2})x0*(\d{1,3})\b/g;
      while ((m2 = re3.exec(n))) if (+m2[1] < 40) eps.push([+m2[1], +m2[2]]);
      if (eps.length && !eps.some(function (p) { return p[0] === s && p[1] === e; })) {
        // plage d'épisodes « S01E01-E05 » : acceptée si l'épisode est dedans
        var rng = /\bs\s*0*(\d{1,2})\s*e\s*0*(\d{1,4})\s*(?:e|-)\s*0*(\d{1,4})\b/.exec(n);
        if (!(rng && +rng[1] === s && e >= +rng[2] && e <= +rng[3])) return false;
      }
      // saison indiquée autrement (« 7th Season », « Season 2 ») : doit être la bonne
      var lead = n.replace(/\bs\s*\d{1,2}\s*e\s*\d{1,4}.*$/, ' ');
      var ss = seasonsIn(lead);
      if (ss.length && ss.indexOf(s) < 0) return false;
      // autre série au nom proche : « <titre> Vigilantes S01E01 », « <titre> Memories »…
      if (tTok.length) {
        var nb = norm(String(raw).replace(/\[[^\]]*\]|\{[^}]*\}/g, ' '));
        var cut = nb.search(/\bs\s*\d{1,2}\s*e\s*\d|\b\d{1,2}x\d{1,3}\b|\bseason\b|\bsaison\b|\b\d{1,2}(?:st|nd|rd|th) season\b|\bs\d{1,2}\b/);
        var prefix = (cut > 0 ? nb.slice(0, cut) : nb).trim().split(' ').filter(Boolean);
        var last = tTok[tTok.length - 1], at = prefix.lastIndexOf(last);
        var words = function (arr) { return arr.filter(function (w) { return w.length >= 3 && !/^\d+$/.test(w) && !NOISE.test(w); }); };
        if (at >= 0) {
          if (words(prefix.slice(at + 1)).length) return false;
        } else if (cut > 0 && words(prefix).length && !prefix.some(function (w) { return tTok.indexOf(w) >= 0; })) {
          return false; // un autre titre devant l'épisode (« Vigilantes - S01E01 »)
        }
      }
      return true;
    }
    // Film : bonne année (±1) et/ou bon titre
    var compactN = n.replace(/ /g, ''), compactT = tTok.join('');
    var titleOk = compactT.length >= 2 && compactN.indexOf(compactT) >= 0;
    var year = parseInt(String(meta.releaseInfo || meta.year || '').slice(0, 4), 10);
    var ys = (n.match(/\b(19[2-9]\d|20[0-4]\d)\b/g) || []).map(Number);
    if (year && ys.length) {
      var yearOk = ys.some(function (y) { return Math.abs(y - year) <= 1; });
      if (!yearOk) return false;            // remake, autre volet d'une saga
      return true;                            // bonne année : titre étranger accepté
    }
    if (titleOk) {
      // « Titre 2 » quand on a demandé « Titre » : suite
      var after = compactN.slice(compactN.indexOf(compactT) + compactT.length);
      if (/^(\d{1,2}|ii|iii|iv|part\d)(?![\dp]|bit|k)/.test(after) && !/\d$/.test(compactT)) return false;
      return true;
    }
    return false;
  };

  /* ---------- Fichier d'un épisode dans un pack ---------- */
  var VIDEO = /\.(mkv|mp4|avi|m4v|ts|webm|mov|wmv|mpg|mpeg)$/i;

  /* Numéro d'épisode « nu » d'un nom de fichier (« [Grp] Titre - 01 [1080p].mkv » → 1) */
  function bareEpisode(base) {
    var b = base.replace(/\.[a-z0-9]{2,4}$/i, ' ')
      .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')
      .replace(/\b\d{3,4}p\b|\bx\.?26[45]\b|\bh\.?26[45]\b|\b(?:8|10|12)\s?bits?\b|\b\d\.\d\b|\b(?:19|20)\d\d\b|\b\d{1,2}(?:st|nd|rd|th)\s+season\b|\b(?:season|saison)\s*\d+\b|\bs\d{1,2}\b|\bv\d\b/gi, ' ');
    var m = /(?:^|[ ._-])(?:e|ep|episode|épisode|eps)[ ._-]*0*(\d{1,4})(?!\d)/i.exec(b);
    if (m) return +m[1];
    m = /\s-\s*0*(\d{1,4})(?:v\d)?(?=[\s._-]|$)/.exec(b);
    if (m) return +m[1];
    var all = b.match(/(?:^|[\s._])0*(\d{1,4})(?=[\s._]|$)/g);
    if (all && all.length) return +all[all.length - 1].replace(/\D/g, '');
    return -1;
  }
  M.bareEpisode = bareEpisode;

  function folderSeason(path) {
    var parts = path.split('/'); parts.pop();
    for (var i = parts.length - 1; i >= 0; i--) {
      var ss = seasonsIn(norm(parts[i]));
      if (ss.length === 1) return ss[0];
      if (ss.length > 1) return -2; // pack multi-saisons au niveau du dossier
    }
    return -1;
  }

  /* files : [{ path, size }] → index du fichier de l'épisode, ou -1 */
  M.episodeFile = function (files, s, e, abs) {
    abs = abs || e;
    var best = -1, bestScore = 0, bestSize = -1;
    files.forEach(function (f, i) {
      var path = String(f.path || f.name || '');
      if (!VIDEO.test(path)) return;
      if (/(^|[\/ ._-])(sample|trailer|extras?|featurettes?|ncop|nced|creditless|preview)([\/ ._-]|$)/i.test(path) && (f.size || 0) < 300e6) return;
      var base = path.split('/').pop(), nb = norm(base), sc = 0;
      var m = /\bs\s*0*(\d{1,2})\s*e\s*0*(\d{1,4})\b/.exec(nb) || /\b0*(\d{1,2})x0*(\d{1,3})\b/.exec(nb);
      if (m) {
        if (+m[1] !== s || +m[2] !== e) return; // autre épisode : jamais
        sc = 100;
      } else {
        var m2 = /\bs0*(\d{1,2})\s+0*(\d{1,4})\b/.exec(nb); // « S01 - 01 »
        if (m2) { if (+m2[1] !== s || +m2[2] !== e) return; sc = 90; }
        else {
          var fsn = folderSeason(path), en = bareEpisode(base);
          if (en < 0) return;
          var bs = seasonsIn(norm(base.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')));
          var seasonHere = fsn > 0 ? fsn : bs.length === 1 ? bs[0] : -1;
          if (seasonHere > 0) { if (seasonHere !== s || en !== e) return; sc = 85; }
          else if (en === abs && abs !== e) sc = 75;      // numérotation continue (pack multi-saisons)
          else if (en === e && abs === e) sc = 70;        // saison 1 (ou pas de numérotation de saison)
          else return;
        }
      }
      if (sc > bestScore || (sc === bestScore && (f.size || 0) > bestSize)) { best = i; bestScore = sc; bestSize = f.size || 0; }
    });
    return best;
  };

  /* Numéro « absolu » d'un épisode (épisodes des saisons précédentes + numéro) */
  M.absEpisode = function (meta, s, e) {
    var vids = (meta && meta.videos) || [];
    if (!vids.length || !s) return e;
    var n = 0;
    vids.forEach(function (v) { if (v.season > 0 && v.season < s) n++; });
    return n + e;
  };
})();
