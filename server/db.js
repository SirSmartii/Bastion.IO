'use strict';
// Persistenz über SQLite (node:sqlite, in Node ≥ 22.13 eingebaut – keine npm-Pakete nötig).
// Tabellen: accounts (Login, is_admin), characters (Spielstand als JSON), bases (Gebäude als JSON), meta (Welt-Seed, Uhrzeit),
// bans (nach Account und/oder IP), sessions (jede Spielsitzung, für die Statistik im Admin-Menü), daily (Seitenaufrufe pro Tag).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  username_lc TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
CREATE TABLE IF NOT EXISTS characters (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bases (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  ip TEXT,
  name TEXT NOT NULL,
  reason TEXT NOT NULL,
  until INTEGER,
  created_at INTEGER NOT NULL,
  by_name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  account_id INTEGER,
  name TEXT NOT NULL,
  ip TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_started ON sessions(started_at);
CREATE TABLE IF NOT EXISTS daily (
  day TEXT PRIMARY KEY,
  views INTEGER NOT NULL,
  visitors INTEGER NOT NULL
);
`;

// Fehlermeldung, die der Spieler sehen darf
const nameTaken = () => Object.assign(new Error('Dieser Name ist schon vergeben.'), { forPlayer: true });

const hash = (pass, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(pass, salt, 32, (err, key) => (err ? reject(err) : resolve(key.toString('hex'))));
});

class Db {
  constructor(file) {
    const { DatabaseSync } = require('node:sqlite');
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    // Ältere Datenbanken: Admin-Spalte nachrüsten (Admin vergeben: UPDATE accounts SET is_admin = 1 WHERE username = '…')
    if (!this.db.prepare('PRAGMA table_info(accounts)').all().some((c) => c.name === 'is_admin')) {
      this.db.exec('ALTER TABLE accounts ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
    }
    const q = (sql) => this.db.prepare(sql);
    this.q = {
      findAcc: q('SELECT * FROM accounts WHERE username_lc = ?'),
      addAcc: q('INSERT INTO accounts (username, username_lc, pass_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)'),
      touchAcc: q('UPDATE accounts SET last_login = ? WHERE id = ?'),
      getChar: q('SELECT data FROM characters WHERE account_id = ?'),
      putChar: q('INSERT INTO characters (account_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'),
      allBases: q('SELECT account_id, data FROM bases'),
      putBase: q('INSERT INTO bases (account_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'),
      delBase: q('DELETE FROM bases WHERE account_id = ?'),
      getMeta: q('SELECT value FROM meta WHERE key = ?'),
      putMeta: q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      addBan: q('INSERT INTO bans (account_id, ip, name, reason, until, created_at, by_name) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      delBan: q('DELETE FROM bans WHERE id = ?'),
      startSession: q('INSERT OR REPLACE INTO sessions (sid, account_id, name, ip, started_at) VALUES (?, ?, ?, ?, ?)'),
      endSession: q('UPDATE sessions SET ended_at = ? WHERE sid = ?'),
      sessionsSince: q('SELECT * FROM sessions WHERE started_at >= ? ORDER BY started_at'),
      putDaily: q('INSERT INTO daily (day, views, visitors) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET views = excluded.views, visitors = excluded.visitors'),
      countAcc: q('SELECT COUNT(*) AS n FROM accounts'),
    };
    // Bans und Tageszahlen liegen zusätzlich im Speicher (beim Beitreten wird synchron geprüft)
    this.bans = this.db.prepare('SELECT * FROM bans').all();
    this.daily = new Map(this.db.prepare('SELECT * FROM daily').all().map((d) => [d.day, { views: d.views, visitors: d.visitors }]));
  }

  // ---------- Accounts ----------

  findAccount(username) {
    return this.q.findAcc.get(String(username).toLowerCase()) || null;
  }

  async register(username, pass) {
    if (this.findAccount(username)) throw nameTaken();
    const salt = crypto.randomBytes(16).toString('hex');
    const h = await hash(pass, salt);
    // Zweiter Check nach dem (asynchronen) Hashen: jemand könnte den Namen inzwischen belegt haben
    if (this.findAccount(username)) throw nameTaken();
    const r = this.q.addAcc.run(username, username.toLowerCase(), h, salt, Date.now());
    return { id: Number(r.lastInsertRowid), username };
  }

  // Liefert den Account bei richtigem Passwort, sonst null
  async login(username, pass) {
    const acc = this.findAccount(username);
    if (!acc) return null;
    const h = await hash(pass, acc.salt);
    const a = Buffer.from(h, 'hex'), b = Buffer.from(acc.pass_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    this.q.touchAcc.run(Date.now(), acc.id);
    return { id: acc.id, username: acc.username, admin: !!acc.is_admin };
  }

  // ---------- Spielstände ----------

  loadCharacter(accountId) {
    const row = this.q.getChar.get(accountId);
    return row ? JSON.parse(row.data) : null;
  }

  saveCharacter(accountId, data) {
    this.q.putChar.run(accountId, JSON.stringify(data), Date.now());
  }

  loadBases() {
    return this.q.allBases.all().map((r) => ({ accountId: r.account_id, structures: JSON.parse(r.data) }));
  }

  saveBase(accountId, structures) {
    this.q.putBase.run(accountId, JSON.stringify(structures), Date.now());
  }

  deleteBase(accountId) {
    this.q.delBase.run(accountId);
  }

  getMeta(key) {
    const row = this.q.getMeta.get(key);
    return row ? row.value : null;
  }

  setMeta(key, value) {
    this.q.putMeta.run(key, String(value));
  }

  // ---------- Admin: Bans, Sitzungen, Statistik ----------
  // Gleiche Schnittstelle wie db-mysql.js – darum geben die Abfragen Promises zurück.

  async addBan(ban) {
    const r = this.q.addBan.run(ban.account_id ?? null, ban.ip ?? null, ban.name, ban.reason, ban.until ?? null, ban.created_at, ban.by_name);
    const row = { ...ban, id: Number(r.lastInsertRowid) };
    this.bans.push(row);
    return row;
  }

  async removeBan(id) {
    this.q.delBan.run(id);
    this.bans = this.bans.filter((b) => b.id !== id);
  }

  startSession(s) { this.q.startSession.run(s.sid, s.account_id ?? null, s.name, s.ip ?? null, s.started_at); }
  endSession(sid, at) { this.q.endSession.run(at, sid); }
  async sessionsSince(t) { return this.q.sessionsSince.all(t); }
  async countAccounts() { return Number(this.q.countAcc.get().n); }

  putDaily(day, views, visitors) {
    this.daily.set(day, { views, visitors });
    this.q.putDaily.run(day, views, visitors);
  }

  // Mehrere Schreibvorgänge atomar
  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  close() { this.db.close(); }
}

module.exports = Db;
