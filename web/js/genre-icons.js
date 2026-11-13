/* Onyx — icônes minimalistes des catégories (trait fin, style Apple).
   Chaque icône est dessinée en traits blancs ; les éléments marqués « m »
   portent une petite animation propre à la catégorie quand la carte est sélectionnée. */
(function () {
  'use strict';
  var Onyx = window.Onyx = window.Onyx || {};

  function p(d, cls) { return '<path pathLength="1"' + (cls ? ' class="' + cls + '"' : '') + ' d="' + d + '"/>'; }
  function c(x, y, r, cls) { return '<circle pathLength="1"' + (cls ? ' class="' + cls + '"' : '') + ' cx="' + x + '" cy="' + y + '" r="' + r + '"/>'; }
  function g(cls, inner) { return '<g class="' + cls + '">' + inner + '</g>'; }

  var ICONS = {
    // éclair
    Action: g('m', p('M27 5 12 27h11l-3 16 16-23H25l2-15z')),
    // sourire
    Comedy: c(24, 24, 17) + g('m', p('M17.5 20v2M30.5 20v2') + p('M15.5 28.5c4.6 6.2 12.4 6.2 17 0')),
    // citrouille
    Horror: g('m', p('M24 15c-11 0-17 6.5-17 14.5S13 43 24 43s17-5.5 17-13.5S35 15 24 15z') +
      p('M24 15c-4.6 0-7.4 6.5-7.4 14.5S19.4 43 24 43s7.4-5.5 7.4-13.5S28.6 15 24 15z') +
      p('M24 15c0-4 1.3-7 4.5-9.2') + p('M28.5 9.5c3.2-1.6 6.4-.7 7.6 1.6-3 1.6-6 1.3-7.6-1.6z')),
    // maison + cœur
    Family: p('M7 22.5 24 8l17 14.5') + p('M11 19.5V41h26V19.5') +
      g('m', p('M24 35.5s-7-4.3-7-9.2a3.9 3.9 0 0 1 7-2.3 3.9 3.9 0 0 1 7 2.3c0 4.9-7 9.2-7 9.2z')),
    // étincelles
    Animation: g('m', p('M20 8c1 7.5 3.5 10 11 11-7.5 1-10 3.5-11 11-1-7.5-3.5-10-11-11 7.5-1 10-3.5 11-11z')) +
      g('m2', p('M35 27c.6 4.4 2 5.8 6.4 6.4-4.4.6-5.8 2-6.4 6.4-.6-4.4-2-5.8-6.4-6.4 4.4-.6 5.8-2 6.4-6.4z')) +
      g('m3', p('M35 6.5c.4 2.6 1.3 3.5 3.9 3.9-2.6.4-3.5 1.3-3.9 3.9-.4-2.6-1.3-3.5-3.9-3.9 2.6-.4 3.5-1.3 3.9-3.9z')),
    // fusée
    'Sci-Fi': g('m', p('M24 5c6.5 5.5 9 12.5 8 22l-4 5h-8l-4-5c-1-9.5 1.5-16.5 8-22z') + c(24, 18.5, 3.2) +
      p('M16.4 25.5 11 31v6l7.5-5M31.6 25.5 37 31v6l-7.5-5')) + g('m2', p('M21.5 36.5c0 3 1 5 2.5 7 1.5-2 2.5-4 2.5-7')),
    // œil
    Thriller: p('M4.5 24S11.5 12 24 12s19.5 12 19.5 12S36.5 36 24 36 4.5 24 4.5 24z') + g('m', c(24, 24, 6.5) + c(24, 24, 1.6)),
    // masque de théâtre
    Drama: g('m', p('M11 9h26v13c0 10.5-6 18-13 18s-13-7.5-13-18V9z') + p('M16.5 19.5c1.6-1.4 3.8-1.4 5.4 0M26.1 19.5c1.6-1.4 3.8-1.4 5.4 0') +
      p('M18.5 32c3.4-3.4 7.6-3.4 11 0')),
    // cœur
    Romance: g('m', p('M24 41S6 30.5 6 18.5A9.5 9.5 0 0 1 24 13a9.5 9.5 0 0 1 18 5.5C42 30.5 24 41 24 41z')),
    // boussole
    Adventure: c(24, 24, 18) + g('m', p('M30.5 17.5 26.8 26.8 17.5 30.5l3.7-9.3 9.3-3.7z') + c(24, 24, 1)),
    // empreinte digitale
    Crime: g('m', p('M12.5 20.5a12 12 0 0 1 23 0M10 30a20 20 0 0 1 0-6M38 24c.4 4 0 8-1 11') +
      p('M17 33c-.5-3-.6-6 .2-8.6a7 7 0 0 1 13.6 0c.8 3 .5 7-.6 10.6M21.6 38c-1.2-3.4-1.6-7-1-10.2a3.5 3.5 0 0 1 6.8 0c.6 3.2 0 6.6-1 9.2M24 28v6')),
    // château
    Fantasy: p('M9 41V18h5v4h4v-4h4v4h4v-4h4v4h4v-4h5v23z') + g('m', p('M20.5 41v-7a3.5 3.5 0 0 1 7 0v7')) +
      p('M24 18V8.5') + g('m2', p('M24 8.5h7l-2 2.4 2 2.4h-7')),
    // loupe
    Mystery: g('m', c(20.5, 20.5, 12.5) + p('M29.5 29.5 41.5 41.5') + p('M14 18.5a7 7 0 0 1 4.6-4.6')),
    // caméra
    Documentary: p('M6 15.5h23a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3z') +
      p('M32 21.5 44 15v18l-12-6.5') + g('m', c(10, 22, 1.6)),
    // épées croisées
    War: g('m', p('M9.5 9.5 31 31M9.5 9.5l.5 4.5M9.5 9.5l4.5.5M26.5 35.5l9-9M31 31l7.5 7.5')) +
      g('m2', p('M38.5 9.5 17 31M38.5 9.5l-.5 4.5M38.5 9.5l-4.5.5M21.5 35.5l-9-9M17 31l-7.5 7.5')),
    // colonne antique
    History: p('M8 13 24 6l16 7z') + p('M10 16.5h28M12.5 19.5v17M19 19.5v17M29 19.5v17M35.5 19.5v17M10 39.5h28M7 42.5h34') +
      g('m', p('M24 21v14')),
    // plume
    Biography: g('m', p('M39 7C25 9 15.5 18 12.5 34.5L10 41') + p('M39 7c.5 9-4 18-14.5 22.5-3.5 1.4-7.4 1.7-11 1.4') +
      p('M18 26.5l7 0M22.5 20.5l8 0')),
    // trophée
    Sport: g('m', p('M15 7h18v10a9 9 0 0 1-18 0V7z') + p('M15 10H9.5v2.5a6 6 0 0 0 6 6M33 10h5.5v2.5a6 6 0 0 1-6 6') +
      p('M24 26v8M17 41h14l-1.5-7h-11z')),
    // cactus
    Western: g('m', p('M20 42V12a4 4 0 0 1 8 0v30') + p('M20 28h-5a4 4 0 0 1-4-4v-6a2.5 2.5 0 0 1 5 0v5h4') +
      p('M28 24h4v-6.5a2.5 2.5 0 0 1 5 0V23a5 5 0 0 1-5 5h-4')) + p('M10 42h28')
  };

  Onyx.genreIcon = function (id) {
    var inner = ICONS[id] || c(24, 24, 16);
    return '<svg viewBox="0 0 48 48" class="gicon gi-' + String(id).replace(/[^A-Za-z]/g, '') + '" aria-hidden="true" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  };
})();
