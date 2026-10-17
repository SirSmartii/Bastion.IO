'use strict';
// Admin-Menü: Statistik (Sitzungen, Seitenaufrufe), Bans, Kick, Godmode, Teleport, Items erstellen.
//
// Admin ist, wessen Account in der Datenbank is_admin = 1 hat (gelesen beim Login). Jede Aktion prüft das
// hier auf dem Server – der Client zeigt das Menü nur an.
//
// Vom Client: { t: 'adm', a: Aktion, … }
//   info                         Statistik, Spielerliste und Bans anfordern (Antwort { t: 'adm', … })
//   kick/ban/unban               { id } bzw. { id, h: Stunden (0 = für immer) } bzw. { ban: Ban-ID }
//   god/heal/goto/bring          { id } (god/heal ohne id: man selbst)
//   tp                           { x, y } (Klick auf die Weltkarte)
//   give                         { item, n, r: Seltenheit bei Ausrüstung }
//   time                         { night: true/false }
//   clear                        alle Gegner im Umkreis entfernen

const crypto = require('crypto');
const C = require('../config');
const Inv = require('../inventory');
const { clamp } = require('./util');

const TIME_ZONE = 'Europe/Berlin'; // Tagesgrenze für die Statistik
const DAY_MS = 86400000;
const dayKey = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: TIME_ZONE }); // "2026-10-18"
const CLEAR_RADIUS = 1500;

