/* Onyx — pont vers la couche native (Android TV / Windows) */
(function () {
  'use strict';
  var Onyx = window.Onyx;
  var N = window.OnyxNative || null;

  function call(name) {
    if (!N || typeof N[name] !== 'function') return null;
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      var r = N[name].apply(N, args);
      if (typeof r === 'string' && /^[\[{]/.test(r)) { try { return JSON.parse(r); } catch (e) { } }
      return r;
    } catch (e) { console.warn('native ' + name, e); return null; }
  }

  Onyx.native = {
    available: !!N,
    call: call,
    platform: function () { return call('platform') || 'web'; },
    isAndroid: function () { return Onyx.native.platform() === 'android-tv'; },
    isDesktop: function () { return Onyx.native.platform() === 'desktop'; },
    version: function () { return call('version') || 'dev'; },
    server: function () { return call('serverInfo') || null; },
    devices: function () { return call('devices') || []; },
    resetToken: function () { return call('resetToken'); },
    setState: function (state) { call('setState', JSON.stringify(state)); },
    play: function (opts) { return call('play', JSON.stringify(opts)); },
    openExternal: function (url, mime) { return call('openExternal', url, mime || ''); },
    checkUpdate: function (manual) { return call('checkUpdate', !!manual); },
    exit: function () { if (!call('exitApp')) window.close(); }
  };

  function listen(evt, busName) {
    window.addEventListener(evt, function (e) {
      var d = e.detail;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { } }
      Onyx.bus.emit(busName, d);
    });
  }
  listen('onyx-remote', 'remote');
  listen('onyx-player', 'native-player');
  listen('onyx-update', 'update');
  listen('onyx-key', 'native-key');
})();
