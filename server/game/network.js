'use strict';
// Nachrichten der Clients verarbeiten und den Spielzustand an jeden Client schicken.
//
// ---------- Vom Client ----------
//   i      Eingabe { k: Tastenbits, a: Blickwinkel, m: Maustaste gedrückt }
//   b/u/x  Bauen { type, x, y, r: Drehung 0–3 } / Upgraden { id } / Abreißen { id }
//   craft, equip, unequip, mv, drop, eat, drink, ammo, hb, use, skill   Inventar, Ausrüstung, Hotbar, Skills
//   open, close, cmv   Truhe/Kern-Lager öffnen, schließen, Items verschieben
//   chat, tinv, tacc, tdec, tleave, tkick   Chat & Team
//
// ---------- An den Client (t: 's', SEND_RATE-mal pro Sekunde) ----------
//   n   Tick-Nummer (Zeitstempel: n / TICK_RATE Sekunden) – der Client spielt die Positionen danach ab
//   tm  [Tag, Nacht?, Fortschritt 0..1]
//   pl  Spieler im Sichtfeld   [id, x, y, Winkel, hp, maxHp, Name, Schläge, Aussehen, sprintet, geschützt, Team]
//   zs  Gegner                 [id, Typ, x, y, Winkel, hp, maxHp, Angriffe, hat Ziel, zerfällt, Alpha, Hunger 0–10 (-1 = kein Raubtier), Radius]
//   ss  Gebäude                [id, Typ, x, y, Level, hp, maxHp, Besitzer, Winkel, aktiv (Ofen brennt), Drehung 0–3]
//   it  Items am Boden         [id, Item, Anzahl, x, y]
//       pl und zs enthalten nur, wen der Spieler sehen kann (Sichtlinie, siehe sight.js); Teammitglieder immer.
//       zs/ss/it sind Deltas: nur was neu ins Sichtfeld kam oder sich geändert hat.
//       zx/sx/ix enthalten die IDs, die verschwunden sind (zerstört oder aus dem Sichtfeld).
//   pr  Projektile             [x, y, Winkel, Aussehen]
//   ev  Ereignisse             [x, y, Art, …] (Treffer, Abbau, Level-Up …)
//   me  eigener Zustand, der sich ständig ändert (Position, Leben, Ausdauer, Team-Positionen)
//   ms  eigener Zustand, der sich selten ändert (Inventar, Werte, Basis …) – nur wenn er sich geändert hat
//   lb  Bestenliste (ca. 1×/s), mm Minimap (alle 5 Sendungen), ru Ressourcen-Änderungen (an alle)
//   sv  Server-Leistung der letzten Sekunde [⌀ ms pro Tick, max ms, Ticks] (1×/s, für die F3-Anzeige)

const C = require('../config');
const Inv = require('../inventory');
const { levelOf } = require('./util');

const VIEW_MARGIN = 200;

