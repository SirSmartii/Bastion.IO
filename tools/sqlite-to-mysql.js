'use strict';
// Spielstände aus der SQLite-Datei nach MySQL/MariaDB übernehmen (einmalig beim Umstieg).
//   MYSQL_URL=mysql://bastion:passwort@localhost:3306/bastion node tools/sqlite-to-mysql.js data/bastion.db
// Die MySQL-Datenbank muss leer sein (keine Accounts), damit nichts doppelt angelegt wird.
// Vorher den Spielserver stoppen, damit die SQLite-Datei aktuell ist und sich nichts mehr ändert.
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const MysqlDb = require('../server/db-mysql');

async function main() {
  const file = path.resolve(process.argv[2] || 'data/bastion.db');
  const url = process.env.MYSQL_URL;
  if (!url) throw new Error('MYSQL_URL fehlt (mysql://benutzer:passwort@host:3306/datenbank)');

  const src = new DatabaseSync(file, { readOnly: true });
  const db = await MysqlDb.open(url); // legt die Tabellen an
  if (db.accounts.size) throw new Error('Die MySQL-Datenbank enthält schon Accounts – Abbruch.');

  const rows = (sql) => src.prepare(sql).all();
  // Tabellen, die eine ältere SQLite-Datei noch nicht hat, gelten als leer
  const has = (table) => !!src.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  const all = (table) => (has(table) ? rows(`SELECT * FROM ${table}`) : []);
  const accounts = all('accounts'), chars = all('characters'), bases = all('bases'), meta = all('meta');
  const bans = all('bans'), sessions = all('sessions'), daily = all('daily');

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const a of accounts) {
      await conn.execute('INSERT INTO accounts (id, username, username_lc, pass_hash, salt, created_at, last_login, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [a.id, a.username, a.username_lc, a.pass_hash, a.salt, a.created_at, a.last_login ?? null, a.is_admin ? 1 : 0]);
    }
    for (const c of chars) await conn.execute('INSERT INTO characters (account_id, data, updated_at) VALUES (?, ?, ?)', [c.account_id, c.data, c.updated_at]);
    for (const b of bases) await conn.execute('INSERT INTO bases (account_id, data, updated_at) VALUES (?, ?, ?)', [b.account_id, b.data, b.updated_at]);
    for (const m of meta) await conn.execute('INSERT INTO meta (`key`, value) VALUES (?, ?)', [m.key, m.value]);
    for (const b of bans) {
      await conn.execute('INSERT INTO bans (id, account_id, ip, name, reason, until, created_at, by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [b.id, b.account_id ?? null, b.ip ?? null, b.name, b.reason, b.until ?? null, b.created_at, b.by_name]);
    }
    for (const s of sessions) {
      await conn.execute('INSERT INTO sessions (sid, account_id, name, ip, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)',
        [s.sid, s.account_id ?? null, s.name, s.ip ?? null, s.started_at, s.ended_at ?? null]);
    }
    for (const d of daily) await conn.execute('INSERT INTO daily (day, views, visitors) VALUES (?, ?, ?)', [d.day, d.views, d.visitors]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  await db.close();
  src.close();
  console.log(`Übernommen: ${accounts.length} Accounts, ${chars.length} Charaktere, ${bases.length} Basen, ${meta.length} Meta-Werte, ` +
    `${bans.length} Bans, ${sessions.length} Sitzungen, ${daily.length} Tage Statistik.`);
}

main().catch((e) => { console.error('Fehler:', e.message); process.exit(1); });
