'use strict';
// Persistenz über MySQL/MariaDB (Paket mysql2) – Alternative zu SQLite (db.js), eingeschaltet über MYSQL_URL.
//
// Gleiche Schnittstelle wie db.js, damit das Spiel nichts davon merkt: Lesen geht synchron. Dafür lädt
// open() beim Start alle Tabellen in den Speicher (für ein .io-Spiel sind das wenige MB). Schreibvorgänge
// ändern sofort den Speicher und laufen dann der Reihe nach im Hintergrund zur Datenbank; transaction()
// schickt seine Schreibvorgänge gesammelt in einer MySQL-Transaktion. close() wartet, bis alles geschrieben ist.
const crypto = require('crypto');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) NOT NULL,
    username_lc VARCHAR(32) NOT NULL UNIQUE,
    pass_hash CHAR(64) NOT NULL,
    salt CHAR(32) NOT NULL,
    created_at BIGINT NOT NULL,
    last_login BIGINT NULL
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
  `CREATE TABLE IF NOT EXISTS characters (
    account_id INT UNSIGNED NOT NULL PRIMARY KEY,
    data LONGTEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS bases (
    account_id INT UNSIGNED NOT NULL PRIMARY KEY,
    data LONGTEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS meta (
    \`key\` VARCHAR(64) NOT NULL PRIMARY KEY,
    value TEXT NOT NULL
  ) CHARACTER SET utf8mb4`,
];

const SQL = {
  addAcc: 'INSERT INTO accounts (username, username_lc, pass_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)',
  touchAcc: 'UPDATE accounts SET last_login = ? WHERE id = ?',
  putChar: 'INSERT INTO characters (account_id, data, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)',
  putBase: 'INSERT INTO bases (account_id, data, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)',
  delBase: 'DELETE FROM bases WHERE account_id = ?',
  putMeta: 'INSERT INTO meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
};

const nameTaken = () => Object.assign(new Error('Dieser Name ist schon vergeben.'), { forPlayer: true });

const hash = (pass, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(pass, salt, 32, (err, key) => (err ? reject(err) : resolve(key.toString('hex'))));
});

class MysqlDb {
  // url: mysql://benutzer:passwort@host:3306/datenbank
  static async open(url) {
    const mysql = require('mysql2/promise');
    const pool = mysql.createPool({ uri: url, connectionLimit: 4, charset: 'utf8mb4' });
    for (const sql of SCHEMA) await pool.query(sql);
    const db = new MysqlDb(pool);
    const [accounts] = await pool.query('SELECT * FROM accounts');
    for (const a of accounts) db.accounts.set(a.username_lc, a);
    const [chars] = await pool.query('SELECT account_id, data FROM characters');
    for (const c of chars) db.chars.set(c.account_id, c.data);
    const [bases] = await pool.query('SELECT account_id, data FROM bases');
    for (const b of bases) db.bases.set(b.account_id, b.data);
    const [meta] = await pool.query('SELECT `key`, value FROM meta');
    for (const m of meta) db.meta.set(m.key, m.value);
    return db;
  }

  constructor(pool) {
    this.pool = pool;
    this.accounts = new Map(); // username_lc -> Zeile
    this.chars = new Map(); // account_id -> JSON
    this.bases = new Map(); // account_id -> JSON
    this.meta = new Map();
    this.queue = Promise.resolve(); // Schreibvorgänge nacheinander
    this.batch = null; // gesammelte Schreibvorgänge während transaction()
  }

  // Schreibvorgang [sql, werte] einreihen (in einer Transaktion: sammeln)
  write(sql, params) {
    if (this.batch) return this.batch.push([sql, params]);
    this.enqueue([[sql, params]]);
  }

  enqueue(statements) {
    this.queue = this.queue.then(async () => {
      if (statements.length === 1) return this.pool.execute(...statements[0]);
      const conn = await this.pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const s of statements) await conn.execute(...s);
        await conn.commit();
      } catch (e) {
        await conn.rollback().catch(() => {});
        throw e;
      } finally {
        conn.release();
      }
    }).catch((e) => console.error('MySQL: Schreiben fehlgeschlagen:', e.message));
  }

  // ---------- Accounts ----------

  findAccount(username) {
    return this.accounts.get(String(username).toLowerCase()) || null;
  }

  async register(username, pass) {
    if (this.findAccount(username)) throw nameTaken();
    const salt = crypto.randomBytes(16).toString('hex');
    const h = await hash(pass, salt);
    if (this.findAccount(username)) throw nameTaken();
    const row = { username, username_lc: username.toLowerCase(), pass_hash: h, salt, created_at: Date.now(), last_login: null };
    this.accounts.set(row.username_lc, row); // sofort belegen, falls parallel jemand denselben Namen will
    try {
      await this.queue; // vorher eingereihte Schreibvorgänge zuerst
      const [r] = await this.pool.execute(SQL.addAcc, [username, row.username_lc, h, salt, row.created_at]);
      row.id = r.insertId;
      return { id: row.id, username };
    } catch (e) {
      this.accounts.delete(row.username_lc);
      if (e.code === 'ER_DUP_ENTRY') throw nameTaken();
      throw e;
    }
  }

  async login(username, pass) {
    const acc = this.findAccount(username);
    if (!acc || !acc.id) return null;
    const h = await hash(pass, acc.salt);
    const a = Buffer.from(h, 'hex'), b = Buffer.from(acc.pass_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    acc.last_login = Date.now();
    this.write(SQL.touchAcc, [acc.last_login, acc.id]);
    return { id: acc.id, username: acc.username };
  }

  // ---------- Spielstände ----------

  loadCharacter(accountId) {
    const data = this.chars.get(accountId);
    return data ? JSON.parse(data) : null;
  }

  saveCharacter(accountId, data) {
    const json = JSON.stringify(data);
    this.chars.set(accountId, json);
    this.write(SQL.putChar, [accountId, json, Date.now()]);
  }

  loadBases() {
    return [...this.bases].map(([accountId, data]) => ({ accountId, structures: JSON.parse(data) }));
  }

  saveBase(accountId, structures) {
    const json = JSON.stringify(structures);
    this.bases.set(accountId, json);
    this.write(SQL.putBase, [accountId, json, Date.now()]);
  }

  deleteBase(accountId) {
    this.bases.delete(accountId);
    this.write(SQL.delBase, [accountId]);
  }

  getMeta(key) {
    return this.meta.has(key) ? this.meta.get(key) : null;
  }

  setMeta(key, value) {
    this.meta.set(key, String(value));
    this.write(SQL.putMeta, [key, String(value)]);
  }

  // Mehrere Schreibvorgänge atomar (in MySQL eine Transaktion)
  transaction(fn) {
    this.batch = [];
    try {
      fn();
      if (this.batch.length) this.enqueue(this.batch);
    } finally {
      this.batch = null;
    }
  }

  // Wartet, bis alles geschrieben ist
  async close() {
    await this.queue;
    await this.pool.end();
  }
}

module.exports = MysqlDb;
