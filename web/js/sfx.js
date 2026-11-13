/* Onyx — sons de l'interface.
   Tous les sons sont synthétisés en direct (Web Audio) : rien à télécharger.
   Esprit console de salon : petits « tics » cristallins pour la navigation,
   carillon doux pour valider, souffle + accord pour lancer un film. */
(function () {
  'use strict';
  var Onyx = window.Onyx = window.Onyx || {};
  var ctx = null, master = null, noiseBuf = null, lastMove = 0;

  function enabled() { try { return Onyx.settings ? Onyx.settings.get('sounds') !== false : true; } catch (e) { return true; } }
  function ac() {
    if (!ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { ctx = new C(); } catch (e) { return null; }
      master = ctx.createGain(); master.gain.value = 0.55;
      // léger écho (réverbération courte) : donne de la profondeur sans trainer
      var delay = ctx.createDelay(); delay.delayTime.value = 0.09;
      var fb = ctx.createGain(); fb.gain.value = 0.22;
      var wet = ctx.createGain(); wet.gain.value = 0.18;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
      master.connect(ctx.destination);
      master.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(wet); wet.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') try { ctx.resume(); } catch (e) { }
    return ctx;
  }
  /* Note avec attaque rapide et extinction douce */
  function tone(f, at, dur, vol, type, glide, attack) {
    var c = ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, at);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, at + dur);
    var a = attack || 0.004;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + a);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(master);
    o.start(at); o.stop(at + dur + 0.05);
  }
  function noise() {
    if (noiseBuf) return noiseBuf;
    var len = ctx.sampleRate * 2, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return (noiseBuf = b);
  }
  /* Souffle filtré qui monte (lancement) */
  function whoosh(at, dur, from, to, vol) {
    var src = ctx.createBufferSource(); src.buffer = noise();
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(from, at); bp.frequency.exponentialRampToValueAtTime(to, at + dur * 0.8);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(at); src.stop(at + dur + 0.05);
  }

  var SOUNDS = {
    // déplacement : tic cristallin très court, hauteur légèrement variable
    move: function (t, o) {
      var f = (o && o.vertical ? 1480 : 1760) * (1 + (Math.random() - 0.5) * 0.03);
      tone(f, t, 0.045, 0.05, 'sine');
      tone(f * 2, t, 0.03, 0.012, 'triangle');
    },
    // validation : deux notes de verre (quinte)
    select: function (t) {
      tone(1046.5, t, 0.22, 0.07, 'sine');
      tone(2093, t, 0.12, 0.015, 'sine');
      tone(1568, t + 0.055, 0.32, 0.06, 'sine');
      tone(3136, t + 0.055, 0.14, 0.012, 'sine');
    },
    // retour : petite note qui descend
    back: function (t) { tone(1318.5, t, 0.16, 0.055, 'sine', 880); },
    // ouverture d'une fiche / d'un menu
    open: function (t) { tone(784, t, 0.18, 0.045, 'sine', 1175); tone(1568, t + 0.03, 0.14, 0.015, 'sine'); },
    // lancement d'un film : souffle ascendant + accord lumineux qui gonfle
    launch: function (t) {
      whoosh(t, 1.5, 300, 4200, 0.16);
      [523.25, 659.25, 783.99, 987.77, 1318.5].forEach(function (f, i) {
        tone(f, t + 0.08 + i * 0.045, 1.7, 0.045 - i * 0.004, 'sine', null, 0.32);
      });
      tone(130.8, t, 1.2, 0.07, 'sine', null, 0.25); // assise grave
    },
    // impossible / bord de liste : bruit sourd et feutré
    bump: function (t) { tone(220, t, 0.09, 0.04, 'triangle', 180); },
    error: function (t) { tone(311, t, 0.16, 0.05, 'triangle'); tone(233, t + 0.12, 0.22, 0.05, 'triangle'); }
  };

  Onyx.sfx = function (name, opts) {
    if (!enabled() || !SOUNDS[name]) return;
    if (name === 'move') { var now = Date.now(); if (now - lastMove < 35) return; lastMove = now; }
    var c = ac(); if (!c) return;
    try { SOUNDS[name](c.currentTime + 0.005, opts); } catch (e) { }
  };
  // le premier geste de l'utilisateur débloque l'audio (règle des navigateurs)
  ['keydown', 'touchstart', 'mousedown'].forEach(function (ev) {
    document.addEventListener(ev, function () { if (enabled()) ac(); }, { once: true, capture: true, passive: true });
  });
})();