module.exports = {
  // ---------- Seitenaufrufe (Hauptmenü geladen) ----------

  countView(ip) {
    const day = dayKey(Date.now());
    if (this.viewDay !== day) {
      // Neuer Tag (oder Serverstart): mit den gespeicherten Zahlen von heute weiterzählen
      const saved = this.db && this.db.daily.get(day);
      this.viewDay = day;
      this.views = saved ? saved.views : 0;
      this.visitorsBefore = saved ? saved.visitors : 0;
      this.viewIps = new Set();
    }
    this.views++;
    this.viewIps.add(ip);
    this.viewsDirty = true;
  },

  saveViews() {
    if (!this.db || !this.viewsDirty) return;
    this.viewsDirty = false;
    this.db.putDaily(this.viewDay, this.views, this.visitorsBefore + this.viewIps.size);
  },

  // ---------- Sitzungen ----------

  startSession(p) {
    p.ip = p.conn.ip || '';
    p.joinedAt = Date.now();
    p.sid = crypto.randomBytes(8).toString('hex');
    if (this.db) this.db.startSession({ sid: p.sid, account_id: p.account || null, name: p.name, ip: p.ip, started_at: p.joinedAt });
  },

  endSession(p) {
    if (this.db && p.sid) this.db.endSession(p.sid, Date.now());
    p.sid = null;
  },

  endAllSessions() {
    for (const p of this.players.values()) this.endSession(p);
    this.saveViews();
  },

  // ---------- Bans ----------

  activeBan(accountId, ip) {
    if (!this.db) return null;
    const now = Date.now();
    return this.db.bans.find((b) => (b.until == null || b.until > now) &&
      ((accountId && b.account_id === accountId) || (ip && b.ip === ip))) || null;
  },

  // Meldung für gebannte Spieler: [Vorlage, Werte] (until als Zeitstempel, der Client formatiert ihn)
  banMessage(ban) {
    return ban.until == null ? ['Du bist dauerhaft gebannt.', undefined] : ['Du bist gebannt bis {until}.', { until: ban.until }];
  },

  // Meldung schicken und Verbindung trennen (removePlayer läuft über das close-Ereignis)
  kickPlayer(target, text, v) {
    target.conn.send(JSON.stringify(v ? { t: 'kick', text, v } : { t: 'kick', text }));
    target.conn.close();
  },

  // ---------- Aktionen ----------

  handleAdmin(p, m) {
    if (!p.admin || !m || typeof m.a !== 'string') return;
    const target = m.id !== undefined ? this.players.get(m.id | 0) : p;
    switch (m.a) {
      case 'info':
        this.adminInfo(p).catch((e) => console.error('Admin-Info fehlgeschlagen:', e));
        break;
      case 'kick':
        if (!target || target === p) return;
        this.kickPlayer(target, 'Du wurdest von einem Admin gekickt.');
        this.msg(p, '{name} gekickt.', { name: target.name });
        break;
      case 'ban':
        if (!target || target === p) return;
        this.banPlayer(p, target, m.h).catch((e) => { console.error('Bannen fehlgeschlagen:', e); this.msg(p, 'Bannen fehlgeschlagen.'); });
        break;
      case 'unban':
        if (!this.db) return;
        this.db.removeBan(m.ban | 0).then(() => this.adminInfo(p)).catch((e) => console.error('Entbannen fehlgeschlagen:', e));
        break;
      case 'god':
        if (!target) return;
        target.god = !target.god;
        this.msg(p, target.god ? 'Godmode an: {name}' : 'Godmode aus: {name}', { name: target.name });
        break;
      case 'heal':
        if (!target || target.dead) return;
        target.hp = target.maxHp;
        target.hunger = target.thirst = C.SURVIVAL.max;
        target.stamina = target.stats.stamina;
        target.exhausted = false;
        target.needNote = {};
        break;
      case 'tp':
        if (p.dead || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
        this.teleport(p, m.x, m.y);
        break;
      case 'goto':
        if (!target || target === p || p.dead) return;
        this.teleport(p, target.x + 50, target.y);
        break;
      case 'bring':
        if (!target || target === p || target.dead) return;
        this.teleport(target, p.x + 50, p.y);
        break;
      case 'give':
        this.adminGive(p, String(m.item), m.n | 0, m.r | 0);
        break;
      case 'time': {
        // Auf den Anfang von Tag bzw. Nacht im aktuellen Zyklus springen
        const start = Math.floor(this.time / this.cycle) * this.cycle;
        this.time = start + (m.night ? C.DAY_LENGTH + 1 : 1);
        break;
      }
      case 'clear': {
        let n = 0;
        for (const z of [...this.zombies.values()]) {
          if (Math.hypot(z.x - p.x, z.y - p.y) < CLEAR_RADIUS) { this.removeZombie(z); n++; }
        }
        this.msg(p, '{n} Gegner entfernt.', { n });
        break;
      }
    }
  },

  teleport(p, x, y) {
    const W = C.WORLD_SIZE, r = p.r + 2;
    p.x = clamp(x, r, W - r);
    p.y = clamp(y, r, W - r);
    p.chest = 0;
    p.fishing = null;
  },

  adminGive(p, item, n, r) {
    const gear = C.EQUIPMENT[item];
    if (!gear && !C.ITEMS.names[item]) return;
    n = clamp(n || 1, 1, gear ? 20 : 1000);
    if (gear) {
      const rarity = clamp(r, 0, C.GEAR.rarities.length - 1);
      for (let i = 0; i < n; i++) this.giveGear(p, item, gear.noRoll ? null : this.rollGear(item, 'loot', p, rarity));
    } else this.give(p, item, n, p.x, p.y);
  },

  async banPlayer(admin, target, hours) {
    if (!this.db) return this.msg(admin, 'Ohne Datenbank sind keine Bans möglich.');
    const h = Number(hours) || 0;
    const ban = await this.db.addBan({
      account_id: target.account || null, ip: target.ip || null, name: target.name, reason: 'Admin',
      until: h > 0 ? Date.now() + clamp(h, 1, 24 * 365) * 3600000 : null, created_at: Date.now(), by_name: admin.name,
    });
    if (this.players.has(target.id)) this.kickPlayer(target, ...this.banMessage(ban));
    this.msg(admin, '{name} gebannt.', { name: target.name });
    await this.adminInfo(admin);
  },

  // ---------- Statistik ----------

  async adminInfo(p) {
    const now = Date.now();
    const online = [...this.players.values()].map((o) => ({
      id: o.id, name: o.name, acc: !!o.account, admin: !!o.admin, god: !!o.god, ip: o.ip || '',
      since: o.joinedAt || now, lvl: o.level, x: Math.round(o.x), y: Math.round(o.y), dead: !!o.dead,
    }));
    let stats = null, bans = [];
    if (this.db) {
      const sessions = await this.db.sessionsSince(now - 7 * DAY_MS);
      stats = this.aggregateStats(sessions, now);
      stats.accounts = await this.db.countAccounts();
      bans = this.db.bans.filter((b) => b.until == null || b.until > now)
        .map((b) => ({ id: b.id, name: b.name, ip: b.ip || '', acc: !!b.account_id, until: b.until, at: b.created_at, by: b.by_name }));
    }
    if (!this.players.has(p.id)) return;
    p.conn.send(JSON.stringify({ t: 'adm', now, online, stats, bans }));
  },

  // Sitzungen der letzten 7 Tage → Zahlen pro Tag und die letzten Sitzungen
  aggregateStats(sessions, now) {
    const onlineSids = new Set([...this.players.values()].map((o) => o.sid));
    const days = new Map();
    for (let i = 6; i >= 0; i--) {
      const key = dayKey(now - i * DAY_MS), saved = this.db.daily.get(key);
      const live = key === this.viewDay;
      days.set(key, {
        day: key, sessions: 0, players: new Set(), guests: new Set(), time: 0,
        views: live ? this.views : saved ? saved.views : 0,
        visitors: live ? this.visitorsBefore + this.viewIps.size : saved ? saved.visitors : 0,
      });
    }
    const duration = (s) => (onlineSids.has(s.sid) ? now : s.ended_at || s.started_at) - s.started_at;
    for (const s of sessions) {
      const d = days.get(dayKey(s.started_at));
      if (!d) continue;
      const who = s.account_id ? `a${s.account_id}` : `g${s.ip || s.name}`;
      d.sessions++;
      d.players.add(who);
      if (!s.account_id) d.guests.add(who);
      d.time += duration(s);
    }
    return {
      days: [...days.values()].map((d) => ({
        day: d.day, views: d.views, visitors: d.visitors, sessions: d.sessions, players: d.players.size, guests: d.guests.size,
        avg: d.sessions ? Math.round(d.time / d.sessions / 1000) : 0,
      })),
      recent: sessions.slice(-12).reverse().map((s) => ({
        name: s.name, acc: !!s.account_id, at: s.started_at, dur: Math.round(duration(s) / 1000), online: onlineSids.has(s.sid),
      })),
    };
  },
};
