'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const C = require('./server/config');
const Game = require('./server/game');
const Db = require('./server/db');
const MysqlDb = require('./server/db-mysql');
const { acceptWebSocket } = require('./server/ws');

const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
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

// Datenbank für Accounts & Spielstände: MySQL/MariaDB, wenn MYSQL_URL gesetzt ist, sonst SQLite-Datei.
// Schlägt sie fehl, läuft das Spiel nur mit Gästen weiter.
async function openDb() {
  try {
    if (C.ACCOUNTS.mysqlUrl) {
      const db = await MysqlDb.open(C.ACCOUNTS.mysqlUrl);
      console.log('Datenbank: MySQL', C.ACCOUNTS.mysqlUrl.replace(/\/\/[^@]*@/, '//…@'));
      return db;
    }
    const file = path.resolve(__dirname, C.ACCOUNTS.dbPath);
    const db = new Db(file);
    console.log('Datenbank:', file);
    return db;
  } catch (e) {
    console.error('Datenbank nicht verfügbar – nur Gast-Modus:', e.message);
    return null;
  }
}

async function main() {
  const db = await openDb();
  const game = new Game({ db });

  // Beim Beenden (Ctrl+C, Neustart des Dienstes) alles speichern – bei MySQL warten, bis es geschrieben ist
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    try { game.saveAll(); } catch (e) { console.error('Speichern beim Beenden fehlgeschlagen:', e); }
    try { if (db) await db.close(); } catch (e) { console.error('Datenbank schließen fehlgeschlagen:', e); }
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.on('upgrade', (req, socket) => {
    if (req.url !== '/ws') return socket.destroy();
    acceptWebSocket(req, socket, (conn) => game.onConnection(conn));
  });

  // Spielschleife mit festen Schritten: Timer wecken unter Windows nur alle ~15,6 ms auf (setInterval(16,7)
  // ergibt dort abwechselnd 16 und 31 ms). Darum oft nachsehen und so viele 1/TICK_RATE-Schritte rechnen,
  // wie seit dem letzten Mal fällig sind. Die Clients spielen die Zustände anhand der Tick-Nummer ab,
  // unregelmäßiges Ankommen stört dann nicht.
  const STEP = 1 / C.TICK_RATE;
  const sendEvery = Math.max(1, Math.round(C.TICK_RATE / C.SEND_RATE));
  let last = process.hrtime.bigint(), behind = 0;
  setInterval(() => {
    const now = process.hrtime.bigint();
    behind = Math.min(behind + Number(now - last) / 1e9, STEP * 5); // nach einem Hänger nicht endlos aufholen
    last = now;
    while (behind >= STEP) {
      behind -= STEP;
      const t0 = process.hrtime.bigint();
      game.update(STEP);
      if (game.tick % sendEvery === 0) game.sendState();
      game.recordTickTime(Number(process.hrtime.bigint() - t0) / 1e6);
    }
  }, 4);

  server.listen(C.PORT, () => {
    console.log(`Server läuft auf http://localhost:${C.PORT}`);
  });
}

main();
