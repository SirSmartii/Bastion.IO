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
  const accounts = rows('SELECT * FROM accounts'), chars = rows('SELECT * FROM characters');
  const bases = rows('SELECT * FROM bases'), meta = rows('SELECT * FROM meta');

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const a of accounts) {
      await conn.execute('INSERT INTO accounts (id, username, username_lc, pass_hash, salt, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [a.id, a.username, a.username_lc, a.pass_hash, a.salt, a.created_at, a.last_login ?? null]);
    }
    for (const c of chars) await conn.execute('INSERT INTO characters (account_id, data, updated_at) VALUES (?, ?, ?)', [c.account_id, c.data, c.updated_at]);
    for (const b of bases) await conn.execute('INSERT INTO bases (account_id, data, updated_at) VALUES (?, ?, ?)', [b.account_id, b.data, b.updated_at]);
    for (const m of meta) await conn.execute('INSERT INTO meta (`key`, value) VALUES (?, ?)', [m.key, m.value]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  await db.close();
  src.close();
  console.log(`Übernommen: ${accounts.length} Accounts, ${chars.length} Charaktere, ${bases.length} Basen, ${meta.length} Meta-Werte.`);
}

main().catch((e) => { console.error('Fehler:', e.message); process.exit(1); });
