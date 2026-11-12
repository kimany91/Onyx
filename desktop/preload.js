/* Onyx — pont entre l'interface et Electron (mêmes fonctions que sur Android) */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (name) => (...args) => ipcRenderer.sendSync('onyx', name, args);
const api = {};
['platform', 'version', 'serverInfo', 'devices', 'resetToken', 'setState', 'play', 'openExternal', 'toggleFullscreen', 'checkUpdate', 'exitApp']
  .forEach((n) => { api[n] = call(n); });
contextBridge.exposeInMainWorld('OnyxNative', api);

['onyx-remote', 'onyx-update', 'onyx-player', 'onyx-key'].forEach((ch) => {
  ipcRenderer.on(ch, (e, data) => window.dispatchEvent(new CustomEvent(ch, { detail: data })));
});
