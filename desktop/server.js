/* Onyx — serveur de connexion (téléphone ⇄ PC), même API que l'app Android TV */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp'
};

function lanIp() {
  const nets = os.networkInterfaces();
  let best = null;
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family !== 'IPv4' && n.family !== 4) continue;
      if (n.internal) continue;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address)) {
        if (!best || /^192\.168\./.test(n.address)) best = n.address;
      } else if (!best) best = n.address;
    }
  }
  return best || '127.0.0.1';
}

class RemoteServer {
  constructor(opts) {
    this.webDir = opts.webDir;
    this.port = opts.port || 8765;
    this.dataFile = opts.dataFile || null;
    this.onCommand = opts.onCommand || (() => {});
    this.version = opts.version || 'dev';
    this.platform = opts.platform || 'desktop';
    this.state = {};
    this.progress = '{}';
    this.devicesMap = {};
    this.token = this._load().token || this._newToken();
  }
  _load() { try { return JSON.parse(fs.readFileSync(this.dataFile, 'utf8')); } catch (e) { return {}; } }
  _save() { if (this.dataFile) try { fs.mkdirSync(path.dirname(this.dataFile), { recursive: true }); fs.writeFileSync(this.dataFile, JSON.stringify({ token: this.token })); } catch (e) { } }
  _newToken() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let t = '';
    const b = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) t += alphabet[b[i] % alphabet.length];
    this.token = t;
    this._save();
    return t;
  }
  resetToken() { this.devicesMap = {}; return this._newToken(); }

  start() {
    return new Promise((resolve) => {
      const tryPort = (p, left) => {
        const srv = http.createServer((req, res) => this._handle(req, res));
        srv.once('error', () => { if (left > 0) tryPort(p + 1, left - 1); else resolve(null); });
        srv.listen(p, '0.0.0.0', () => { this.server = srv; this.port = p; resolve(p); });
      };
      tryPort(this.port, 10);
    });
  }
  stop() { if (this.server) this.server.close(); }

  info() {
    const ip = lanIp();
    const url = `http://${ip}:${this.port}`;
    return { ip, port: this.port, url, token: this.token, pairUrl: `${url}/remote/?token=${this.token}` };
  }
  devices() { return Object.values(this.devicesMap); }
  setState(json) { try { this.state = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { } }
  setProgress(json) { this.progress = typeof json === 'string' ? json : JSON.stringify(json || {}); }

  _cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Onyx-Token, X-Onyx-Device');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  _json(res, code, obj) {
    this._cors(res);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }
  _authed(req, url) {
    const t = req.headers['x-onyx-token'] || url.searchParams.get('token');
    if (t !== this.token) return false;
    const name = String(req.headers['x-onyx-device'] || 'Téléphone').slice(0, 60);
    const ip = req.socket.remoteAddress;
    const key = name + '@' + ip;
    this.devicesMap[key] = { name, ip, lastSeen: Date.now() };
    return true;
  }

  _handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'OPTIONS') { this._cors(res); res.writeHead(204); return res.end(); }
    if (p === '/api/ping') return this._json(res, 200, { app: 'onyx', name: this.state.tvName || 'Onyx', version: this.version, platform: this.platform });
    if (p.indexOf('/api/') === 0) {
      if (!this._authed(req, url)) return this._json(res, 401, { error: 'unauthorized' });
      if (p === '/api/state' && req.method === 'GET') return this._json(res, 200, this.state || {});
      if (p === '/api/progress' && req.method === 'GET') {
        this._cors(res);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(this.progress || '{}');
      }
      if (p === '/api/progress' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
        req.on('end', () => {
          let entries = {};
          try { entries = JSON.parse(body || '{}').entries || {}; } catch (e) { }
          try { this.onCommand({ action: 'progress-merge', entries }); } catch (e) { }
          this._json(res, 200, { ok: true });
        });
        return;
      }
      if (p === '/api/cmd' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
        req.on('end', () => {
          let cmd;
          try { cmd = JSON.parse(body || '{}'); } catch (e) { return this._json(res, 400, { error: 'bad json' }); }
          try { this.onCommand(cmd); } catch (e) { }
          this._json(res, 200, { ok: true });
        });
        return;
      }
      return this._json(res, 404, { error: 'not found' });
    }
    // fichiers statiques (interface téléphone)
    if (p === '/' || p === '/remote') { res.writeHead(302, { Location: '/remote/' + url.search }); return res.end(); }
    let rel = decodeURIComponent(p).replace(/^\/+/, '');
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(this.webDir, rel));
    if (file.indexOf(path.normalize(this.webDir)) !== 0) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      this._cors(res);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }
}

module.exports = { RemoteServer, lanIp };

// Lancement autonome pour les tests : node server.js
if (require.main === module) {
  const s = new RemoteServer({ webDir: path.join(__dirname, '..', 'web'), onCommand: (c) => console.log('cmd', JSON.stringify(c)) });
  s.start().then((port) => console.log('Onyx remote server on', port, s.info().pairUrl));
}
