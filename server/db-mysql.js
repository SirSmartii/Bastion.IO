'use strict';
// Persistenz über MySQL/MariaDB (Paket mysql2) – Alternative zu SQLite (db.js), eingeschaltet über MYSQL_URL.
//
// Gleiche Schnittstelle wie db.js, damit das Spiel nichts davon merkt: Lesen geht synchron. Dafür lädt
// open() beim Start alle Tabellen in den Speicher (für ein .io-Spiel sind das wenige MB). Schreibvorgänge
// ändern sofort den Speicher und laufen dann der Reihe nach im Hintergrund zur Datenbank; transaction()
// schickt seine Schreibvorgänge gesammelt in einer MySQL-Transaktion. close() wartet, bis alles geschrieben ist.
// Ausnahme: Beim Login wird der Account frisch gelesen – so wirkt ein per MySQL gesetztes is_admin ohne Neustart.
const crypto = require('crypto');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) NOT NULL,
    username_lc VARCHAR(32) NOT NULL UNIQUE,
    pass_hash CHAR(64) NOT NULL,
    salt CHAR(32) NOT NULL,
    created_at BIGINT NOT NULL,
    last_login BIGINT NULL,
    is_admin TINYINT NOT NULL DEFAULT 0
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
  `CREATE TABLE IF NOT EXISTS bans (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    account_id INT UNSIGNED NULL,
    ip VARCHAR(64) NULL,
    name VARCHAR(32) NOT NULL,
    reason VARCHAR(200) NOT NULL,
    until BIGINT NULL,
    created_at BIGINT NOT NULL,
    by_name VARCHAR(32) NOT NULL
  ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS sessions (
    sid CHAR(16) NOT NULL PRIMARY KEY,
    account_id INT UNSIGNED NULL,
    name VARCHAR(32) NOT NULL,
    ip VARCHAR(64) NULL,
    started_at BIGINT NOT NULL,
    ended_at BIGINT NULL,
    INDEX sessions_started (started_at)
  ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS daily (
    day CHAR(10) NOT NULL PRIMARY KEY,
    views INT UNSIGNED NOT NULL,
    visitors INT UNSIGNED NOT NULL
  ) CHARACTER SET utf8mb4`,
];

const SQL = {
  addAcc: 'INSERT INTO accounts (username, username_lc, pass_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)',
  touchAcc: 'UPDATE accounts SET last_login = ? WHERE id = ?',
  putChar: 'INSERT INTO characters (account_id, data, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)',
  putBase: 'INSERT INTO bases (account_id, data, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)',
  delBase: 'DELETE FROM bases WHERE account_id = ?',
  putMeta: 'INSERT INTO meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
  addBan: 'INSERT INTO bans (account_id, ip, name, reason, until, created_at, by_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
  delBan: 'DELETE FROM bans WHERE id = ?',
  startSession: 'REPLACE INTO sessions (sid, account_id, name, ip, started_at) VALUES (?, ?, ?, ?, ?)',
  endSession: 'UPDATE sessions SET ended_at = ? WHERE sid = ?',
  putDaily: 'INSERT INTO daily (day, views, visitors) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE views = VALUES(views), visitors = VALUES(visitors)',
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
    // Ältere Datenbanken: Admin-Spalte nachrüsten
    await pool.query('ALTER TABLE accounts ADD COLUMN is_admin TINYINT NOT NULL DEFAULT 0').catch((e) => {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    });
    const db = new MysqlDb(pool);
    const [accounts] = await pool.query('SELECT * FROM accounts');
    for (const a of accounts) db.accounts.set(a.username_lc, a);
    const [chars] = await pool.query('SELECT account_id, data FROM characters');
    for (const c of chars) db.chars.set(c.account_id, c.data);
    const [bases] = await pool.query('SELECT account_id, data FROM bases');
    for (const b of bases) db.bases.set(b.account_id, b.data);
    const [meta] = await pool.query('SELECT `key`, value FROM meta');
    for (const m of meta) db.meta.set(m.key, m.value);
    [db.bans] = await pool.query('SELECT * FROM bans');
    const [daily] = await pool.query('SELECT * FROM daily');
    for (const d of daily) db.daily.set(d.day, { views: d.views, visitors: d.visitors });
    return db;
  }

  constructor(pool) {
    this.pool = pool;
    this.accounts = new Map(); // username_lc -> Zeile
    this.chars = new Map(); // account_id -> JSON
    this.bases = new Map(); // account_id -> JSON
    this.meta = new Map();
    this.bans = []; // Bans im Speicher (beim Beitreten wird synchron geprüft)
    this.daily = new Map(); // Tag -> { views, visitors }
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
    let acc = this.findAccount(username);
    if (!acc || !acc.id) return null;
    // Frisch aus der Datenbank: Admin-Recht oder Passwort könnten per MySQL geändert worden sein
    await this.queue;
    const [rows] = await this.pool.execute('SELECT * FROM accounts WHERE id = ?', [acc.id]);
    if (!rows.length) return null;
    acc = rows[0];
    this.accounts.set(acc.username_lc, acc);
    const h = await hash(pass, acc.salt);
    const a = Buffer.from(h, 'hex'), b = Buffer.from(acc.pass_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    acc.last_login = Date.now();
    this.write(SQL.touchAcc, [acc.last_login, acc.id]);
    return { id: acc.id, username: acc.username, admin: !!acc.is_admin };
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

  // ---------- Admin: Bans, Sitzungen, Statistik ----------

  async addBan(ban) {
    await this.queue;
    const [r] = await this.pool.execute(SQL.addBan, [ban.account_id ?? null, ban.ip ?? null, ban.name, ban.reason, ban.until ?? null, ban.created_at, ban.by_name]);
    const row = { ...ban, id: r.insertId };
    this.bans.push(row);
    return row;
  }

  async removeBan(id) {
    this.bans = this.bans.filter((b) => b.id !== id);
    this.write(SQL.delBan, [id]);
    await this.queue;
  }

  startSession(s) { this.write(SQL.startSession, [s.sid, s.account_id ?? null, s.name, s.ip ?? null, s.started_at]); }
  endSession(sid, at) { this.write(SQL.endSession, [at, sid]); }

  async sessionsSince(t) {
    await this.queue;
    const [rows] = await this.pool.execute('SELECT * FROM sessions WHERE started_at >= ? ORDER BY started_at', [t]);
    return rows;
  }

  async countAccounts() {
    const [rows] = await this.pool.query('SELECT COUNT(*) AS n FROM accounts');
    return Number(rows[0].n);
  }

  putDaily(day, views, visitors) {
    this.daily.set(day, { views, visitors });
    this.write(SQL.putDaily, [day, views, visitors]);
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
