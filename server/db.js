'use strict';
// Persistenz über SQLite (node:sqlite, in Node ≥ 22.13 eingebaut – keine npm-Pakete nötig).
// Tabellen: accounts (Login), characters (Spielstand als JSON), bases (Gebäude als JSON), meta (Welt-Seed, Uhrzeit).
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
`;

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
    };
  }

  // ---------- Accounts ----------

  findAccount(username) {
    return this.q.findAcc.get(String(username).toLowerCase()) || null;
  }

  async register(username, pass) {
    if (this.findAccount(username)) throw new Error('Dieser Name ist schon vergeben.');
    const salt = crypto.randomBytes(16).toString('hex');
    const h = await hash(pass, salt);
    // Zweiter Check nach dem (asynchronen) Hashen: jemand könnte den Namen inzwischen belegt haben
    if (this.findAccount(username)) throw new Error('Dieser Name ist schon vergeben.');
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
    return { id: acc.id, username: acc.username };
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
