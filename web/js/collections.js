/* Onyx — listes de l'accueil (Au cinéma, Classiques, Disney, Marvel) et catégories.
   Partagé entre l'app TV et l'app téléphone. */
(function () {
  'use strict';
  var Onyx = window.Onyx = window.Onyx || {};
  var S = Onyx.Stremio;
  var CINEMETA = 'https://v3-cinemeta.strem.io';

  /* Titres en anglais (comme dans Cinemeta) + année : retrouvés automatiquement par la recherche */
  var LISTS = {
    classics: {
      title: 'Les Classiques', version: 1, items: [
        ['The Godfather', 1972], ['The Truman Show', 1998], ['Interstellar', 2014], ['Jurassic Park', 1993],
        ['The Shawshank Redemption', 1994], ['Pulp Fiction', 1994], ['Forrest Gump', 1994], ['The Dark Knight', 2008],
        ['Titanic', 1997], ['The Matrix', 1999], ['Back to the Future', 1985], ['Inception', 2010],
        ['Gladiator', 2000], ['Fight Club', 1999], ['The Godfather Part II', 1974], ['E.T. the Extra-Terrestrial', 1982],
        ['Star Wars: Episode IV - A New Hope', 1977], ['Star Wars: Episode V - The Empire Strikes Back', 1980], ['Raiders of the Lost Ark', 1981], ['Jaws', 1975],
        ['The Silence of the Lambs', 1991], ['Schindler\'s List', 1993], ['Goodfellas', 1990], ['Scarface', 1983],
        ['The Lord of the Rings: The Fellowship of the Ring', 2001], ['The Lord of the Rings: The Return of the King', 2003],
        ['Terminator 2: Judgment Day', 1991], ['Saving Private Ryan', 1998], ['The Green Mile', 1999], ['Seven', 1995],
        ['Léon: The Professional', 1994], ['The Shining', 1980], ['Alien', 1979], ['Rocky', 1976], ['Taxi Driver', 1976],
        ['Casablanca', 1942], ['Psycho', 1960], ['2001: A Space Odyssey', 1968], ['Apocalypse Now', 1979],
        ['Amélie', 2001], ['The Intouchables', 2011], ['La Haine', 1995], ['Catch Me If You Can', 2002],
        ['The Departed', 2006], ['The Prestige', 2006], ['Django Unchained', 2012], ['Whiplash', 2014],
        ['Parasite', 2019], ['Spirited Away', 2003], ['Home Alone', 1990], ['The Sixth Sense', 1999], ['Heat', 1995]
      ]
    },
    disney: {
      title: 'Disney', version: 1, items: [
        ['Zootopia 2', 2025], ['Lilo & Stitch', 2025], ['Elio', 2025], ['Moana 2', 2024], ['Inside Out 2', 2024],
        ['Wish', 2023], ['Encanto', 2021], ['Luca', 2021], ['Raya and the Last Dragon', 2021], ['Soul', 2020],
        ['Frozen II', 2019], ['Toy Story 4', 2019], ['Coco', 2017], ['Moana', 2016], ['Zootopia', 2016],
        ['Inside Out', 2015], ['Big Hero 6', 2014], ['Frozen', 2013], ['Wreck-It Ralph', 2012], ['Brave', 2012],
        ['Tangled', 2010], ['Toy Story 3', 2010], ['Up', 2009], ['WALL·E', 2008], ['Ratatouille', 2007],
        ['Cars', 2006], ['The Incredibles', 2004], ['Finding Nemo', 2003], ['Pirates of the Caribbean: The Curse of the Black Pearl', 2003],
        ['Lilo & Stitch', 2002], ['Monsters, Inc.', 2001], ['Tarzan', 1999], ['Toy Story 2', 1999], ['Mulan', 1998],
        ['Hercules', 1997], ['Toy Story', 1995], ['Pocahontas', 1995], ['The Lion King', 1994], ['Aladdin', 1992],
        ['Beauty and the Beast', 1991], ['The Little Mermaid', 1989], ['The Jungle Book', 1967], ['Mary Poppins', 1964],
        ['Peter Pan', 1953], ['Cinderella', 1950], ['Pinocchio', 1940], ['Snow White and the Seven Dwarfs', 1937]
      ]
    },
    marvel: {
      title: 'Marvel', version: 1, items: [
        ['Spider-Man: Brand New Day', 2026], ['The Fantastic Four: First Steps', 2025], ['Thunderbolts*', 2025],
        ['Captain America: Brave New World', 2025], ['Deadpool & Wolverine', 2024], ['The Marvels', 2023],
        ['Guardians of the Galaxy Vol. 3', 2023], ['Ant-Man and the Wasp: Quantumania', 2023],
        ['Black Panther: Wakanda Forever', 2022], ['Thor: Love and Thunder', 2022], ['Doctor Strange in the Multiverse of Madness', 2022],
        ['Spider-Man: No Way Home', 2021], ['Eternals', 2021], ['Shang-Chi and the Legend of the Ten Rings', 2021], ['Black Widow', 2021],
        ['Spider-Man: Far from Home', 2019], ['Avengers: Endgame', 2019], ['Captain Marvel', 2019],
        ['Ant-Man and the Wasp', 2018], ['Avengers: Infinity War', 2018], ['Black Panther', 2018], ['Thor: Ragnarok', 2017],
        ['Spider-Man: Homecoming', 2017], ['Guardians of the Galaxy Vol. 2', 2017], ['Doctor Strange', 2016],
        ['Captain America: Civil War', 2016], ['Ant-Man', 2015], ['Avengers: Age of Ultron', 2015], ['Guardians of the Galaxy', 2014],
        ['Captain America: The Winter Soldier', 2014], ['Thor: The Dark World', 2013], ['Iron Man 3', 2013], ['The Avengers', 2012],
        ['Captain America: The First Avenger', 2011], ['Thor', 2011], ['Iron Man 2', 2010], ['The Incredible Hulk', 2008], ['Iron Man', 2008]
      ]
    }
  };

  /* Genres de Cinemeta (en anglais pour l'API, affichés en français) */
  var GENRES = [
    ['Action', 'Action', '#e5484d'], ['Comedy', 'Comédie', '#f5a524'], ['Horror', 'Horreur', '#7c1d1d'], ['Family', 'Famille', '#3e9b4f'],
    ['Animation', 'Animation', '#2f7de1'], ['Sci-Fi', 'Science-fiction', '#5b4bdb'], ['Thriller', 'Thriller', '#3f3f46'],
    ['Drama', 'Drame', '#8e4ec6'], ['Romance', 'Romance', '#d6409f'], ['Adventure', 'Aventure', '#c2681d'],
    ['Crime', 'Policier', '#52525b'], ['Fantasy', 'Fantastique', '#0d9488'], ['Mystery', 'Mystère', '#334155'],
    ['Documentary', 'Documentaire', '#0e7490'], ['War', 'Guerre', '#4d5d2c'], ['History', 'Histoire', '#92400e'],
    ['Biography', 'Biographie', '#6b7280'], ['Sport', 'Sport', '#15803d'], ['Western', 'Western', '#a16207']
  ];

  function load(k, d) { try { var v = localStorage.getItem('onyx.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem('onyx.' + k, JSON.stringify(v)); } catch (e) { } }

  function slim(m) {
    return {
      id: m.id, type: m.type || 'movie', name: m.name, poster: m.poster, background: m.background, logo: m.logo,
      releaseInfo: m.releaseInfo || m.year || '', imdbRating: m.imdbRating || '', description: m.description || '',
      genres: m.genres || m.genre || [], released: m.released || ''
    };
  }

  /* Retrouve un titre (nom + année) dans Cinemeta */
  function findTitle(name, year) {
    return S.fetchJSON(CINEMETA + '/catalog/movie/top/search=' + encodeURIComponent(name) + '.json', { ttl: 24 * 3600 * 1000, timeout: 15000 })
      .then(function (j) {
        var metas = (j && j.metas) || [];
        var y = function (m) { return parseInt(String(m.releaseInfo || m.year || '').slice(0, 4), 10); };
        var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
        return metas.filter(function (m) { return y(m) === year && norm(m.name) === norm(name); })[0]
          || metas.filter(function (m) { return Math.abs(y(m) - year) <= 1; })[0] || null;
      }).catch(function () { return null; });
  }

  /* Liste choisie à la main → fiches (mises en cache sur l'appareil) */
  function curated(key) {
    var L = LISTS[key];
    var cacheKey = 'coll.' + key;
    var cached = load(cacheKey, null);
    if (cached && cached.v === L.version && cached.items && cached.items.length && Date.now() - cached.t < 20 * 24 * 3600 * 1000) {
      return Promise.resolve(cached.items);
    }
    // premier lancement : liste intégrée à l'app (instantané), mise à jour en arrière-plan
    var seed = Onyx.CollectionsSeed && Onyx.CollectionsSeed[key];
    if (seed && seed.v === L.version && seed.items.length) {
      if (!curated['busy' + key]) {
        curated['busy' + key] = true;
        setTimeout(function () { resolveAll(key).then(function () { curated['busy' + key] = false; }); }, 15000);
      }
      return Promise.resolve(seed.items);
    }
    return resolveAll(key);
  }

  function resolveAll(key) {
    var L = LISTS[key];
    var cacheKey = 'coll.' + key;
    var out = new Array(L.items.length), i = 0;
    function worker() {
      if (i >= L.items.length) return Promise.resolve();
      var k = i++;
      return findTitle(L.items[k][0], L.items[k][1]).then(function (m) { out[k] = m ? slim(m) : null; return worker(); });
    }
    var workers = [];
    for (var w = 0; w < 6; w++) workers.push(worker());
    return Promise.all(workers).then(function () {
      var seen = {};
      var items = out.filter(function (m) { if (!m || seen[m.id]) return false; seen[m.id] = 1; return true; });
      if (items.length) save(cacheKey, { v: L.version, t: Date.now(), items: items });
      return items;
    });
  }

  /* Films sortis ces 5 derniers mois, les plus populaires d'abord */
  function cinema() {
    var now = Date.now(), from = now - 150 * 24 * 3600 * 1000;
    var pages = [0, 50, 100].map(function (skip) {
      return S.fetchJSON(CINEMETA + '/catalog/movie/top' + (skip ? '/skip=' + skip : '') + '.json', { ttl: 3 * 3600 * 1000 })
        .then(function (j) { return (j && j.metas) || []; }).catch(function () { return []; });
    });
    return Promise.all(pages).then(function (all) {
      var seen = {};
      return [].concat.apply([], all).filter(function (m) {
        var t = Date.parse(m.released || '');
        if (!t || t < from || t > now + 24 * 3600 * 1000 || seen[m.id]) return false;
        seen[m.id] = 1;
        return true;
      }).map(slim);
    });
  }

  /* Catégorie (genre) : films / séries populaires / mieux notés */
  function genre(g) {
    function cat(type, id) {
      return S.fetchJSON(CINEMETA + '/catalog/' + type + '/' + id + '/genre=' + encodeURIComponent(g) + '.json', { ttl: 3 * 3600 * 1000 })
        .then(function (j) { return ((j && j.metas) || []).map(function (m) { m.type = m.type || type; return slim(m); }); })
        .catch(function () { return []; });
    }
    var label = Onyx.genreFr(g);
    return Promise.all([cat('movie', 'top'), cat('series', 'top'), cat('movie', 'imdbRating'), cat('series', 'imdbRating')]).then(function (r) {
      return [
        { title: 'Films · ' + label, metas: r[0] },
        { title: 'Séries · ' + label, metas: r[1] },
        { title: 'Films les mieux notés · ' + label, metas: r[2] },
        { title: 'Séries les mieux notées · ' + label, metas: r[3] }
      ].filter(function (x) { return x.metas.length; });
    });
  }

  var GENRES_FR = {};
  GENRES.forEach(function (g) { GENRES_FR[g[0]] = g[1]; });
  GENRES_FR['Music'] = 'Musique'; GENRES_FR['Musical'] = 'Comédie musicale'; GENRES_FR['Reality-TV'] = 'Téléréalité';
  GENRES_FR['Talk-Show'] = 'Talk-show'; GENRES_FR['Game-Show'] = 'Jeu TV'; GENRES_FR['News'] = 'Actualités';
  Onyx.genreFr = function (g) { return GENRES_FR[g] || g; };

  Onyx.Collections = {
    GENRES: GENRES.map(function (g) { return { id: g[0], label: g[1], color: g[2] }; }),
    /* Lignes spéciales de l'accueil, dans l'ordre d'affichage */
    homeRows: [
      { key: 'cinema', title: 'Au cinéma', load: cinema, badge: 'NOUVEAU' },
      { key: 'classics', title: LISTS.classics.title, load: function () { return curated('classics'); } },
      { key: 'disney', title: LISTS.disney.title, load: function () { return curated('disney'); } },
      { key: 'marvel', title: LISTS.marvel.title, load: function () { return curated('marvel'); } }
    ],
    cinema: cinema,
    curated: curated,
    genre: genre
  };
})();
