/* Onyx — clavier virtuel pour la télécommande */
(function () {
  'use strict';
  var Onyx = window.Onyx, h = Onyx.h;

  var LAYOUTS = {
    abc: ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz1234', '567890'],
    ABC: ['ABCDEF', 'GHIJKL', 'MNOPQR', 'STUVWX', 'YZ1234', '567890'],
    sym: ['.-_/:@', '?=&#%+', '!*\'()~', ',;$[]{', '}<>|^\\', 'éèàçù"']
  };

  /* Crée un clavier. opts: {value, onChange(value), onSubmit, symbols:bool, compact} */
  Onyx.keyboard = function (opts) {
    opts = opts || {};
    var value = opts.value || '';
    var mode = 'abc';
    var grid = h('div.kb-grid', { 'data-remember': '' });
    var root = h('div.keyboard', [grid]);

    function set(v) { value = v; if (opts.onChange) opts.onChange(value); }
    function key(label, fn, cls) {
      var k = h('button.kb-key.f' + (cls ? '.' + cls : ''), { type: 'button', html: label });
      k.addEventListener('click', fn);
      return k;
    }
    function render() {
      var keep = Onyx.focus.cur && grid.contains(Onyx.focus.cur) ? Onyx.focus.cur.dataset.k : null;
      grid.innerHTML = '';
      var row0 = h('div.kb-row');
      row0.appendChild(key('<svg viewBox="0 0 24 24" class="ico"><path d="M2 11h20v2H2z" opacity=".001"/><path d="M4 15v-4h2v2h12v-2h2v4z"/></svg>', function () { set(value + ' '); }, 'wide space'));
      row0.appendChild(key('<svg viewBox="0 0 24 24" class="ico"><path d="M21 5H8l-6 7 6 7h13a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zm-3.6 10.6L16 17l-3-3-3 3-1.4-1.4 3-3-3-3L10 8l3 3 3-3 1.4 1.4-3 3z"/></svg>', function () { set(value.slice(0, -1)); }, 'wide'));
      grid.appendChild(row0);
      LAYOUTS[mode].forEach(function (line) {
        var r = h('div.kb-row');
        line.split('').forEach(function (ch) {
          var k = key(Onyx.esc(ch), function () { set(value + ch); });
          k.dataset.k = ch;
          r.appendChild(k);
        });
        grid.appendChild(r);
      });
      var last = h('div.kb-row');
      last.appendChild(key(mode === 'ABC' ? 'abc' : 'ABC', function () { mode = mode === 'ABC' ? 'abc' : 'ABC'; render(); }, 'wide'));
      if (opts.symbols) last.appendChild(key(mode === 'sym' ? 'abc' : '#+=', function () { mode = mode === 'sym' ? 'abc' : 'sym'; render(); }, 'wide'));
      else last.appendChild(key('Effacer', function () { set(''); }, 'wide'));
      if (opts.symbols) {
        grid.appendChild(last);
        last = h('div.kb-row');
        last.appendChild(key('.com', function () { set(value + '.com'); }, 'wide'));
        last.appendChild(key('Effacer', function () { set(''); }, 'wide'));
      }
      grid.appendChild(last);
      if (keep) {
        var again = Onyx.$$('.kb-key', grid).filter(function (k) { return k.dataset.k && k.dataset.k.toLowerCase() === keep.toLowerCase(); })[0];
        if (again) Onyx.focus.set(again);
      }
    }
    render();
    root.setValue = function (v) { value = v || ''; };
    root.getValue = function () { return value; };
    return root;
  };

  /* Fenêtre de saisie : renvoie une promesse avec le texte (ou null) */
  Onyx.prompt = function (title, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var api, done = false;
      var display = h('div.prompt-value' + (opts.password ? '.password' : ''));
      var hint = h('p.prompt-hint', { html: Onyx.icons.phone + '<span>Astuce : tape le texte depuis l\'app Onyx Remote de ton téléphone.</span>' });
      function show(v) {
        display.textContent = opts.password ? v.replace(/./g, '•') : v;
        if (!v) display.innerHTML = '<span class="placeholder">' + Onyx.esc(opts.placeholder || '') + '</span>';
        display.appendChild(h('i.caret'));
      }
      var kb = Onyx.keyboard({ value: opts.value || '', symbols: opts.symbols !== false, onChange: show });
      show(opts.value || '');
      var ok = Onyx.btn(opts.okLabel || 'Valider', 'check', function () { finish(kb.getValue()); }, 'primary');
      var cancel = Onyx.btn('Annuler', null, function () { finish(null); });
      function finish(v) { if (done) return; done = true; Onyx.bus.off('remote-text', onRemote); api.close(true); resolve(v); }
      function onRemote(t) { kb.setValue(t); show(t); }
      Onyx.bus.on('remote-text', onRemote);
      api = Onyx.modal(h('div.dialog.prompt', [
        h('h2', { text: title }),
        opts.text ? h('p', { text: opts.text }) : null,
        display, kb, h('div.dialog-actions', [ok, cancel]), hint
      ]), { onClose: function () { if (!done) { done = true; Onyx.bus.off('remote-text', onRemote); resolve(null); } } });
      // clavier physique (PC)
      function onKey(e) {
        if (!api.el.isConnected) { window.removeEventListener('keydown', onKey, true); return; }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.keyCode === 8) { kb.setValue(kb.getValue().slice(0, -1)); }
        else if (e.key && e.key.length === 1) { kb.setValue(kb.getValue() + e.key); }
        else return;
        e.preventDefault(); e.stopPropagation();
        show(kb.getValue());
      }
      window.addEventListener('keydown', onKey, true);
      // collage depuis le presse-papiers (PC)
      document.addEventListener('paste', function onPaste(e) {
        if (!api.el.isConnected) { document.removeEventListener('paste', onPaste); return; }
        var t = (e.clipboardData && e.clipboardData.getData('text')) || '';
        kb.setValue(kb.getValue() + t); show(kb.getValue());
      });
    });
  };
})();