module.exports = {
  // ---------- Eingang ----------

  handle(p, m) {
    const int = (v) => v | 0;
    switch (m.t) {
      case 'i':
        p.keys = int(m.k);
        if (Number.isFinite(m.a)) p.angle = m.a;
        p.attacking = !!m.m;
        break;
      case 'b': this.build(p, m.type, +m.x, +m.y, int(m.r)); break;
      case 'u': this.upgrade(p, int(m.id)); break;
      case 'x': this.demolish(p, int(m.id)); break;
      case 'craft': this.craft(p, m.id); break;
      case 'equip': this.equip(p, int(m.slot)); break;
      case 'unequip': this.unequip(p, m.eq, Number.isInteger(m.to) ? m.to : -1, !!m.drop, +m.x, +m.y); break;
      case 'mv': if (!p.dead) Inv.move(p.inv, int(m.from), int(m.to)); break;
      case 'drop': this.dropFromSlot(p, int(m.slot), int(m.n), +m.x, +m.y); break;
      case 'eat': this.eat(p, Number.isInteger(m.slot) ? m.slot : -1); break;
      case 'drink': this.drink(p); break;
      case 'ammo': this.cycleAmmo(p); break;
      case 'hb': this.assignHotbar(p, int(m.i), m.item); break;
      case 'use': this.useHotbar(p, int(m.i)); break;
      case 'skill': this.learnSkill(p, m.id); break;
      case 'open': this.openChest(p, int(m.id)); break;
      case 'close': p.chest = 0; break;
      case 'cmv': this.chestMove(p, m); break;
      case 'chat': this.chat(p, m.text); break;
      case 'tinv': this.invite(p, int(m.id)); break;
      case 'tacc': this.acceptInvite(p, int(m.id)); break;
      case 'tdec': p.invites.delete(int(m.id)); break;
      case 'tleave': this.leaveTeam(p); break;
      case 'tkick': this.kick(p, int(m.id)); break;
    }
  },

  msg(p, text) { p.conn.send(JSON.stringify({ t: 'm', text })); },
  broadcastMsg(text) { for (const p of this.players.values()) this.msg(p, text); },

  // ---------- Ausgang ----------

  sendState() {
    this.sendTick++;
    const shared = this.collectSharedState();
    for (const p of this.players.values()) this.sendStateTo(p, shared);
  },

  // Was für alle Spieler gleich ist, nur einmal pro Sendung berechnen
  collectSharedState() {
    const events = this.events;
    this.events = [];

    // Bestenliste höchstens einmal pro Sekunde und nur bei Änderung
    let leaderboard = null;
    this.lbTimer++;
    if (this.lbDirty && this.lbTimer >= C.SEND_RATE) {
      this.lbTimer = 0;
      this.lbDirty = false;
      leaderboard = [...this.players.values()].sort((a, b) => b.score - a.score).slice(0, 10).map((p) => [p.id, p.name, p.score]);
    }

    const cyclePos = this.time % this.cycle, night = this.isNight;
    const time = [this.day, night ? 1 : 0, night ? (cyclePos - C.DAY_LENGTH) / C.NIGHT_LENGTH : cyclePos / C.DAY_LENGTH];

    // Ressourcen-Änderungen gehen an alle (klein, und so bleibt jeder Client aktuell)
    let resources = null;
    if (this.resChanged.size || this.resAdded.length || this.resRemoved.length) {
      resources = { c: [...this.resChanged].flat(), a: this.resAdded.map((r) => this.resWire(r)), r: this.resRemoved };
      this.resChanged = new Map();
      this.resAdded = [];
      this.resRemoved = [];
    }

    this.minimapTimer = (this.minimapTimer || 0) + 1;
    const serverStats = this.sendTick % C.SEND_RATE === 0 ? this.takeTickStats() : null;
    return { events, leaderboard, time, resources, serverStats, withMinimap: this.minimapTimer % 5 === 0 };
  },

  sendStateTo(p, shared) {
    const halfW = C.VIEW.w / 2 + VIEW_MARGIN, halfH = C.VIEW.h / 2 + VIEW_MARGIN;
    const x0 = p.x - halfW, x1 = p.x + halfW, y0 = p.y - halfH, y1 = p.y + halfH;
    const inView = (o) => o.x > x0 && o.x < x1 && o.y > y0 && o.y < y1;

    const msg = {
      t: 's', n: this.tick, tm: shared.time,
      pl: this.playersInView(p, inView),
      pr: this.projectiles.filter(inView).map((b) => [Math.round(b.x), Math.round(b.y), +Math.atan2(b.vy, b.vx).toFixed(2), b.look || 0]),
      ev: shared.events.filter((e) => inView({ x: e[0], y: e[1] })),
      me: this.fastState(p),
    };
    this.addDelta(msg, p, 'zs', 'zx', this.zombiesInView(p, x0, y0, x1, y1, inView));
    this.addDelta(msg, p, 'ss', 'sx', this.structuresInView(x0, y0, x1, y1));
    this.addDelta(msg, p, 'it', 'ix', this.groundItemsInView(x0, y0, x1, y1, inView));
    if (shared.leaderboard) { msg.lb = shared.leaderboard; msg.on = this.players.size; }
    if (shared.resources) msg.ru = shared.resources;
    if (shared.serverStats) msg.sv = shared.serverStats;
    if (shared.withMinimap) msg.mm = this.minimapFor(p);
    this.pruneSight(p);

    // Seltener Zustand nur bei Änderung mitschicken (spart den Großteil der Bandbreite)
    const slow = JSON.stringify(this.slowState(p));
    let json = JSON.stringify(msg);
    if (slow !== p.lastSlow) {
      p.lastSlow = slow;
      json = json.slice(0, -1) + ',"ms":' + slow + '}';
    }
    p.conn.send(json);
  },

  // Rechenzeit eines Ticks (update + Senden), gemessen von der Spielschleife in server.js
  recordTickTime(ms) {
    const s = this.tickStats;
    s.n++;
    s.sum += ms;
    s.max = Math.max(s.max, ms);
  },

  // Zusammenfassung seit dem letzten Aufruf: [⌀ ms, max ms, Ticks]
  takeTickStats() {
    const s = this.tickStats;
    const out = [+(s.n ? s.sum / s.n : 0).toFixed(2), +s.max.toFixed(2), s.n];
    s.n = s.sum = s.max = 0;
    return out;
  },

  // Nur Einträge schicken, die dieser Client noch nicht genau so kennt (Einträge: Arrays mit der ID vorne)
  addDelta(msg, p, changedKey, removedKey, entries) {
    const known = p.known[changedKey] || (p.known[changedKey] = new Map()); // id -> zuletzt gesendeter Stand
    const changed = [], seen = new Set();
    for (const e of entries) {
      const id = e[0], state = e.join();
      seen.add(id);
      if (known.get(id) === state) continue;
      known.set(id, state);
      changed.push(e);
    }
    const removed = [];
    for (const id of known.keys()) {
      if (seen.has(id)) continue;
      known.delete(id);
      removed.push(id);
    }
    if (changed.length) msg[changedKey] = changed;
    if (removed.length) msg[removedKey] = removed;
  },

  // Sich selbst und das Team sieht man immer, alle anderen nur mit freier Sichtlinie
  playersInView(p, inView) {
    const list = [];
    for (const o of this.players.values()) {
      if (o.dead || !inView(o)) continue;
      if (o !== p && !this.allied(p, o.id) && !this.canSee(p, o)) continue;
      list.push([o.id, Math.round(o.x), Math.round(o.y), +o.angle.toFixed(2), Math.round(o.hp), o.maxHp, o.name, o.swings,
        this.equipLook(o), o.sprinting ? 1 : 0, this.isProtected(o) ? 1 : 0, o.team]);
    }
    return list;
  },

  // Sichtbare Ausrüstung: Item-IDs für Waffe, Mütze, Shirt (0 = nichts)
  equipLook(p) {
    return [p.equip.weapon || 0, p.equip.head || 0, p.equip.chest || 0];
  },

  zombiesInView(p, x0, y0, x1, y1, inView) {
    const list = [];
    // Das Raster ist vom Tick-Anfang; Gegner haben sich seitdem höchstens ein Stück bewegt
    for (const z of this.zgrid.queryRect(x0 - 100, y0 - 100, x1 + 100, y1 + 100)) {
      if (!this.zombies.has(z.id) || !inView(z) || !this.canSee(p, z)) continue;
      const hunger = z.pack && z.pack.rate ? Math.round(z.pack.hunger * 10) : -1;
      list.push([z.id, z.type, Math.round(z.x), Math.round(z.y), +z.angle.toFixed(2), Math.round(z.hp), Math.round(z.maxHp), z.attacks, z.target ? 1 : 0,
        z.burning ? 1 : 0, z.alpha ? 1 : 0, hunger, z.r]);
    }
    return list;
  },

  // Gebäude mit etwas mehr Rand, damit Schatten und Licht am Bildrand stimmen
  structuresInView(x0, y0, x1, y1) {
    const list = [];
    for (const s of this.statics.queryRect(x0 - 400, y0 - 400, x1 + 400, y1 + 400)) {
      if (s.kind !== 's') continue;
      list.push([s.id, s.type, s.x, s.y, s.level, Math.round(s.hp), s.maxHp, s.owner, +s.angle.toFixed(2), s.active ? 1 : 0, s.rot]);
    }
    return list;
  },

  groundItemsInView(x0, y0, x1, y1, inView) {
    const list = [];
    for (const it of this.itemGrid.queryRect(x0, y0, x1, y1)) {
      if (this.items.has(it.id) && inView(it)) list.push([it.id, it.item, it.n, Math.round(it.x), Math.round(it.y)]);
    }
    return list;
  },

  // Ändert sich (fast) jedes Tick
  fastState(p) {
    const team = this.teamOf(p);
    return {
      x: Math.round(p.x), y: Math.round(p.y), hp: Math.round(p.hp), maxHp: p.maxHp,
      st: Math.round(p.stamina), ex: p.exhausted ? 1 : 0, dead: p.dead, rt: +p.respawnT.toFixed(1),
      hu: Math.round(p.hunger), th: Math.round(p.thirst),
      prot: Math.max(0, Math.ceil(p.protectUntil - this.time)), calm: Math.max(0, Math.ceil(p.calmUntil - this.time)),
      // Team: Mitglieder als [id, Name, x, y, Leben-Anteil, tot, Kern-x, Kern-y] (für Karten & Team-Fenster)
      team: team ? {
        id: team.id, name: team.name, leader: team.leader,
        m: team.members.map((id) => this.players.get(id)).filter(Boolean).map((o) => [
          o.id, o.name, Math.round(o.x), Math.round(o.y), +(o.hp / o.maxHp).toFixed(2), o.dead ? 1 : 0,
          o.core ? o.core.x : 0, o.core ? o.core.y : 0,
        ]),
      } : null,
    };
  },

  // Ändert sich selten – wird nur gesendet, wenn sich etwas geändert hat
  slowState(p) {
    const core = p.core;
    const chest = p.chest ? this.structures.get(p.chest) : null;
    const openChest = chest && this.canUseChest(p, chest) ? chest : null;
    return {
      res: Inv.totals(p.inv), inv: p.inv.map((s) => (s ? [s.item, s.n] : 0)), eq: p.equip, stats: p.stats, hb: p.hotbar,
      lvl: p.level, xp: Math.floor(p.xp), xpNext: this.xpNeeded(p.level), sp: p.sp, skills: p.skills,
      ammo: p.stats.ammo ? (this.ammoFor(p, p.stats.ammo) || C.AMMO[p.stats.ammo].types[0]).item : null,
      score: p.score, kills: p.kills,
      core: core ? [core.id, core.x, core.y, core.level, levelOf(core).radius] : null,
      count: p.count, max: core ? levelOf(core).maxStructures : 0, counts: p.counts,
      forge: p.forge ? [p.forge.id, p.forge.x, p.forge.y, p.forge.level] : null,
      up: core ? this.upkeepInfo(core) : null,
      // Offener Behälter: [id, Slots im Format des Inventars, Unterhalt (nur Kern), Ofen-Zustand (nur Ofen)]
      ch: openChest ? [
        openChest.id, openChest.items.map((s) => (s ? [s.item, s.n] : 0)),
        openChest.type === 'core' ? this.upkeepInfo(openChest) : null,
        openChest.type === 'furnace' ? this.furnaceInfo(openChest) : openChest.type === 'campfire' ? this.campfireInfo(openChest) : null,
      ] : null,
      prac: this.practiceInfo(p), // Fähigkeiten durch Übung: [[id, Stufe, EP, nötig], …]
      ti: [...p.invites.keys()].filter((id) => this.players.has(id)).map((id) => [id, this.players.get(id).name]),
    };
  },

  // Gegner im weiten Umkreis als [x, y, feindlich, …] und fremde Spieler, die man gerade sehen kann, als [x, y, …]
  // (Koordinaten / 10). Fremde tauchen nie auf der großen Karte auf, Teammitglieder kommen über me.team.
  minimapFor(p) {
    const R = C.MINIMAP_RANGE, enemies = [], strangers = [];
    for (const z of this.zgrid.query(p.x, p.y, R)) {
      if (!this.zombies.has(z.id) || Math.abs(z.x - p.x) >= R || Math.abs(z.y - p.y) >= R) continue;
      enemies.push(Math.round(z.x / 10), Math.round(z.y / 10), z.ai !== 'neutral' || z.target ? 1 : 0);
    }
    for (const o of this.players.values()) {
      if (o === p || o.dead || this.allied(p, o.id) || Math.abs(o.x - p.x) >= R || Math.abs(o.y - p.y) >= R) continue;
      if (!this.seesBody(p.x, p.y, o)) continue; // hinter Deckung auch nicht auf dem Radar
      strangers.push(Math.round(o.x / 10), Math.round(o.y / 10));
    }
    return { e: enemies, p: strangers };
  },
};
