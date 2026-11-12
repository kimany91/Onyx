/* Onyx — version Windows (Electron) */
'use strict';
const { app, BrowserWindow, ipcMain, shell, globalShortcut, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { RemoteServer } = require('./server');

let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { autoUpdater = null; }

const WEB_DIR = fs.existsSync(path.join(__dirname, 'web', 'index.html')) ? path.join(__dirname, 'web') : path.join(__dirname, '..', 'web');
let win = null;
let server = null;

if (!app.requestSingleInstanceLock()) { app.quit(); }

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, typeof data === 'string' ? data : JSON.stringify(data));
}

function findVlc() {
  const c = [
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'VideoLAN', 'VLC', 'vlc.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VideoLAN', 'VLC', 'vlc.exe'),
    '/usr/bin/vlc', '/Applications/VLC.app/Contents/MacOS/VLC'
  ];
  return c.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 540,
    backgroundColor: '#000000', title: 'Onyx', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(WEB_DIR, 'index.html'));
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12') win.webContents.toggleDevTools();
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

const handlers = {
  platform: () => 'desktop',
  version: () => app.getVersion(),
  serverInfo: () => (server ? JSON.stringify(server.info()) : null),
  devices: () => JSON.stringify(server ? server.devices() : []),
  resetToken: () => (server ? server.resetToken() : null),
  setState: (json) => { if (server) server.setState(json); return true; },
  play: () => false,
  openExternal: (url, mime) => {
    if (mime && /^video/.test(mime)) {
      const vlc = findVlc();
      if (vlc) { spawn(vlc, ['--fullscreen', url], { detached: true, stdio: 'ignore' }).unref(); return true; }
    }
    shell.openExternal(url);
    return true;
  },
  toggleFullscreen: () => { if (win) win.setFullScreen(!win.isFullScreen()); return true; },
  checkUpdate: (manual) => { checkUpdate(!!manual); return true; },
  exitApp: () => { app.quit(); return true; }
};

ipcMain.on('onyx', (e, name, args) => {
  try { e.returnValue = handlers[name] ? handlers[name].apply(null, args || []) : null; }
  catch (err) { e.returnValue = null; }
});

function checkUpdate(manual) {
  if (!autoUpdater || !app.isPackaged) {
    if (manual) send('onyx-update', { status: 'none', manual: true });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.removeAllListeners();
  autoUpdater.on('update-available', (i) => send('onyx-update', { status: 'available', version: i.version, manual }));
  autoUpdater.on('update-not-available', () => send('onyx-update', { status: 'none', manual }));
  autoUpdater.on('download-progress', (p) => send('onyx-update', { status: 'downloading', progress: Math.round(p.percent) }));
  autoUpdater.on('error', (err) => send('onyx-update', { status: 'error', message: String(err && err.message || err).slice(0, 120), manual }));
  autoUpdater.on('update-downloaded', () => {
    send('onyx-update', { status: 'ready' });
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 4000);
  });
  autoUpdater.checkForUpdates().catch(() => {});
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  server = new RemoteServer({
    webDir: WEB_DIR,
    dataFile: path.join(app.getPath('userData'), 'remote.json'),
    version: app.getVersion(),
    platform: 'desktop',
    onCommand: (cmd) => {
      send('onyx-remote', cmd);
      if (cmd && cmd.action === 'key' && win) { if (win.isMinimized()) win.restore(); }
    }
  });
  await server.start();
  createWindow();
  // vérification périodique des mises à jour (toutes les 6 h)
  setInterval(() => checkUpdate(false), 6 * 3600 * 1000);
});

app.on('window-all-closed', () => { if (server) server.stop(); app.quit(); });
