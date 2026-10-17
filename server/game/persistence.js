'use strict';
// Speichern und Laden über die Datenbank (server/db.js): Charaktere, Basen, Weltzeit.

const C = require('../config');
const Inv = require('../inventory');
const { clamp, ACCOUNT_ID_BASE, lookup } = require('./util');

const num = (v, fallback = 0) => (Number.isFinite(+v) ? +v : fallback);

module.exports = {
  // ---------- Charaktere ----------

  // Alles, was beim nächsten Login wiederhergestellt wird
  serializePlayer(p) {
    return {
      v: 1, x: Math.round(p.x), y: Math.round(p.y), hp: Math.round(p.hp), dead: p.dead,
      inv: p.inv.map((s) => (s ? (s.d ? [s.item, s.n, s.d] : [s.item, s.n]) : 0)), equip: p.equip, gear: p.gear, hotbar: p.hotbar,
      level: p.level, xp: p.xp, sp: p.sp, skills: p.skills, practice: p.practice, ammoPref: p.ammoPref, score: p.score, kills: p.kills,
      protectUntil: p.protectUntil, calmUntil: p.calmUntil, protectNote: p.protectNote,
      hunger: Math.round(p.hunger), thirst: Math.round(p.thirst),
      alive: Math.floor(p.alive), bestAlive: Math.floor(p.bestAlive),
    };
  },

  // Umbenannte Items alter Spielstände (ITEM_ALIASES, z. B. Gold-Waffen → Bronze)
  migrateItem(id) {
    return (typeof id === 'string' && C.ITEM_ALIASES[id]) || id;
  },

  // Gespeicherten Stand übernehmen – defensiv, damit geänderte Configs alte Spielstände nicht kaputt machen
  applySave(p, d) {
    p.x = clamp(num(d.x, C.WORLD_SIZE / 2), p.r, C.WORLD_SIZE - p.r);
    p.y = clamp(num(d.y, C.WORLD_SIZE / 2), p.r, C.WORLD_SIZE - p.r);

    // Ausrüstung zuerst: der Rucksack bestimmt, wie groß das Inventar ist
    p.gear = {};
    for (const slot of C.EQUIP_SLOTS) {
      const id = this.migrateItem(d.equip && d.equip[slot.id]), def = lookup(C.EQUIPMENT, id);
      p.equip[slot.id] = def && def.slot === slot.id ? id : null;
      p.gear[slot.id] = p.equip[slot.id] ? this.cleanGear(p.equip[slot.id], d.gear && d.gear[slot.id]) : null;
    }
    // Slot für Slot zurücklegen; unbekannte Items fallen weg, Überzähliges geht in freie Slots
    p.inv = Inv.create(this.invSizeFor(p.equip.back));
    (d.inv || []).forEach((s, i) => {
      const item = s && this.migrateItem(s[0]);
      if (!s || !this.isKnownItem(item) || !(s[1] > 0)) return;
      const gear = this.cleanGear(item, s[2]);
      if (i < p.inv.length && !p.inv[i] && s[1] <= Inv.stackOf(item)) p.inv[i] = gear ? { item, n: s[1] | 0, d: gear } : { item, n: s[1] | 0 };
      else Inv.add(p.inv, item, s[1] | 0, gear || undefined);
    });
    (d.hotbar || []).slice(0, C.HOTBAR_SIZE).forEach((id, i) => { const item = this.migrateItem(id); p.hotbar[i] = this.isKnownItem(item) ? item : null; });

    p.level = Math.max(1, num(d.level, 1) | 0);
    p.xp = Math.max(0, num(d.xp));
    p.sp = Math.max(0, num(d.sp) | 0);
    p.skills = {};
    for (const skill of C.SKILLS) {
      const rank = num(d.skills && d.skills[skill.id]) | 0;
      if (rank > 0) p.skills[skill.id] = Math.min(skill.max, rank);
    }
    p.practice = {};
    for (const def of C.PRACTICE.list) {
      const entry = d.practice && d.practice[def.id];
      if (!Array.isArray(entry)) continue;
      p.practice[def.id] = [clamp(num(entry[0]) | 0, 0, C.PRACTICE.max), Math.max(0, num(entry[1]))];
    }
    p.ammoPref = {};
    for (const [group, item] of Object.entries(d.ammoPref || {})) if (lookup(C.AMMO, group) && typeof item === 'string') p.ammoPref[group] = item;
    p.score = Math.max(0, num(d.score) | 0);
    p.kills = Math.max(0, num(d.kills) | 0);
    p.alive = Math.max(0, num(d.alive));
    p.bestAlive = Math.max(0, num(d.bestAlive));
    p.protectUntil = num(d.protectUntil);
    p.calmUntil = num(d.calmUntil);
    p.protectNote = num(d.protectNote, 2);
    p.hunger = clamp(num(d.hunger, C.SURVIVAL.max), 0, C.SURVIVAL.max);
    p.thirst = clamp(num(d.thirst, C.SURVIVAL.max), 0, C.SURVIVAL.max);
  },

  saveCharacter(p) {
    if (!this.db || !p.account) return;
    this.db.saveCharacter(p.account, this.serializePlayer(p));
  },

  // Eigene Gebäude (offline weitergelaufen) wieder dem Spieler zuordnen
  attachBase(p) {
    for (const s of this.ownedBy(p.id)) {
      if (s.type === 'core') { p.core = s; continue; }
      if (!C.STRUCTURES[s.type].anywhere) p.count++;
      p.counts[s.type] = (p.counts[s.type] || 0) + 1;
      if (s.type === 'forge') p.forge = s;
    }
  },

  // ---------- Basen ----------

  serializeBase(structures) {
    return structures.map((s) => {
      const o = { type: s.type, x: s.x, y: s.y, level: s.level, hp: Math.round(s.hp), rot: s.rot };
      if (s.items) o.items = s.items.map((it) => (it ? (it.d ? [it.item, it.n, it.d] : [it.item, it.n]) : 0));
      if (s.type === 'core') { o.upkeepT = Math.round(s.upkeepT); o.decaying = !!s.decaying; }
      if (s.mode) o.mode = s.mode;
      return o;
    });
  },

  // Beim Serverstart: alle gespeicherten Basen (auch von Offline-Spielern) in die Welt setzen
  loadBases() {
    if (!this.db) return;
    for (const { accountId, structures } of this.db.loadBases()) {
      // Ohne Kern ist eine Basis wertlos – Schlafsäcke bleiben aber auch ohne Basis erhalten
      if (!structures.some((o) => o.type === 'core' || o.type === 'sleeping_bag')) continue;
      const owner = ACCOUNT_ID_BASE + accountId;
      for (const o of structures) this.loadStructure(o, owner);
      this.savedOwners.add(accountId);
    }
  },

  loadStructure(o, owner) {
    const def = lookup(C.STRUCTURES, o.type);
    const L = def && def.levels[o.level];
    if (!L) return;
    const s = this.createStructure(o.type, owner, o.x, o.y, o.level, (o.rot | 0) & 3);
    s.hp = clamp(num(o.hp, L.hp), 1, L.hp);
    if (s.items) {
      (o.items || []).forEach((it, i) => {
        const item = it && this.migrateItem(it[0]);
        if (!it || i >= s.items.length || !this.isKnownItem(item) || !(it[1] > 0)) return;
        const gear = this.cleanGear(item, it[2]);
        s.items[i] = gear ? { item, n: it[1] | 0, d: gear } : { item, n: it[1] | 0 };
      });
    }
    if (C.STRUCTURES[s.type].modes && C.STRUCTURES[s.type].modes.some((m) => m.id === o.mode)) s.mode = o.mode;
    if (s.type === 'core') {
      s.upkeepT = clamp(num(o.upkeepT, C.UPKEEP.interval), 0, C.UPKEEP.interval);
      s.decaying = !!o.decaying;
    }
    this.addStructure(s);
  },

  // ---------- Alles speichern ----------

  // Weltzeit, Charaktere aller eingeloggten Spieler und alle Account-Basen in einer Transaktion
  saveAll() {
    if (!this.db) return;
    const bases = new Map(); // Account-ID -> Gebäude
    for (const [owner, set] of this.structuresByOwner) {
      if (owner < ACCOUNT_ID_BASE || !set.size) continue;
      bases.set(owner - ACCOUNT_ID_BASE, [...set]);
    }
    this.db.transaction(() => {
      this.db.setMeta('time', this.time.toFixed(2));
      for (const p of this.players.values()) this.saveCharacter(p);
      for (const [accountId, list] of bases) this.db.saveBase(accountId, this.serializeBase(list));
      // Basen, die seit dem letzten Speichern zerstört wurden oder verfallen sind
      for (const accountId of this.savedOwners) if (!bases.has(accountId)) this.db.deleteBase(accountId);
    });
    this.savedOwners = new Set(bases.keys());
  },
};
