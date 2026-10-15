'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const C = require('./server/config');
const Game = require('./server/game');
const Db = require('./server/db');
const { acceptWebSocket } = require('./server/ws');

const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch (_) { url = '/'; }
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// Datenbank für Accounts & Spielstände; schlägt sie fehl, läuft das Spiel nur mit Gästen weiter
let db = null;
try {
  db = new Db(path.resolve(__dirname, C.ACCOUNTS.dbPath));
  console.log('Datenbank:', path.resolve(__dirname, C.ACCOUNTS.dbPath));
} catch (e) {
  console.error('Datenbank nicht verfügbar – nur Gast-Modus:', e.message);
}
const game = new Game({ db });

// Beim Beenden (Ctrl+C, Deploy/Neustart auf Render) alles speichern
function shutdown() {
  try { game.saveAll(); } catch (e) { console.error('Speichern beim Beenden fehlgeschlagen:', e); }
  if (db) db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws') return socket.destroy();
  acceptWebSocket(req, socket, (conn) => game.onConnection(conn));
});

let last = process.hrtime.bigint();
let tick = 0;
const sendEvery = Math.max(1, Math.round(C.TICK_RATE / C.SEND_RATE));
setInterval(() => {
  const now = process.hrtime.bigint();
  const dt = Math.min(Number(now - last) / 1e9, 0.1);
  last = now;
  game.update(dt);
  if (++tick % sendEvery === 0) game.sendState();
}, 1000 / C.TICK_RATE);

server.listen(C.PORT, () => {
  console.log(`Server läuft auf http://localhost:${C.PORT}`);
});
