'use strict';
const C = require('./config');
const Inv = require('./inventory');
const { generateWorld } = require('./world');

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const TAU = Math.PI * 2;

let nextId = 1;
const uid = () => nextId++;

// Räumliches Raster für schnelle Nachbarschaftsabfragen
class Grid {
  constructor(cell) {
    this.cell = cell;
    this.cells = new Map();
    this.stamp = 0;
  }
  _key(cx, cy) { return (cx + 100) * 10000 + (cy + 100); }
  insert(o) {
    const c = this.cell, r = o.br;
    o._keys = [];
    for (let cx = Math.floor((o.x - r) / c); cx <= Math.floor((o.x + r) / c); cx++) {
      for (let cy = Math.floor((o.y - r) / c); cy <= Math.floor((o.y + r) / c); cy++) {
        const k = this._key(cx, cy);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(o);
        o._keys.push(k);
      }
    }
  }
  remove(o) {
    for (const k of o._keys || []) {
      const arr = this.cells.get(k);
      if (!arr) continue;
      const i = arr.indexOf(o);
      if (i >= 0) arr.splice(i, 1);
      if (!arr.length) this.cells.delete(k);
    }
    o._keys = [];
  }
  clear() { this.cells.clear(); }
  query(x, y, r) {
    const out = [], s = ++this.stamp, c = this.cell;
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++) {
      for (let cy = Math.floor((y - r) / c); cy <= Math.floor((y + r) / c); cy++) {
        const arr = this.cells.get(this._key(cx, cy));
        if (!arr) continue;
        for (const o of arr) if (o._qs !== s) { o._qs = s; out.push(o); }
      }
    }
    return out;
  }
}

// Kreis gegen achsenparalleles Quadrat: schiebt e heraus, true bei Kontakt
function pushOutRect(e, s) {
  const h = s.half;
  const cx = clamp(e.x, s.x - h, s.x + h), cy = clamp(e.y, s.y - h, s.y + h);
  const dx = e.x - cx, dy = e.y - cy, d2 = dx * dx + dy * dy;
  if (d2 >= e.r * e.r) return false;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2), push = e.r - d;
    e.x += (dx / d) * push;
    e.y += (dy / d) * push;
  } else {
    const ox = h + e.r - Math.abs(e.x - s.x), oy = h + e.r - Math.abs(e.y - s.y);
    if (ox < oy) e.x += Math.sign(e.x - s.x || 1) * ox;
    else e.y += Math.sign(e.y - s.y || 1) * oy;
  }
  return true;
}

function pushOutCircle(e, ox, oy, or) {
  const dx = e.x - ox, dy = e.y - oy, min = e.r + or, d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2) || 0.01;
  e.x += (dx / d) * (min - d);
  e.y += (dy / d) * (min - d);
  return true;
}

function circleHitsRect(x, y, r, s) {
  const cx = clamp(x, s.x - s.half, s.x + s.half), cy = clamp(y, s.y - s.half, s.y + s.half);
  return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
}

// Überlappt ein Kreis (x, y, r) ein statisches Objekt?
function hitsStatic(o, x, y, r) {
  return o.cr !== undefined ? Math.hypot(o.x - x, o.y - y) < o.cr + r : circleHitsRect(x, y, r, o);
}

const lv = (s) => C.STRUCTURES[s.type].levels[s.level];

// Spieler mit Account haben eine feste ID (ACC_BASE + Account-ID), damit ihre Basen über Logins
// und Serverneustarts hinweg zugeordnet bleiben. Gäste bekommen eine fortlaufende uid().
const ACC_BASE = 1e9;
const NAME_RE = /^[\p{L}\p{N}_\-.]+$/u;

class Game {
  // opts.db: Db-Instanz (server/db.js) für Accounts & Speichern; ohne db nur Gäste
  constructor(opts = {}) {
    this.db = opts.db || null;
    this.players = new Map();
    this.zombies = new Map();
    this.structures = new Map();
    this.items = new Map(); // Items am Boden
    this.teams = new Map(); // id -> { id, name, leader, members: [Spieler-IDs] }
    this.resources = [];
    this.resPending = []; // { type, at } – nachwachsende Ressourcen
    this.resChanged = new Map(); // id -> Restanteil (an alle Clients)
    this.resAdded = [];
    this.resRemoved = [];
    this.projectiles = [];
    this.events = [];
    this.statics = new Grid(200); // Ressourcen + Gebäude
    this.zgrid = new Grid(150); // Zombies, jedes Tick neu aufgebaut
    this.cycle = C.DAY_LENGTH + C.NIGHT_LENGTH;
    this.time = C.DAY_LENGTH * 0.1;
    this.now = 0;
    this.lbTimer = 0;
    this.lbDirty = true;
    this.saveT = 0;
    this.upCostT = 0;
    this.savedOwners = new Set(); // Account-IDs, deren Basis zuletzt gespeichert wurde
    if (this.db) {
      const t = +this.db.getMeta('time');
      if (t > 0) this.time = t; // Tageszahl & Spawnschutz-Zeiten laufen über Neustarts weiter
    }
    this.genWorld();
    this.loadBases();
  }

  get day() { return Math.floor(this.time / this.cycle) + 1; }
  get isNight() { return this.time % this.cycle >= C.DAY_LENGTH; }

  genWorld() {
    // Mit Datenbank bleibt die Welt über Neustarts gleich (gespeicherte Basen passen dann zum Gelände)
    const seed = C.MAP.seed || (this.db && +this.db.getMeta('seed')) || Math.floor(Math.random() * 2 ** 31);
    if (this.db) this.db.setMeta('seed', seed);
    this.world = generateWorld(seed);
    for (const [x, y, r] of this.world.lakes) this.statics.insert({ kind: 'water', x, y, r, cr: r, br: r });
    const half = C.TILE / 2;
    for (const city of this.world.cities) {
      for (const [x, y] of city.ruins) this.statics.insert({ kind: 'ruin', x, y, half, br: half * 1.42 });
      for (const [x, y] of city.crates) this.spawnResource('crate', false, { x, y });
    }
    for (const [type, def] of Object.entries(C.RESOURCES)) {
      for (let i = 0; i < def.count; i++) this.spawnResource(type, false);
    }
  }

  cityAt(x, y, margin = 0) {
    return this.world.cities.find((c) => Math.hypot(c.x - x, c.y - y) < c.r + margin) || null;
  }

  // Neue Ressource an freier Stelle; respawn = true meidet Basen und Spieler
  spawnResource(type, respawn, pos) {
    const def = C.RESOURCES[type], W = C.WORLD_SIZE;
    const maxW = def.biomes ? Math.max(...Object.values(def.biomes)) : 1;
    for (let tries = 0; tries < (pos ? 1 : 150); tries++) {
      const r = rand(def.minR, def.maxR);
      const x = pos ? pos.x : rand(r + 80, W - r - 80), y = pos ? pos.y : rand(r + 80, W - r - 80);
      if (!pos) {
        // Biom bestimmt die Wahrscheinlichkeit (Bäume im Wald, Steine & Gold im Fels …)
        if (def.biomes && Math.random() * maxW > (def.biomes[this.world.biomeAt(x, y)] || 0)) continue;
        if (this.cityAt(x, y, 60)) continue;
        const near = this.statics.query(x, y, r + 120);
        // Im Wald stehen Bäume dicht (Kronen dürfen sich überlappen), sonst mit Abstand
        const gap = type === 'tree' && this.world.biomeAt(x, y) === 'forest' ? 12 : 50;
        if (near.some((o) => (o.kind === 'res' ? Math.hypot(o.x - x, o.y - y) < o.br + r + gap : hitsStatic(o, x, y, r + 30)))) continue;
      }
      if (respawn) {
        if ([...this.players.values()].some((p) => Math.hypot(p.x - x, p.y - y) < 700)) continue;
        if ([...this.structures.values()].some((s) => s.type === 'core' && Math.hypot(s.x - x, s.y - y) < lv(s).radius + 100)) continue;
      }
      const amount = Math.round(rand(def.amount[0], def.amount[1]));
      const res = { id: uid(), kind: 'res', type, x, y, r, baseR: r, cr: r * def.solid, br: r, amount, maxAmount: amount };
      this.resources.push(res);
      this.statics.insert(res);
      if (respawn) this.resAdded.push(res);
      return res;
    }
    return null;
  }

  // Abbauen: Größe schrumpft mit dem Vorrat, leer = zerfällt und wächst später woanders nach
  depleteResource(o, n, p) {
    o.amount -= n;
    const def = C.RESOURCES[o.type];
    if (o.amount <= 0) {
      if (def.loot) this.dropLoot(o, def.loot, 1);
      if (p) this.addXp(p, def.loot ? C.XP.crate : C.XP.deplete);
      if (p && def.bonus) {
        for (const [item, k] of Object.entries(def.bonus)) this.give(p, item, k, o.x, o.y);
        this.events.push([Math.round(o.x), Math.round(o.y), 'bonus', 0, def.bonus, p.id]);
      }
      this.statics.remove(o);
      this.resources.splice(this.resources.indexOf(o), 1);
      this.resChanged.delete(o.id);
      this.resRemoved.push(o.id);
      // Kisten kommen an derselben Stelle wieder, alles andere wächst woanders nach
      this.resPending.push({ type: o.type, at: this.now + def.respawn, pos: def.loot ? { x: o.x, y: o.y } : null });
      this.events.push([Math.round(o.x), Math.round(o.y), 'deplete', 0, o.type]);
      return;
    }
    const frac = o.amount / o.maxAmount;
    const k = C.RESOURCE_MIN_SCALE + (1 - C.RESOURCE_MIN_SCALE) * frac;
    o.r = o.baseR * k;
    o.cr = o.r * def.solid;
    this.resChanged.set(o.id, +frac.toFixed(3));
  }

  resWire(r) {
    return [r.id, r.type, Math.round(r.x), Math.round(r.y), Math.round(r.baseR), +(r.amount / r.maxAmount).toFixed(3)];
  }

  // ---------- Verbindungen ----------

  onConnection(conn) {
    let player = null, busy = false, closed = false, lastTry = 0;
    const authErr = (err) => conn.send(JSON.stringify({ t: 'auth', err }));
    conn.on('message', (raw) => {
      if (raw.length > 2048) return;
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      if (!msg || typeof msg !== 'object') return;
      if (!player) {
        if (busy) return;
        if (msg.t === 'join') {
          // Gast: wird nicht gespeichert; Namen von Accounts sind gesperrt
          const name = this.cleanName(msg.name);
          if (this.db && this.db.findAccount(name)) return authErr('Dieser Name gehört zu einem Account – bitte einloggen.');
          player = this.addPlayer(conn, name);
        } else if (msg.t === 'login' || msg.t === 'register') {
          if (Date.now() - lastTry < C.ACCOUNTS.loginCooldown * 1000) return authErr('Bitte kurz warten.');
          lastTry = Date.now();
          busy = true;
          this.authenticate(msg).then((acc) => {
            busy = false;
            if (closed) return;
            if (this.players.has(ACC_BASE + acc.id)) return authErr('Dieser Account ist bereits im Spiel.');
            player = this.addPlayer(conn, acc.username, acc);
          }, (e) => {
            busy = false;
            if (!closed) authErr(e.message);
          });
        }
        return;
      }
      this.handle(player, msg);
    });
    conn.on('close', () => {
      closed = true;
      if (player) this.removePlayer(player);
    });
  }

  cleanName(name) {
    return String(name || '').replace(/[^\p{L}\p{N} _\-.!?]/gu, '').trim().slice(0, 16) || 'Überlebender';
  }

  // Login oder Registrierung prüfen; liefert { id, username } oder wirft einen Fehler mit Text für den Spieler
  async authenticate(msg) {
    const A = C.ACCOUNTS;
    if (!this.db) throw new Error('Accounts sind auf diesem Server deaktiviert – spiel als Gast.');
    const user = String(msg.user || '').trim(), pass = String(msg.pass || '');
    if (user.length < A.nameMin || user.length > A.nameMax || !NAME_RE.test(user)) {
      throw new Error(`Name: ${A.nameMin}–${A.nameMax} Zeichen (Buchstaben, Zahlen, _ - .).`);
    }
    if (pass.length < A.passMin || pass.length > A.passMax) throw new Error(`Passwort: ${A.passMin}–${A.passMax} Zeichen.`);
    if (msg.t === 'register') return this.db.register(user, pass);
    const acc = await this.db.login(user, pass);
    if (!acc) throw new Error('Name oder Passwort falsch.');
    return acc;
  }

  addPlayer(conn, name, acc = null) {
    if (!acc) name = this.cleanName(name);
    const P = C.PLAYER;
    const p = {
      id: acc ? ACC_BASE + acc.id : uid(), account: acc ? acc.id : 0, kind: 'p', conn, name, x: 0, y: 0, r: P.radius, br: P.radius,
      angle: 0, hp: P.hp, maxHp: P.hp, keys: 0, attacking: false, atkCd: 0, swings: 0,
      inv: Inv.create(), equip: {}, stats: null, core: null, forge: null, count: 0, counts: {},
      score: 0, kills: 0, dead: false, respawnT: 0, lastHurt: -99, spawnCd: 3, fullMsgT: -99, eatT: -99,
      stamina: P.stamina, sprinting: false, exhausted: false, sprintStop: -99, ammoMsgT: -99, ammoPref: {},
      level: 1, xp: 0, sp: 0, skills: {}, hotbar: new Array(C.HOTBAR_SIZE).fill(null),
      team: 0, invites: new Map(), chest: 0, chatT: -99,
    };
    const saved = acc && this.db ? this.db.loadCharacter(acc.id) : null;
    if (acc) this.attachBase(p); // Basis lief offline weiter (inkl. Unterhalt & Verfall)
    if (saved) {
      this.applySave(p, saved);
    } else {
      for (const [item, n] of Object.entries(P.startRes)) Inv.add(p.inv, item, n);
      for (const sl of C.EQUIP_SLOTS) p.equip[sl.id] = P.startEquip[sl.id] || null;
      p.hotbar[0] = p.equip.weapon;
    }
    this.computeStats(p);
    // Gespeicherte Position nur, wenn sie noch frei ist (sonst: an der Basis bzw. zufällig)
    if (saved && !saved.dead && saved.hp > 0 && this.isFree(p.x, p.y, p.r + 2)) {
      p.hp = clamp(saved.hp, 1, p.maxHp);
    } else {
      p.hp = p.maxHp;
      this.placeAtSpawn(p);
    }
    this.players.set(p.id, p);
    this.lbDirty = true;
    conn.send(JSON.stringify({
      t: 'init', id: p.id, acc: acc ? acc.username : null,
      cfg: {
        WORLD_SIZE: C.WORLD_SIZE, TILE: C.TILE, VIEW: C.VIEW, PVP: C.PVP,
        DAY_LENGTH: C.DAY_LENGTH, NIGHT_LENGTH: C.NIGHT_LENGTH,
        PLAYER: C.PLAYER, AMMO: C.AMMO, SKILLS: C.SKILLS, HOTBAR_SIZE: C.HOTBAR_SIZE, EQUIPMENT: C.EQUIPMENT, EQUIP_SLOTS: C.EQUIP_SLOTS, FORGE_TABS: C.FORGE_TABS, RESOURCE_MIN_SCALE: C.RESOURCE_MIN_SCALE, INVENTORY: C.INVENTORY, ITEMS: C.ITEMS, STRUCTURES: C.STRUCTURES, ENEMIES: C.ENEMIES, BUILD_CATEGORIES: C.BUILD_CATEGORIES, MINIMAP_RANGE: C.MINIMAP_RANGE, MAP: C.MAP, TEAM: C.TEAM, CHAT: C.CHAT, UPKEEP: C.UPKEEP,
      },
      res: this.resources.map((r) => this.resWire(r)),
      world: {
        n: this.world.n, G: this.world.G, biomes: this.world.biomes, lakes: this.world.lakes, roads: this.world.roads,
        cities: this.world.cities.map((c) => ({ x: c.x, y: c.y, r: c.r, name: c.name, buildings: c.buildings, ruins: c.ruins, streets: c.streets })),
      },
    }));
    if (saved) {
      this.msg(p, `Willkommen zurück, ${p.name}!${p.core ? '' : ' Deine Basis ist nicht mehr da – baue eine neue.'}`);
      if (p.core && p.core.decaying) this.msg(p, '⚠ Deine Basis verfällt! Lege Ressourcen in den Basis-Kern [F].');
      return p;
    }
    // Spawnschutz bis zum nächsten Einbruch der Nacht, danach eine ruhige erste Nacht (ohne Horde)
    const dayIdx = Math.floor(this.time / this.cycle);
    const nightStart = (this.isNight ? dayIdx + 1 : dayIdx) * this.cycle + C.DAY_LENGTH;
    p.protectUntil = nightStart;
    p.calmUntil = nightStart + C.NIGHT_LENGTH;
    p.protectNote = 0;
    this.msg(p, 'Sammle Holz & Stein und baue deinen Basis-Kern (Baumenü [B])!');
    this.msg(p, '🛡 Spawnschutz bis zur ersten Nacht – Gegner greifen dich nicht an.');
    if (acc) this.saveCharacter(p); // Account sofort mit Startausrüstung anlegen
    return p;
  }

  // ---------- Speichern & Laden ----------

  // Spielstand eines Charakters (alles, was beim nächsten Login wiederhergestellt wird)
  serializePlayer(p) {
    return {
      v: 1, x: Math.round(p.x), y: Math.round(p.y), hp: Math.round(p.hp), dead: p.dead,
      inv: p.inv.map((s) => (s ? [s.item, s.n] : 0)), equip: p.equip, hotbar: p.hotbar,
      level: p.level, xp: p.xp, sp: p.sp, skills: p.skills, ammoPref: p.ammoPref, score: p.score, kills: p.kills,
      protectUntil: p.protectUntil, calmUntil: p.calmUntil, protectNote: p.protectNote,
    };
  }

  // Gespeicherten Stand übernehmen – defensiv, damit geänderte Configs alte Spielstände nicht kaputt machen
  applySave(p, d) {
    const num = (v, def = 0) => (Number.isFinite(+v) ? +v : def);
    p.x = clamp(num(d.x, C.WORLD_SIZE / 2), p.r, C.WORLD_SIZE - p.r);
    p.y = clamp(num(d.y, C.WORLD_SIZE / 2), p.r, C.WORLD_SIZE - p.r);
    p.inv = Inv.create();
    // Slot für Slot zurücklegen; unbekannte Items fallen weg, Überzähliges geht in freie Slots
    (d.inv || []).forEach((s, i) => {
      if (!s || !this.isKnownItem(s[0]) || !(s[1] > 0)) return;
      if (i < p.inv.length && !p.inv[i] && s[1] <= Inv.stackOf(s[0])) p.inv[i] = { item: s[0], n: s[1] | 0 };
      else Inv.add(p.inv, s[0], s[1] | 0);
    });
    for (const sl of C.EQUIP_SLOTS) {
      const item = d.equip && d.equip[sl.id];
      p.equip[sl.id] = item && C.EQUIPMENT[item] && C.EQUIPMENT[item].slot === sl.id ? item : null;
    }
    (d.hotbar || []).slice(0, C.HOTBAR_SIZE).forEach((item, i) => { p.hotbar[i] = item && this.isKnownItem(item) ? item : null; });
    p.level = Math.max(1, num(d.level, 1) | 0);
    p.xp = Math.max(0, num(d.xp));
    p.sp = Math.max(0, num(d.sp) | 0);
    p.skills = {};
    for (const sk of C.SKILLS) {
      const r = num(d.skills && d.skills[sk.id]) | 0;
      if (r > 0) p.skills[sk.id] = Math.min(sk.max, r);
    }
    p.ammoPref = {};
    for (const [g, item] of Object.entries(d.ammoPref || {})) if (C.AMMO[g] && typeof item === 'string') p.ammoPref[g] = item;
    p.score = Math.max(0, num(d.score) | 0);
    p.kills = Math.max(0, num(d.kills) | 0);
    p.protectUntil = num(d.protectUntil);
    p.calmUntil = num(d.calmUntil);
    p.protectNote = num(d.protectNote, 2);
  }

  saveCharacter(p) {
    if (!this.db || !p.account) return;
    this.db.saveCharacter(p.account, this.serializePlayer(p));
  }

  // Eigene Gebäude (offline weitergelaufen) wieder dem Spieler zuordnen
  attachBase(p) {
    for (const s of this.structures.values()) {
      if (s.owner !== p.id) continue;
      if (s.type === 'core') { p.core = s; continue; }
      p.count++;
      p.counts[s.type] = (p.counts[s.type] || 0) + 1;
      if (s.type === 'forge') p.forge = s;
    }
  }

  // Gebäude als speicherbare Liste
  serializeBase(list) {
    return list.map((s) => {
      const o = { type: s.type, x: s.x, y: s.y, level: s.level, hp: Math.round(s.hp) };
      if (s.items) o.items = s.items.map((it) => (it ? [it.item, it.n] : 0));
      if (s.type === 'core') { o.upkeepT = Math.round(s.upkeepT); o.decaying = !!s.decaying; }
      return o;
    });
  }

  // Beim Serverstart: alle gespeicherten Basen (auch von Offline-Spielern) in die Welt setzen
  loadBases() {
    if (!this.db) return;
    for (const { accountId, structures } of this.db.loadBases()) {
      const owner = ACC_BASE + accountId;
      // Ohne Kern ist eine Basis wertlos
      if (!structures.some((o) => o.type === 'core')) continue;
      for (const o of structures) {
        const def = C.STRUCTURES[o.type];
        if (!def || !def.levels[o.level]) continue;
        const half = (def.size * C.TILE) / 2, L = def.levels[o.level];
        const s = {
          id: uid(), kind: 's', type: o.type, owner, x: o.x, y: o.y, half, br: half * 1.42,
          level: o.level, hp: clamp(o.hp, 1, L.hp), maxHp: L.hp, cd: o.type === 'mine' ? def.interval : 0, angle: 0,
        };
        if (L.slots) {
          s.items = new Array(L.slots).fill(null);
          (o.items || []).forEach((it, i) => { if (it && i < s.items.length && this.isKnownItem(it[0]) && it[1] > 0) s.items[i] = { item: it[0], n: it[1] | 0 }; });
        }
        if (o.type === 'core') { s.upkeepT = clamp(+o.upkeepT || C.UPKEEP.interval, 0, C.UPKEEP.interval); s.decaying = !!o.decaying; }
        this.structures.set(s.id, s);
        this.statics.insert(s);
      }
      this.savedOwners.add(accountId);
    }
  }

  // Alles speichern: Weltzeit, Charaktere aller eingeloggten Spieler, alle Account-Basen
  saveAll() {
    if (!this.db) return;
    const bases = new Map();
    for (const s of this.structures.values()) {
      if (s.owner < ACC_BASE) continue;
      const id = s.owner - ACC_BASE;
      if (!bases.has(id)) bases.set(id, []);
      bases.get(id).push(s);
    }
    this.db.transaction(() => {
      this.db.setMeta('time', this.time.toFixed(2));
      for (const p of this.players.values()) this.saveCharacter(p);
      for (const [id, list] of bases) this.db.saveBase(id, this.serializeBase(list));
      for (const id of this.savedOwners) if (!bases.has(id)) this.db.deleteBase(id); // Basis zerstört/verfallen
    });
    this.savedOwners = new Set(bases.keys());
  }

  isProtected(p) { return !!p && this.time < p.protectUntil; }
  isCalm(p) { return !!p && this.time < p.calmUntil; }

  // Hinweise beim Wechsel der Schutzphasen
  updateProtection(p) {
    if (p.protectNote === 0 && !this.isProtected(p)) {
      p.protectNote = 1;
      this.msg(p, 'Dein Spawnschutz ist vorbei. Diese erste Nacht bleibt ruhig – keine Horde.');
    } else if (p.protectNote === 1 && !this.isCalm(p)) {
      p.protectNote = 2;
      this.msg(p, 'Die Schonzeit ist vorbei – ab der nächsten Nacht kommen die Horden!');
    }
  }

  removePlayer(p) {
    this.leaveTeam(p, true);
    for (const o of this.players.values()) o.invites.delete(p.id);
    // Accounts: Charakter speichern, die Basis bleibt in der Welt. Gäste nehmen ihre Basis mit.
    if (p.account && this.db) {
      try { this.saveAll(); } catch (e) { console.error('Speichern fehlgeschlagen:', e); }
    } else if (p.core) this.destroyStructure(p.core);
    this.players.delete(p.id);
    this.lbDirty = true;
  }

  // ---------- Teams ----------

  teamOf(p) { return (p && p.team && this.teams.get(p.team)) || null; }

  // Gehört ownerId zu p selbst oder zu seinem Team? (Türen, Truhen, Reparieren, kein Eigenbeschuss)
  allied(p, ownerId) {
    if (!p) return false;
    if (p.id === ownerId) return true;
    const o = this.players.get(ownerId);
    return !!(o && p.team && o.team === p.team);
  }

  teamMsg(team, text) {
    for (const id of team.members) { const m = this.players.get(id); if (m) this.msg(m, text); }
  }

  invite(p, targetId) {
    const t = this.players.get(targetId);
    if (!t || t === p) return;
    const team = this.teamOf(p);
    if (t.team && t.team === p.team) return this.msg(p, `${t.name} ist schon in deinem Team.`);
    if (t.team) return this.msg(p, `${t.name} ist bereits in einem Team.`);
    if (team && team.members.length >= C.TEAM.maxSize) return this.msg(p, `Dein Team ist voll (max. ${C.TEAM.maxSize}).`);
    const prev = t.invites.get(p.id);
    if (prev && this.now - prev < 5) return;
    t.invites.set(p.id, this.now);
    this.msg(t, `👥 ${p.name} lädt dich in ein Team ein – [T] zum Annehmen.`);
    this.msg(p, `Einladung an ${t.name} gesendet.`);
  }

  // Einladung annehmen: Team des Einladenden beitreten (oder mit ihm ein neues gründen)
  acceptInvite(p, fromId) {
    const at = p.invites.get(fromId);
    p.invites.delete(fromId);
    const from = this.players.get(fromId);
    if (at === undefined || !from || this.now - at > C.TEAM.inviteTime) return this.msg(p, 'Die Einladung ist abgelaufen.');
    if (p.team) return this.msg(p, 'Verlasse zuerst dein aktuelles Team.');
    let team = this.teamOf(from);
    if (!team) {
      team = { id: uid(), name: `Team ${from.name}`, leader: from.id, members: [from.id] };
      this.teams.set(team.id, team);
      from.team = team.id;
      from.invites.clear();
    }
    if (team.members.length >= C.TEAM.maxSize) return this.msg(p, 'Das Team ist bereits voll.');
    team.members.push(p.id);
    p.team = team.id;
    p.invites.clear();
    this.teamMsg(team, `👥 ${p.name} ist ${team.name} beigetreten.`);
  }

  leaveTeam(p, silent) {
    const team = this.teamOf(p);
    p.team = 0;
    if (!team) return;
    team.members = team.members.filter((id) => id !== p.id);
    if (!silent) this.msg(p, `Du hast ${team.name} verlassen.`);
    if (team.members.length < 2) {
      // Allein ist man kein Team mehr
      for (const id of team.members) {
        const m = this.players.get(id);
        if (m) { m.team = 0; this.msg(m, `${team.name} wurde aufgelöst.`); }
      }
      this.teams.delete(team.id);
      return;
    }
    if (team.leader === p.id) team.leader = team.members[0];
    this.teamMsg(team, `👥 ${p.name} hat das Team verlassen.`);
  }

  kick(p, targetId) {
    const team = this.teamOf(p);
    const t = this.players.get(targetId);
    if (!team || team.leader !== p.id || !t || t === p || t.team !== team.id) return;
    this.msg(t, `Du wurdest aus ${team.name} entfernt.`);
    this.leaveTeam(t, true);
    if (this.teams.has(team.id)) this.teamMsg(team, `${t.name} wurde aus dem Team entfernt.`);
  }

  // ---------- Chat ----------

  // Normale Nachrichten hören nur Spieler in der Nähe; "/t …" geht an alle Teammitglieder
  chat(p, raw) {
    let text = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!text || this.now - p.chatT < C.CHAT.cooldown) return;
    let toTeam = false;
    const m = /^\/(t|team)(\s+|$)/i.exec(text);
    if (m) {
      toTeam = true;
      text = text.slice(m[0].length).trim();
      if (!text) return;
      if (!p.team) return this.msg(p, 'Du bist in keinem Team – Teamchat geht nicht.');
    }
    text = text.slice(0, C.CHAT.maxLength);
    p.chatT = this.now;
    const out = JSON.stringify({ t: 'c', id: p.id, name: p.name, text, team: toTeam ? 1 : 0 });
    for (const o of this.players.values()) {
      const hears = toTeam ? o.team === p.team : Math.hypot(o.x - p.x, o.y - p.y) <= C.CHAT.range;
      if (hears) o.conn.send(out);
    }
  }

  // ---------- Truhen ----------

  // Truhen und das Unterhalts-Lager im Basis-Kern funktionieren gleich (Gebäude mit items)
  canUseChest(p, s) {
    return !!s && !!s.items && !p.dead && this.structures.has(s.id) && this.allied(p, s.owner) &&
      Math.hypot(s.x - p.x, s.y - p.y) <= C.STRUCTURES[s.type].useRange + 40;
  }

  openChest(p, id) {
    const s = this.structures.get(id);
    if (!s || !s.items) return;
    const what = s.type === 'core' ? 'Dieser Kern' : 'Diese Truhe';
    if (!this.allied(p, s.owner)) return this.msg(p, `${what} gehört nicht dir oder deinem Team.`);
    if (!this.canUseChest(p, s)) return this.msg(p, 'Geh näher heran.');
    p.chest = s.id;
  }

  // Verschieben zwischen Inventar (c = 0) und offenem Behälter (c = 1)
  chestMove(p, m) {
    const s = this.structures.get(p.chest);
    if (!this.canUseChest(p, s)) { p.chest = 0; return; }
    const fc = m.fc ? 1 : 0, tc = m.quick ? 1 - fc : m.tc ? 1 : 0;
    const box = (c) => (c ? s.items : p.inv);
    const src = box(fc), dst = box(tc), from = m.from | 0, to = m.to | 0;
    const a = src[from];
    if (from < 0 || from >= src.length || !a) return;
    // Ins Kern-Lager passen nur Unterhalts-Ressourcen (auch nicht per Tausch)
    const fits = (c, item) => !(c && s.type === 'core') || C.UPKEEP.items.includes(item);
    const swapIn = !m.quick && dst[to] && dst[to].item !== a.item ? dst[to].item : null;
    if (!fits(tc, a.item) || (swapIn && !fits(fc, swapIn))) {
      return this.msg(p, 'Ins Kern-Lager gehören nur Holz, Stein und Gold für den Unterhalt.');
    }
    if (m.quick) Inv.quickMove(src, from, dst);
    else Inv.transfer(src, from, dst, to, m.n | 0);
    // Verfallende Basis: frischer Vorrat wird sofort genutzt
    if (s.type === 'core' && s.decaying && this.payUpkeep(s)) s.upkeepT = C.UPKEEP.interval;
  }

  // ---------- Unterhalt & Verfall ----------

  // Kosten einer Zahlung für die Basis von owner: pro Gebäude cost[Level], der Kern coreMult-fach
  upkeepCost(owner) {
    const U = C.UPKEEP, cost = {};
    for (const s of this.structures.values()) {
      if (s.owner !== owner) continue;
      const k = s.type === 'core' ? U.coreMult : 1;
      for (const [item, n] of Object.entries(U.cost[s.level])) cost[item] = (cost[item] || 0) + n * k;
    }
    return cost;
  }

  // Zahlt aus dem Kern-Lager; Erfolg = Basis wird repariert, sonst verfällt sie bis zur nächsten Zahlung
  payUpkeep(core) {
    const cost = this.upkeepCost(core.owner);
    core.upCost = cost;
    const owner = this.players.get(core.owner);
    if (!Inv.canAfford(core.items, cost)) {
      if (!core.decaying && owner) this.msg(owner, '⚠ Kern-Lager leer – deine Basis verfällt! Lege Holz/Stein/Gold in den Kern [F].');
      core.decaying = true;
      return false;
    }
    Inv.pay(core.items, cost);
    if (core.decaying && owner) this.msg(owner, 'Unterhalt bezahlt – der Verfall ist gestoppt.');
    core.decaying = false;
    for (const s of this.structures.values()) {
      if (s.owner === core.owner && s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + s.maxHp * C.UPKEEP.repair);
    }
    return true;
  }

  updateUpkeep(dt) {
    const U = C.UPKEEP, cores = [];
    for (const s of this.structures.values()) if (s.type === 'core') cores.push(s);
    // Kosten für die Anzeige einmal pro Sekunde auffrischen
    this.upCostT -= dt;
    const refresh = this.upCostT <= 0;
    if (refresh) this.upCostT = 1;
    const decaying = new Set();
    for (const core of cores) {
      if (refresh) core.upCost = this.upkeepCost(core.owner);
      core.upkeepT -= dt;
      if (core.upkeepT <= 0) {
        core.upkeepT += U.interval;
        this.payUpkeep(core);
      }
      if (core.decaying) decaying.add(core.owner);
    }
    if (!decaying.size) return;
    // Verfall: jedes Gebäude einer unversorgten Basis verliert laufend HP
    for (const s of [...this.structures.values()]) {
      if (!decaying.has(s.owner) || !this.structures.has(s.id)) continue;
      s.hp -= s.maxHp * (U.decay / 60) * dt;
      if (s.hp <= 0) this.destroyStructure(s);
    }
  }

  // Für die Anzeige: Kosten, Sekunden bis zur nächsten Zahlung, wie viele Zahlungen der Vorrat deckt, Verfall
  upkeepInfo(core) {
    const cost = core.upCost || this.upkeepCost(core.owner);
    let n = 999;
    for (const [item, k] of Object.entries(cost)) if (k > 0) n = Math.min(n, Math.floor(Inv.count(core.items, item) / k));
    return { c: cost, t: Math.max(0, Math.ceil(core.upkeepT)), n, d: core.decaying ? 1 : 0 };
  }

  placeAtSpawn(p) {
    if (p.core) {
      // Freien Platz neben dem Kern suchen (Gebäude sind auch für den Besitzer massiv)
      const c = p.core;
      for (let tries = 0; tries < 40; tries++) {
        const a = rand(0, TAU), d = c.half + p.r + 8 + Math.floor(tries / 8) * 25;
        const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
        if (this.isFree(x, y, p.r + 2)) { p.x = x; p.y = y; return; }
      }
      p.x = c.x + c.half + p.r + 8;
      p.y = c.y;
      return;
    }
    const W = C.WORLD_SIZE;
    for (let i = 0; i < 60; i++) {
      const x = rand(200, W - 200), y = rand(200, W - 200);
      if (!this.isFree(x, y, p.r + 10)) continue;
      if (this.cityAt(x, y, 500)) continue;
      let ok = true;
      for (const s of this.structures.values()) if (s.type === 'core' && Math.hypot(s.x - x, s.y - y) < 900) { ok = false; break; }
      for (const z of this.zombies.values()) if (Math.hypot(z.x - x, z.y - y) < 500) { ok = false; break; }
      if (!ok && i < 50) continue;
      p.x = x; p.y = y;
      return;
    }
    p.x = W / 2; p.y = W / 2;
  }

  isFree(x, y, r) {
    for (const o of this.statics.query(x, y, r + 100)) {
      if (hitsStatic(o, x, y, r)) return false;
    }
    return true;
  }

  msg(p, text) { p.conn.send(JSON.stringify({ t: 'm', text })); }
  broadcastMsg(text) { for (const p of this.players.values()) this.msg(p, text); }

  handle(p, m) {
    switch (m.t) {
      case 'i':
        p.keys = m.k | 0;
        if (Number.isFinite(m.a)) p.angle = m.a;
        p.attacking = !!m.m;
        break;
      case 'b': this.build(p, String(m.type), +m.x, +m.y); break;
      case 'u': this.upgrade(p, m.id | 0); break;
      case 'x': this.demolish(p, m.id | 0); break;
      case 'craft': this.craft(p, String(m.id)); break;
      case 'equip': this.equip(p, m.slot | 0); break;
      case 'unequip': this.unequip(p, String(m.eq), Number.isInteger(m.to) ? m.to : -1, !!m.drop, +m.x, +m.y); break;
      case 'mv': Inv.move(p.inv, m.from | 0, m.to | 0); break;
      case 'ammo': this.cycleAmmo(p); break;
      case 'hb': this.assignHotbar(p, m.i | 0, m.item); break;
      case 'use': this.useHotbar(p, m.i | 0); break;
      case 'skill': this.learnSkill(p, String(m.id)); break;
      case 'eat': this.eat(p, Number.isInteger(m.slot) ? m.slot : -1); break;
      case 'drop': this.dropFromSlot(p, m.slot | 0, m.n | 0, +m.x, +m.y); break;
      case 'open': this.openChest(p, m.id | 0); break;
      case 'close': p.chest = 0; break;
      case 'cmv': this.chestMove(p, m); break;
      case 'chat': this.chat(p, m.text); break;
      case 'tinv': this.invite(p, m.id | 0); break;
      case 'tacc': this.acceptInvite(p, m.id | 0); break;
      case 'tdec': p.invites.delete(m.id | 0); break;
      case 'tleave': this.leaveTeam(p); break;
      case 'tkick': this.kick(p, m.id | 0); break;
    }
  }

  // ---------- Inventar & Items am Boden ----------

  // Ins Inventar legen; was nicht passt, fällt bei (x, y) auf den Boden
  give(p, item, n, x, y) {
    const left = Inv.add(p.inv, item, n);
    if (left > 0) this.dropItem(x, y, item, left);
  }

  dropItem(x, y, item, n, blockId = 0) {
    if (n <= 0) return;
    const W = C.WORLD_SIZE;
    x = clamp(x, 20, W - 20);
    y = clamp(y, 20, W - 20);
    // Mit einem nahen Haufen gleicher Art zusammenlegen
    for (const it of this.items.values()) {
      if (it.item === item && !C.EQUIPMENT[item] && Math.hypot(it.x - x, it.y - y) < 30) {
        it.n += n;
        it.t = this.now;
        if (blockId) it.blockId = blockId;
        return;
      }
    }
    if (this.items.size >= C.ITEMS.maxGround) this.items.delete(this.items.keys().next().value);
    const it = { id: uid(), item, n, x, y, t: this.now, blockId };
    this.items.set(it.id, it);
  }

  dropFromSlot(p, slot, n, x, y) {
    if (p.dead || slot < 0 || slot >= p.inv.length) return;
    const taken = Inv.take(p.inv, slot, n);
    if (!taken) return;
    this.dropFromHand(p, taken.item, x, y, taken.n);
  }

  dropFromHand(p, item, x, y, n = 1) {
    const max = C.ITEMS.maxDropDist;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      x = p.x + Math.cos(p.angle) * 70;
      y = p.y + Math.sin(p.angle) * 70;
    } else {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > max) { x = p.x + ((x - p.x) / d) * max; y = p.y + ((y - p.y) / d) * max; }
    }
    // Der Werfer hebt das Item erst wieder auf, nachdem er sich einmal entfernt hat
    this.dropItem(x, y, item, n, p.id);
  }

  // Essbares Item verzehren (aus Slot oder irgendein essbares Item)
  eat(p, slot) {
    if (p.dead || this.now - p.eatT < C.ITEMS.eatCooldown) return;
    const food = C.ITEMS.food;
    if (slot < 0) slot = p.inv.findIndex((s) => s && food[s.item]);
    const s = p.inv[slot];
    if (!s || !food[s.item]) return this.msg(p, 'Nichts Essbares im Inventar.');
    if (p.hp >= p.maxHp) return this.msg(p, 'Du bist schon satt.');
    Inv.take(p.inv, slot, 1);
    p.hp = Math.min(p.maxHp, p.hp + food[s.item]);
    p.eatT = this.now;
    this.events.push([Math.round(p.x), Math.round(p.y), 'eat', food[s.item], p.id]);
  }

  pickupItems(p) {
    const R = p.r + C.ITEMS.pickupRadius;
    for (const it of this.items.values()) {
      if (Math.abs(it.x - p.x) > R || Math.abs(it.y - p.y) > R) {
        if (it.blockId === p.id) it.blockId = 0;
        continue;
      }
      const d = Math.hypot(it.x - p.x, it.y - p.y);
      if (it.blockId === p.id) {
        if (d > R) it.blockId = 0;
        continue;
      }
      if (d > R) continue;
      const left = Inv.add(p.inv, it.item, it.n);
      if (left === it.n) continue;
      this.events.push([Math.round(it.x), Math.round(it.y), 'pick', it.n - left, it.item, p.id]);
      it.n = left;
      if (!left) this.items.delete(it.id);
    }
  }

  // ---------- Bauen & Upgraden ----------

  snap(type, x, y) {
    const T = C.TILE, size = C.STRUCTURES[type].size;
    const off = (size * T) / 2;
    return { x: Math.round((x - off) / T) * T + off, y: Math.round((y - off) / T) * T + off, half: off };
  }

  build(p, type, wx, wy) {
    const def = C.STRUCTURES[type];
    if (!def || p.dead || !Number.isFinite(wx) || !Number.isFinite(wy)) return;
    const { x, y, half } = this.snap(type, wx, wy);
    const err = this.placementError(p, type, x, y, half);
    if (err) return this.msg(p, err);
    const L = def.levels[0];
    Inv.pay(p.inv, L.cost);
    const s = {
      id: uid(), kind: 's', type, owner: p.id, x, y, half, br: half * 1.42,
      level: 0, hp: L.hp, maxHp: L.hp, cd: type === 'mine' ? def.interval : 0, angle: 0,
    };
    if (L.slots) s.items = new Array(L.slots).fill(null);
    if (type === 'core') {
      // Unterhalts-Lager startet mit etwas Vorrat; erste Zahlung nach einem vollen Intervall
      for (const [item, n] of Object.entries(C.UPKEEP.startStock)) Inv.add(s.items, item, n);
      s.upkeepT = C.UPKEEP.interval;
      s.decaying = false;
    }
    this.structures.set(s.id, s);
    this.statics.insert(s);
    if (type === 'core') {
      p.core = s;
      this.msg(p, 'Basis gegründet! Baue Mauern, Türme & Stacheln im Radius.');
    } else {
      this.addXp(p, C.XP.build);
      p.count++;
      p.counts[type] = (p.counts[type] || 0) + 1;
      if (type === 'forge') {
        p.forge = s;
        this.msg(p, 'Schmiede gebaut! Stell dich daneben und drücke [F].');
      }
    }
  }

  placementError(p, type, x, y, half) {
    const def = C.STRUCTURES[type], W = C.WORLD_SIZE;
    if (x - half < 0 || y - half < 0 || x + half > W || y + half > W) return 'Außerhalb der Welt.';
    if (Math.hypot(x - p.x, y - p.y) > C.PLAYER.buildRange) return 'Zu weit entfernt.';
    if (type === 'core') {
      if (p.core) return 'Du hast bereits einen Basis-Kern.';
      for (const s of this.structures.values()) {
        if (s.type === 'core' && Math.hypot(s.x - x, s.y - y) < lv(s).radius + 400) return 'Zu nah an einer anderen Basis.';
      }
    } else {
      if (!p.core) return 'Baue zuerst deinen Basis-Kern (Baumenü [B]).';
      if (Math.hypot(x - p.core.x, y - p.core.y) > lv(p.core).radius) return 'Nur innerhalb deines Basis-Radius.';
      if (p.count >= lv(p.core).maxStructures) return 'Gebäude-Limit erreicht – Kern upgraden!';
      if (def.limit && (p.counts[type] || 0) >= def.limit) return `Maximal ${def.limit}× ${def.name}.`;
    }
    if (!Inv.canAfford(p.inv, def.levels[0].cost)) return 'Nicht genug Ressourcen im Inventar.';
    const box = { x, y, half: half - 1 };
    if (this.cityAt(x, y, C.MAP.noBuildMargin + half)) return 'In Städten kann nicht gebaut werden.';
    for (const o of this.statics.query(x, y, Math.max(half * 1.5 + 70, 400))) {
      if (o.cr !== undefined) {
        if (circleHitsRect(o.x, o.y, o.cr, box)) return 'Platz ist blockiert.';
      } else if (Math.abs(o.x - x) < o.half + half - 1 && Math.abs(o.y - y) < o.half + half - 1) {
        return 'Platz ist blockiert.';
      }
    }
    for (const z of this.zombies.values()) if (circleHitsRect(z.x, z.y, z.r, box)) return 'Ein Zombie steht im Weg.';
    for (const o of this.players.values()) {
      if (!o.dead && o.id !== p.id && circleHitsRect(o.x, o.y, o.r, box)) return 'Ein Spieler steht im Weg.';
    }
    return null;
  }

  upgrade(p, id) {
    const s = this.structures.get(id);
    if (!s || s.owner !== p.id) return;
    const levels = C.STRUCTURES[s.type].levels;
    if (s.level + 1 >= levels.length) return this.msg(p, 'Maximales Level erreicht.');
    if (s.type !== 'core' && s.level + 1 > p.core.level) return this.msg(p, 'Upgrade zuerst deinen Basis-Kern.');
    const next = levels[s.level + 1];
    if (!Inv.canAfford(p.inv, next.cost)) return this.msg(p, 'Nicht genug Ressourcen im Inventar.');
    Inv.pay(p.inv, next.cost);
    s.level++;
    s.maxHp = next.hp;
    s.hp = next.hp;
    if (s.items) while (s.items.length < next.slots) s.items.push(null);
    this.events.push([s.x, s.y, 'up']);
  }

  demolish(p, id) {
    const s = this.structures.get(id);
    if (!s || s.owner !== p.id) return;
    if (s.type !== 'core') {
      // 50% der Baukosten zurück
      for (const [k, v] of Object.entries(C.STRUCTURES[s.type].levels[0].cost)) this.give(p, k, Math.floor(v / 2), s.x, s.y);
    }
    this.destroyStructure(s);
  }

  // Ausrüstung an der eigenen Schmiede herstellen; ihr Level bestimmt, was möglich ist
  craft(p, id) {
    const eq = C.EQUIPMENT[id], stackRecipe = C.ITEMS.recipes[id];
    const def = eq || (stackRecipe && { name: C.ITEMS.names[id], recipe: stackRecipe });
    if (!def || !def.recipe || p.dead) return;
    const f = p.forge;
    if (!f) return this.msg(p, 'Du brauchst eine Schmiede.');
    if (Math.hypot(f.x - p.x, f.y - p.y) > C.STRUCTURES.forge.useRange) return this.msg(p, 'Geh näher an deine Schmiede.');
    if (f.level + 1 < def.recipe.forge) return this.msg(p, `${def.name} braucht Schmiede Lv ${def.recipe.forge}.`);
    if (!Inv.canAfford(p.inv, def.recipe.cost)) return this.msg(p, `Nicht genug Ressourcen für ${def.name}.`);
    Inv.pay(p.inv, def.recipe.cost);
    const n = def.recipe.amount || 1;
    this.give(p, id, n, p.x, p.y);
    this.events.push([Math.round(f.x), Math.round(f.y), 'up']);
    this.addXp(p, C.XP.craft);
    this.msg(p, eq ? `${def.name} hergestellt! Ausrüsten im Charakterfenster [C].` : `${n}× ${def.name} hergestellt!`);
  }

  // Grundwerte + Ausrüstung → effektive Werte
  computeStats(p) {
    const P = C.PLAYER;
    const st = {
      maxHp: P.hp, armor: 0, damage: P.fistDamage, gather: P.fistGather,
      speed: P.speed, attackSpeed: +(1 / P.attackCooldown).toFixed(2), regen: P.regen, reach: P.reach,
      stamina: P.stamina, range: 0,
    };
    const REPLACE = ['damage', 'gather', 'attackSpeed', 'reach', 'range'];
    for (const sl of C.EQUIP_SLOTS) {
      const def = C.EQUIPMENT[p.equip[sl.id]];
      if (!def) continue;
      for (const [k, v] of Object.entries(def.stats)) {
        // Waffen ersetzen den Faustschaden, alles andere addiert sich
        if (sl.id === 'weapon' && REPLACE.includes(k)) st[k] = v;
        else st[k] = (st[k] || 0) + v;
      }
    }
    // Fertigkeiten: flache Boni addieren, Prozent-Boni multiplizieren
    const bonus = {};
    for (const sk of C.SKILLS) {
      const rank = p.skills[sk.id] || 0;
      for (const [k, v] of Object.entries(sk.per)) bonus[k] = (bonus[k] || 0) + v * rank;
    }
    for (const k of ['maxHp', 'stamina', 'armor', 'regen']) if (bonus[k]) st[k] = +(st[k] + bonus[k]).toFixed(1);
    const weapon = C.EQUIPMENT[p.equip.weapon];
    st.ranged = !!(weapon && weapon.ammo);
    st.damage = +(st.damage * (1 + ((st.ranged ? bonus.rangedDmg : bonus.meleeDmg) || 0))).toFixed(1);
    st.speed = Math.max(80, Math.round(st.speed * (1 + (bonus.speedPct || 0))));
    st.doubleGather = +(bonus.doubleGather || 0).toFixed(2);
    st.ammo = st.ranged ? weapon.ammo : null;
    st.reduction = +(st.armor / (st.armor + P.armorFactor)).toFixed(3);
    p.stats = st;
    p.maxHp = st.maxHp;
    p.hp = Math.min(p.hp, p.maxHp);
  }

  // Item aus Inventar-Slot anlegen; ein vorher getragenes Teil landet im selben Slot
  equip(p, slot) {
    const it = p.inv[slot];
    const def = it && C.EQUIPMENT[it.item];
    if (!def) return;
    const old = p.equip[def.slot];
    p.equip[def.slot] = it.item;
    p.inv[slot] = old ? { item: old, n: 1 } : null;
    this.computeStats(p);
  }

  // Ablegen: in einen bestimmten freien Slot, irgendeinen freien Slot oder auf den Boden
  unequip(p, eq, to, drop, x, y) {
    const item = p.equip[eq];
    if (!item) return;
    if (drop) {
      p.equip[eq] = null;
      this.computeStats(p);
      return this.dropFromHand(p, item, x, y);
    }
    if (to >= 0 && to < p.inv.length && !p.inv[to]) p.inv[to] = { item, n: 1 };
    else if (Inv.add(p.inv, item, 1) > 0) return this.msg(p, 'Inventar voll!');
    p.equip[eq] = null;
    this.computeStats(p);
  }

  destroyStructure(s) {
    if (!this.structures.has(s.id)) return;
    this.structures.delete(s.id);
    this.statics.remove(s);
    this.events.push([s.x, s.y, 'boom']);
    // Truheninhalt fällt verstreut auf den Boden
    for (const it of s.items || []) {
      if (!it) continue;
      const a = rand(0, TAU), d = rand(5, s.half + 15);
      this.dropItem(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, it.item, it.n);
    }
    const owner = this.players.get(s.owner);
    if (s.type === 'core') {
      for (const o of [...this.structures.values()]) if (o.owner === s.owner) this.destroyStructure(o);
      if (owner) {
        owner.core = null;
        owner.count = 0;
        owner.counts = {};
        owner.forge = null;
        this.msg(owner, 'Dein Basis-Kern wurde zerstört! Baue einen neuen.');
      }
    } else if (owner) {
      owner.count--;
      owner.counts[s.type]--;
      if (s.type === 'forge') owner.forge = null;
    }
  }

  // ---------- Schaden ----------

  damageZombie(z, dmg, attackerId) {
    if (!this.zombies.has(z.id)) return;
    z.hp -= dmg;
    this.events.push([Math.round(z.x), Math.round(z.y - z.r), 'hit', Math.max(1, Math.round(dmg))]);
    if (z.hp > 0) return;
    this.zombies.delete(z.id);
    const def = C.ENEMIES[z.type];
    const killer = this.players.get(attackerId);
    this.dropLoot(z, def.drops);
    if (killer) {
      killer.score += def.score;
      this.addXp(killer, def.xp);
      killer.kills++;
      this.lbDirty = true;
    }
    this.events.push([Math.round(z.x), Math.round(z.y), 'die']);
  }

  // Droptable würfeln; Beute fällt verstreut auf den Boden
  dropLoot(z, drops, fixedMult) {
    const mult = fixedMult || (this.isNight ? C.DROP_NIGHT_BONUS : 1);
    for (const d of drops || []) {
      if (Math.random() >= d.chance) continue;
      const n = Math.round((d.min + Math.floor(Math.random() * (d.max - d.min + 1))) * mult);
      const a = rand(0, TAU), r = rand(8, (z.r || 20) + 10);
      this.dropItem(z.x + Math.cos(a) * r, z.y + Math.sin(a) * r, d.item, n);
    }
  }

  damagePlayer(p, dmg) {
    if (p.dead || this.isProtected(p)) return;
    const taken = dmg * (1 - p.stats.reduction);
    p.hp -= taken;
    p.lastHurt = this.now;
    this.events.push([Math.round(p.x), Math.round(p.y - p.r), 'hurt', Math.max(1, Math.round(taken)), p.id]);
    if (p.hp > 0) return;
    p.dead = true;
    p.hp = 0;
    p.respawnT = C.PLAYER.respawnTime;
    // Ein Teil des Inventars fällt als Beute auf den Boden
    for (const [item, n] of Object.entries(Inv.totals(p.inv))) {
      const lose = Math.floor(n * C.PLAYER.deathLoss);
      if (!lose) continue;
      Inv.remove(p.inv, item, lose);
      this.dropItem(p.x + rand(-25, 25), p.y + rand(-25, 25), item, lose);
    }
    p.score = Math.floor(p.score * 0.8);
    this.lbDirty = true;
    this.msg(p, 'Du wurdest überrannt!');
  }

  damageStructure(s, dmg) {
    if (!this.structures.has(s.id)) return;
    s.hp -= dmg;
    s.lastHit = this.now;
    if (s.hp <= 0) this.destroyStructure(s);
  }

  // ---------- Simulation ----------

  update(dt) {
    const wasNight = this.isNight;
    this.time += dt;
    this.now += dt;
    if (this.isNight !== wasNight) {
      this.broadcastMsg(this.isNight
        ? `Nacht ${this.day} bricht herein – die Horde greift Basen an!`
        : `Tag ${this.day} – du hast die Nacht überlebt!`);
    }

    this.zgrid.clear();
    for (const z of this.zombies.values()) this.zgrid.insert(z);

    for (const p of this.players.values()) this.updatePlayer(p, dt);
    this.spawnZombies(dt);
    this.spawnCityZombies(dt);
    for (const z of [...this.zombies.values()]) this.updateZombie(z, dt);
    for (const s of [...this.structures.values()]) this.updateStructure(s, dt);
    this.updateUpkeep(dt);
    this.updateProjectiles(dt);
    if (this.db) {
      this.saveT += dt;
      if (this.saveT >= C.ACCOUNTS.autosave) {
        this.saveT = 0;
        try { this.saveAll(); } catch (e) { console.error('Autosave fehlgeschlagen:', e); }
      }
    }
    for (const it of this.items.values()) if (this.now - it.t > C.ITEMS.despawn) this.items.delete(it.id);
    // Nachwachsen (klappt es gerade nicht, wird es später erneut versucht)
    for (const pend of this.resPending) {
      if (this.now >= pend.at && this.spawnResource(pend.type, true, pend.pos)) pend.done = true;
      else if (this.now >= pend.at) pend.at = this.now + 5;
    }
    this.resPending = this.resPending.filter((pend) => !pend.done);
  }

  respawn(p) {
    p.dead = false;
    p.hp = p.maxHp;
    this.placeAtSpawn(p);
  }

  updatePlayer(p, dt) {
    this.updateProtection(p);
    if (p.dead) {
      p.respawnT -= dt;
      if (p.respawnT <= 0) this.respawn(p);
      return;
    }
    const k = p.keys, P = C.PLAYER;
    const mx = (k & 8 ? 1 : 0) - (k & 4 ? 1 : 0), my = (k & 2 ? 1 : 0) - (k & 1 ? 1 : 0);
    const moving = !!(mx || my);
    // Sprinten (Bit 16) kostet Ausdauer; leer = erschöpft, bis wieder exhaustedUntil erreicht ist
    p.sprinting = moving && (k & 16) && !p.exhausted && p.stamina > 0;
    if (p.sprinting) {
      p.stamina = Math.max(0, p.stamina - P.sprintCost * dt);
      p.sprintStop = this.now;
      if (p.stamina <= 0) p.exhausted = true;
    } else if (this.now - p.sprintStop > P.staminaDelay) {
      p.stamina = Math.min(p.stats.stamina, p.stamina + P.staminaRegen * dt);
    }
    if (p.exhausted && p.stamina >= P.exhaustedUntil) p.exhausted = false;
    if (moving) {
      const l = Math.hypot(mx, my), spd = p.stats.speed * (p.sprinting ? P.sprintMult : 1);
      p.x += (mx / l) * spd * dt;
      p.y += (my / l) * spd * dt;
    }
    // Gebäude sind massiv; nur eigene Türen (und die des Teams) lassen durch
    this.collideStatics(p, (s) => !(C.STRUCTURES[s.type].passOwner && this.allied(p, s.owner)));
    if (p.chest && !this.canUseChest(p, this.structures.get(p.chest))) p.chest = 0;
    p.x = clamp(p.x, p.r, C.WORLD_SIZE - p.r);
    p.y = clamp(p.y, p.r, C.WORLD_SIZE - p.r);
    this.pickupItems(p);

    p.atkCd -= dt;
    if (p.attacking && p.atkCd <= 0) {
      p.atkCd = 1 / p.stats.attackSpeed;
      if (p.stats.ranged) this.shoot(p);
      else {
        p.swings++;
        this.playerHit(p);
      }
    }
    if (this.now - p.lastHurt > 5 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.stats.regen * dt);
  }

  // ---------- Erfahrung & Fertigkeiten ----------

  xpNeeded(level) {
    return Math.round(C.XP.base * level ** C.XP.exp);
  }

  addXp(p, amount) {
    if (!amount || !p) return;
    p.xp += amount;
    while (p.xp >= this.xpNeeded(p.level)) {
      p.xp -= this.xpNeeded(p.level);
      p.level++;
      p.sp++;
      this.events.push([Math.round(p.x), Math.round(p.y), 'lvl', p.level, p.id]);
      this.msg(p, `Level ${p.level}! +1 Skillpunkt – verteilen mit [K]`);
    }
  }

  learnSkill(p, id) {
    const sk = C.SKILLS.find((x) => x.id === id);
    if (!sk || p.sp <= 0) return;
    const rank = p.skills[id] || 0;
    if (rank >= sk.max) return this.msg(p, `${sk.name} ist schon auf Maximum.`);
    p.skills[id] = rank + 1;
    p.sp--;
    const hpFrac = p.hp / p.maxHp;
    this.computeStats(p);
    if (sk.per.maxHp) p.hp = Math.min(p.maxHp, hpFrac * p.maxHp + sk.per.maxHp);
  }

  // ---------- Hotbar ----------

  isKnownItem(item) {
    return !!(C.EQUIPMENT[item] || C.ITEMS.names[item]);
  }

  assignHotbar(p, i, item) {
    if (i < 0 || i >= C.HOTBAR_SIZE) return;
    if (item === null || item === undefined) { p.hotbar[i] = null; return; }
    item = String(item);
    if (!this.isKnownItem(item)) return;
    // Ein Item steht höchstens einmal in der Hotbar
    for (let k = 0; k < p.hotbar.length; k++) if (p.hotbar[k] === item) p.hotbar[k] = null;
    p.hotbar[i] = item;
  }

  // Slot benutzen: Ausrüstung anlegen, Essen essen, Munitionstyp wählen
  useHotbar(p, i) {
    const item = p.hotbar[i];
    if (!item || p.dead) return;
    const slot = p.inv.findIndex((x) => x && x.item === item);
    const eq = C.EQUIPMENT[item];
    if (eq) {
      if (p.equip[eq.slot] === item) return;
      if (slot < 0) return this.msg(p, `${eq.name} ist nicht im Inventar.`);
      return this.equip(p, slot);
    }
    if (C.ITEMS.food[item]) {
      if (slot < 0) return this.msg(p, `Kein ${C.ITEMS.names[item]} im Inventar.`);
      return this.eat(p, slot);
    }
    const group = Object.keys(C.AMMO).find((g) => C.AMMO[g].types.some((t) => t.item === item));
    if (group) {
      p.ammoPref[group] = item;
      this.msg(p, `Munition: ${C.ITEMS.names[item]} (${Inv.count(p.inv, item)})`);
    }
  }

  // Welche Munition wird verschossen? Gewählter Typ, sonst der stärkste vorhandene.
  ammoFor(p, group) {
    const types = C.AMMO[group].types;
    const pref = types.find((t) => t.item === p.ammoPref[group]);
    if (pref && Inv.count(p.inv, pref.item) > 0) return pref;
    for (let i = types.length - 1; i >= 0; i--) if (Inv.count(p.inv, types[i].item) > 0) return types[i];
    return null;
  }

  // [R]: zum nächsten vorhandenen Munitionstyp der ausgerüsteten Waffe wechseln
  cycleAmmo(p) {
    const def = C.EQUIPMENT[p.equip.weapon];
    if (!def || !def.ammo) return;
    const types = C.AMMO[def.ammo].types.filter((t) => Inv.count(p.inv, t.item) > 0);
    if (types.length < 2) return this.msg(p, types.length ? `Nur ${C.ITEMS.names[types[0].item]} vorhanden.` : 'Keine Munition.');
    const cur = this.ammoFor(p, def.ammo);
    const next = types[(types.findIndex((t) => t === cur) + 1) % types.length];
    p.ammoPref[def.ammo] = next.item;
    this.msg(p, `Munition: ${C.ITEMS.names[next.item]} (${Inv.count(p.inv, next.item)})`);
  }

  // Fernwaffe: verbraucht 1 Munition, feuert pellets Geschosse mit Streuung; Schüsse sind laut
  shoot(p) {
    const def = C.EQUIPMENT[p.equip.weapon], pr = def.projectile;
    const am = this.ammoFor(p, def.ammo);
    if (!am) {
      if (this.now - p.ammoMsgT > 2) {
        p.ammoMsgT = this.now;
        this.msg(p, `Keine Munition (${C.AMMO[def.ammo].label})! In der Schmiede herstellen.`);
      }
      return;
    }
    Inv.remove(p.inv, am.item, 1);
    p.swings++;
    const look = am.look, muzzle = p.r + (def.kind === 'gun' ? 34 : 10);
    const mx = p.x + Math.cos(p.angle) * muzzle, my = p.y + Math.sin(p.angle) * muzzle;
    for (let i = 0; i < (pr.pellets || 1); i++) {
      const a = p.angle + (Math.random() - 0.5) * 2 * (pr.spread || 0);
      // Schrot fliegt unterschiedlich weit, damit die Garbe nicht als Linie endet
      const range = p.stats.range * (pr.pellets > 1 ? rand(0.8, 1) : 1);
      this.projectiles.push({
        x: mx, y: my, vx: Math.cos(a) * pr.speed, vy: Math.sin(a) * pr.speed,
        dmg: p.stats.damage + am.damage, life: range / pr.speed, owner: p.id, fromPlayer: true, look,
        ammo: am.item, recover: am.recover,
      });
    }
    if (def.kind === 'gun') this.events.push([Math.round(mx), Math.round(my), 'shot', +p.angle.toFixed(2)]);
    if (def.noise) {
      // Lärm: feindliche Gegner im Umkreis werden auf den Schützen aufmerksam
      for (const z of this.zombies.values()) {
        if (z.ai === 'neutral' || Math.hypot(z.x - p.x, z.y - p.y) > def.noise) continue;
        z.angryAt = p.id;
        z.angryUntil = this.now + C.ANGER_TIME;
        z.retarget = 0;
      }
    }
  }

  collideStatics(e, structFilter, onTouch) {
    for (const o of this.statics.query(e.x, e.y, e.r + 90)) {
      if (o.cr !== undefined) pushOutCircle(e, o.x, o.y, o.cr); // Ressource oder See
      else if (o.kind === 'ruin') pushOutRect(e, o);
      else if (structFilter(o) && pushOutRect(e, o) && onTouch) onTouch(o);
    }
  }

  playerHit(p) {
    const tool = p.stats; // damage & gather aus Waffe bzw. Faust
    const reach = p.stats.reach;
    const hx = p.x + Math.cos(p.angle) * reach * 0.65, hy = p.y + Math.sin(p.angle) * reach * 0.65;
    const hr = reach * 0.55;

    for (const z of this.zgrid.query(hx, hy, hr + 40)) {
      if (Math.hypot(z.x - hx, z.y - hy) < hr + z.r) {
        z.angryAt = p.id;
        z.angryUntil = this.now + C.ANGER_TIME;
        z.retarget = 0;
        this.damageZombie(z, tool.damage, p.id);
      }
    }
    for (const o of this.statics.query(hx, hy, hr + 80)) {
      if (o.kind === 'res') {
        if (Math.hypot(o.x - hx, o.y - hy) < hr * 0.5 + o.r) {
          if (o.type === 'crate') {
            o.shook = this.now;
            this.events.push([Math.round(o.x), Math.round(o.y), 'g', 0, o.id, 'crate', p.id]);
            this.depleteResource(o, 1, p);
            continue;
          }
          const kind = C.RESOURCES[o.type].gives;
          // Sammler-Skill: Chance auf doppelten Ertrag
          const want = Math.min(tool.gather * (Math.random() < tool.doubleGather ? 2 : 1), o.amount);
          if (!want) continue;
          const got = want - Inv.add(p.inv, kind, want);
          if (!got) {
            if (this.now - p.fullMsgT > 2) { p.fullMsgT = this.now; this.msg(p, 'Inventar voll! [Tab] zum Aufräumen.'); }
            continue;
          }
          p.score += got;
          this.lbDirty = true;
          this.events.push([Math.round(o.x), Math.round(o.y), 'g', got, o.id, kind, p.id]);
          this.addXp(p, got * C.XP.gather);
          this.depleteResource(o, got, p);
        }
      } else if (o.kind === 's' && circleHitsRect(hx, hy, hr * 0.6, o)) {
        if (this.allied(p, o.owner)) this.repair(p, o);
        else if (C.PVP) this.damageStructure(o, tool.damage * 1.5);
      }
    }
    if (C.PVP) {
      for (const o of this.players.values()) {
        if (o !== p && !o.dead && !this.allied(p, o.id) && Math.hypot(o.x - hx, o.y - hy) < hr + o.r) this.damagePlayer(o, tool.damage);
      }
    }
  }

  // Eigene Gebäude mit der Axt reparieren: kostet Holz
  repair(p, s) {
    if (s.hp >= s.maxHp) return;
    const cost = 2 + s.level * 2;
    if (Inv.count(p.inv, 'wood') < cost) return this.msg(p, `Reparieren kostet ${cost} Holz.`);
    Inv.remove(p.inv, 'wood', cost);
    s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.1);
    this.events.push([s.x, s.y, 'fix']);
  }

  spawnZombies(dt) {
    const S = C.SPAWN;
    const nightAll = this.isNight, day = this.day;
    for (const p of this.players.values()) {
      if (p.dead || this.zombies.size >= S.maxTotal || this.isProtected(p)) continue;
      const night = nightAll && !this.isCalm(p); // ruhige erste Nacht: Spawns wie am Tag
      p.spawnCd -= dt;
      if (p.spawnCd > 0) continue;
      p.spawnCd = (night ? S.nightInterval : S.dayInterval) * rand(0.7, 1.3);

      // Nachts spawnen die meisten Zombies rund um die Basis
      const atCore = night && p.core && Math.random() < 0.7;
      const center = atCore ? p.core : p;
      const want = night ? S.nightBase + day * S.nightPerDay : S.dayBase + Math.floor(day / 2);
      let near = 0;
      for (const z of this.zombies.values()) if (Math.abs(z.x - center.x) < 1500 && Math.abs(z.y - center.y) < 1500) near++;
      if (near >= want) continue;

      for (let tries = 0; tries < 10; tries++) {
        const a = rand(0, TAU);
        const d = atCore ? lv(p.core).radius + rand(450, 750) : rand(850, 1150);
        const x = center.x + Math.cos(a) * d, y = center.y + Math.sin(a) * d;
        if (x < 50 || y < 50 || x > C.WORLD_SIZE - 50 || y > C.WORLD_SIZE - 50) continue;
        if (!this.isFree(x, y, 40)) continue;
        if (this.tooCloseToPlayersOrBases(x, y)) continue;
        const type = this.pickEnemyType(night, day);
        const pack = C.ENEMIES[type].pack;
        const n = pack ? pack[0] + Math.floor(Math.random() * (pack[1] - pack[0] + 1)) : 1;
        for (let i = 0; i < n; i++) this.spawnZombie(type, x + rand(-40, 40), y + rand(-40, 40));
        break;
      }
    }
  }

  // Städte sind gefährlich: dort laufen Zombies herum, sobald Spieler in der Nähe sind
  spawnCityZombies(dt) {
    const M = C.MAP, day = this.day, night = this.isNight;
    for (const city of this.world.cities) {
      if (this.zombies.size >= C.SPAWN.maxTotal) return;
      city.spawnCd = (city.spawnCd || 0) - dt;
      if (city.spawnCd > 0) continue;
      city.spawnCd = rand(1.5, 2.5);
      const players = [...this.players.values()].filter((p) => !p.dead && Math.hypot(p.x - city.x, p.y - city.y) < city.r + 1300);
      if (!players.length) continue;
      let n = 0;
      for (const z of this.zombies.values()) if (z.ai === 'zombie' && Math.hypot(z.x - city.x, z.y - city.y) < city.r) n++;
      const want = Math.round((M.cityZombies + M.cityZombiesPerDay * (day - 1)) * (night ? 1.5 : 1));
      if (n >= want) continue;
      for (let tries = 0; tries < 8; tries++) {
        const a = rand(0, TAU), d = Math.sqrt(Math.random()) * city.r * 0.9;
        const x = city.x + Math.cos(a) * d, y = city.y + Math.sin(a) * d;
        if (!this.isFree(x, y, 30) || players.some((p) => Math.hypot(p.x - x, p.y - y) < 450)) continue;
        let type = this.pickEnemyType(night, day);
        if (C.ENEMIES[type].ai !== 'zombie') type = 'normal';
        this.spawnZombie(type, x, y);
        break;
      }
    }
  }

  tooCloseToPlayersOrBases(x, y) {
    for (const o of this.players.values()) if (!o.dead && Math.hypot(o.x - x, o.y - y) < 700) return true;
    for (const s of this.structures.values()) {
      if (s.type === 'core' && Math.hypot(s.x - x, s.y - y) < lv(s).radius + 150) return true;
    }
    return false;
  }

  // Gewichtete Zufallswahl laut ENEMIES[*].spawn
  pickEnemyType(night, day) {
    const weights = Object.entries(C.ENEMIES).map(([type, def]) => {
      const sp = def.spawn;
      let w = (night ? sp.night : sp.day) || 0;
      if (w > 0 && sp.perDay) w = Math.min(sp.max || Infinity, w + sp.perDay * (day - 1));
      return [type, w];
    });
    let r = Math.random() * weights.reduce((a, [, w]) => a + w, 0);
    for (const [type, w] of weights) if ((r -= w) < 0) return type;
    return 'normal';
  }

  spawnZombie(type, x, y) {
    const def = C.ENEMIES[type], S = C.SPAWN, day = this.day, night = this.isNight;
    const hp = def.hp * (1 + S.hpScale * (day - 1));
    const z = {
      id: uid(), kind: 'z', type, x, y, r: def.r, br: def.r, hp, maxHp: hp,
      speed: def.speed * (night ? S.nightSpeed : 1) * rand(0.9, 1.1),
      dmg: def.dmg * (1 + 0.08 * (day - 1)), sdmg: def.sdmg * (1 + 0.1 * (day - 1)),
      atkCd: 0, spikeCd: 0, retarget: 0, target: null, wanderA: rand(0, TAU), angle: 0, attacks: 0,
      ai: def.ai, angryAt: 0, angryUntil: 0,
    };
    this.zombies.set(z.id, z);
  }

  isAlive(t) {
    return t.kind === 'p' ? this.players.has(t.id) && !t.dead : this.structures.has(t.id);
  }

  findZombieTarget(z) {
    const night = this.isNight, def = C.ENEMIES[z.type];
    let nearestAny = Infinity;
    for (const p of this.players.values()) if (!p.dead) nearestAny = Math.min(nearestAny, dist(z, p));
    for (const s of this.structures.values()) if (s.type === 'core') nearestAny = Math.min(nearestAny, dist(z, s));
    z.far = nearestAny > 2300;

    // Wer angegriffen wurde, verfolgt seinen Angreifer (alle Typen)
    const attacker = this.players.get(z.angryAt);
    if (attacker && !attacker.dead && !this.isProtected(attacker) && this.now < z.angryUntil && dist(z, attacker) < (def.leash || 900)) return attacker;
    if (z.ai === 'neutral') return null;

    // Revier-Tiere halten ihr Ziel bis zur Leine, greifen aber nur in der Nähe an
    if (z.ai === 'territorial' && z.target && z.target.kind === 'p' && !z.target.dead && !this.isProtected(z.target) && dist(z, z.target) < def.leash) return z.target;

    const aggro = def.aggro || (night ? C.SPAWN.nightAggro : C.SPAWN.dayAggro);
    let best = null, bestD = Infinity;
    for (const p of this.players.values()) {
      if (p.dead || this.isProtected(p)) continue;
      const d = dist(z, p);
      if (d < aggro && d < bestD) { best = p; bestD = d; }
    }
    // Nur Zombies greifen nachts gezielt Basen an, außer ein Spieler steht direkt daneben
    if (z.ai === 'zombie' && night && !(best && bestD < 260)) {
      for (const s of this.structures.values()) {
        if (s.type !== 'core' || this.isCalm(this.players.get(s.owner))) continue;
        const d = dist(z, s);
        if (d < 1600 && d * 0.8 < bestD) { best = s; bestD = d * 0.8; }
      }
    }
    return best;
  }

  updateZombie(z, dt) {
    z.atkCd -= dt;
    z.spikeCd -= dt;
    z.retarget -= dt;
    if (z.retarget <= 0 || (z.target && !this.isAlive(z.target))) {
      z.retarget = 0.5 + Math.random() * 0.2;
      z.target = this.findZombieTarget(z);
      if (z.far) { this.zombies.delete(z.id); return; }
    }

    let tx, ty, spd = z.speed;
    if (z.target) {
      tx = z.target.x; ty = z.target.y;
    } else {
      if (Math.random() < dt * 0.4) z.wanderA += rand(-1.5, 1.5);
      tx = z.x + Math.cos(z.wanderA) * 100;
      ty = z.y + Math.sin(z.wanderA) * 100;
      spd *= 0.35;
    }
    const dx = tx - z.x, dy = ty - z.y, d = Math.hypot(dx, dy);
    z.angle = Math.atan2(dy, dx);
    const touchingPlayer = z.target && z.target.kind === 'p' && d < z.r + z.target.r + 10;
    if (!touchingPlayer && d > 1) {
      z.x += (dx / d) * spd * dt;
      z.y += (dy / d) * spd * dt;
    }

    for (const o of this.zgrid.query(z.x, z.y, z.r * 2 + 10)) {
      if (o === z) continue;
      const ox = z.x - o.x, oy = z.y - o.y, min = z.r + o.r, d2 = ox * ox + oy * oy;
      if (d2 < min * min && d2 > 0.01) {
        const dd = Math.sqrt(d2), push = (min - dd) * 0.5;
        z.x += (ox / dd) * push; z.y += (oy / dd) * push;
        o.x -= (ox / dd) * push; o.y -= (oy / dd) * push;
      }
    }
    for (const p of this.players.values()) if (!p.dead) pushOutCircle(z, p.x, p.y, p.r);

    let blocker = null;
    this.collideStatics(z, () => true, (s) => {
      if (!blocker || s === z.target) blocker = s;
      if (s.type === 'spike' && z.spikeCd <= 0) {
        z.spikeCd = 0.6;
        this.damageZombie(z, lv(s).dmg, s.owner);
      }
    });
    if (!this.zombies.has(z.id)) return;
    z.x = clamp(z.x, z.r, C.WORLD_SIZE - z.r);
    z.y = clamp(z.y, z.r, C.WORLD_SIZE - z.r);

    if (z.atkCd <= 0) {
      if (touchingPlayer) {
        if (!this.isProtected(z.target)) this.damagePlayer(z.target, z.dmg);
        z.atkCd = 1;
        z.attacks++;
      } else if (blocker && z.sdmg > 0) {
        this.damageStructure(blocker, z.sdmg);
        z.atkCd = 1;
        z.attacks++;
      }
    }
  }

  updateStructure(s, dt) {
    if (s.type === 'turret') {
      const L = lv(s);
      s.cd -= dt;
      let best = null, bestD = L.range;
      for (const z of this.zgrid.query(s.x, s.y, L.range)) {
        if (!this.zombies.has(z.id)) continue;
        const d = dist(s, z);
        if (d < bestD) { best = z; bestD = d; }
      }
      if (C.PVP) {
        for (const p of this.players.values()) {
          if (p.dead || this.allied(p, s.owner)) continue;
          const d = dist(s, p);
          if (d < bestD) { best = p; bestD = d; }
        }
      }
      if (best) {
        s.angle = Math.atan2(best.y - s.y, best.x - s.x);
        if (s.cd <= 0) {
          s.cd = 1 / L.rate;
          const sp = 900;
          this.projectiles.push({
            x: s.x + Math.cos(s.angle) * 22, y: s.y + Math.sin(s.angle) * 22,
            vx: Math.cos(s.angle) * sp, vy: Math.sin(s.angle) * sp,
            dmg: L.dmg, life: L.range / sp + 0.15, owner: s.owner,
          });
        }
      }
    } else if (s.type === 'mine') {
      s.cd -= dt;
      if (s.cd <= 0) {
        s.cd = C.STRUCTURES.mine.interval;
        const owner = this.players.get(s.owner);
        if (owner) {
          const inc = lv(s).income;
          // Volles Inventar: Ertrag stapelt sich neben der Mine
          for (const [k, v] of Object.entries(inc)) this.give(owner, k, v, s.x, s.y + s.half + 15);
          this.events.push([s.x, s.y, 'mine', inc.gold, s.owner]);
        }
      }
    }
  }

  updateProjectiles(dt) {
    const keep = [];
    for (const b of this.projectiles) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let hit = false;
      for (const z of this.zgrid.query(b.x, b.y, 40)) {
        if (this.zombies.has(z.id) && Math.hypot(z.x - b.x, z.y - b.y) < z.r + 5) {
          if (b.fromPlayer) {
            z.angryAt = b.owner;
            z.angryUntil = this.now + C.ANGER_TIME;
            z.retarget = 0;
          }
          this.damageZombie(z, b.dmg, b.owner);
          hit = true;
          break;
        }
      }
      if (!hit && C.PVP) {
        for (const p of this.players.values()) {
          if (!p.dead && !this.allied(p, b.owner) && Math.hypot(p.x - b.x, p.y - b.y) < p.r + 5) {
            this.damagePlayer(p, b.dmg);
            hit = true;
            break;
          }
        }
      }
      if (!hit && b.fromPlayer) {
        const shooter = this.players.get(b.owner);
        for (const o of this.statics.query(b.x, b.y, 10)) {
          if (o.kind === 'water') continue;
          const blocks = o.kind === 'res' ? Math.hypot(o.x - b.x, o.y - b.y) < o.cr
            : o.kind === 'ruin' ? circleHitsRect(b.x, b.y, 3, o)
              : o.owner !== b.owner && !this.allied(shooter, o.owner) && !C.STRUCTURES[o.type].shootThrough && circleHitsRect(b.x, b.y, 3, o);
          if (blocks) { hit = true; break; }
        }
      }
      if (hit && b.recover && Math.random() < b.recover) this.dropItem(b.x - b.vx * 0.02, b.y - b.vy * 0.02, b.ammo, 1);
      if (!hit && b.life > 0) keep.push(b);
    }
    this.projectiles = keep;
  }

  // ---------- Netzwerk ----------

  // Sichtbare Ausrüstung anderer Spieler: Item-IDs für Waffe, Mütze, Shirt (0 = nichts)
  equipLook(p) {
    return [p.equip.weapon || 0, p.equip.head || 0, p.equip.chest || 0];
  }

  sendState() {
    const events = this.events;
    this.events = [];
    let lb = null;
    this.lbTimer++;
    if (this.lbDirty && this.lbTimer >= C.SEND_RATE) {
      this.lbTimer = 0;
      this.lbDirty = false;
      lb = [...this.players.values()].sort((a, b) => b.score - a.score).slice(0, 10)
        .map((p) => [p.id, p.name, p.score]);
    }
    const cyc = this.time % this.cycle, night = this.isNight;
    const tm = [this.day, night ? 1 : 0, night ? (cyc - C.DAY_LENGTH) / C.NIGHT_LENGTH : cyc / C.DAY_LENGTH];
    // Ressourcen-Änderungen gehen an alle (klein, und so bleibt jeder Client aktuell)
    const resUpdate = (this.resChanged.size || this.resAdded.length || this.resRemoved.length) ? {
      c: [...this.resChanged].flat(),
      a: this.resAdded.map((r) => this.resWire(r)),
      r: this.resRemoved,
    } : null;
    this.resChanged = new Map();
    this.resAdded = [];
    this.resRemoved = [];
    const W = C.VIEW.w / 2 + 200, H = C.VIEW.h / 2 + 200;
    this.mmTimer = (this.mmTimer || 0) + 1;
    const sendMinimap = this.mmTimer % 5 === 0;

    for (const p of this.players.values()) {
      const vx = p.x, vy = p.y;
      const inView = (o, m = 0) => Math.abs(o.x - vx) < W + m && Math.abs(o.y - vy) < H + m;
      const pl = [], zs = [], ss = [], pr = [], ev = [], it = [];
      for (const o of this.items.values()) if (inView(o)) it.push([o.id, o.item, o.n, Math.round(o.x), Math.round(o.y)]);
      for (const o of this.players.values()) {
        if (o.dead || !inView(o)) continue;
        pl.push([o.id, Math.round(o.x), Math.round(o.y), +o.angle.toFixed(2), Math.round(o.hp), o.maxHp, o.name, o.swings, this.equipLook(o), o.sprinting ? 1 : 0, this.isProtected(o) ? 1 : 0, o.team]);
      }
      for (const z of this.zombies.values()) {
        if (!inView(z)) continue;
        zs.push([z.id, z.type, Math.round(z.x), Math.round(z.y), +z.angle.toFixed(2), Math.round(z.hp), Math.round(z.maxHp), z.attacks, z.target ? 1 : 0]);
      }
      for (const s of this.structures.values()) {
        if (!inView(s, 400)) continue;
        ss.push([s.id, s.type, s.x, s.y, s.level, Math.round(s.hp), s.maxHp, s.owner, +s.angle.toFixed(2)]);
      }
      for (const b of this.projectiles) if (inView(b)) pr.push([Math.round(b.x), Math.round(b.y), +Math.atan2(b.vy, b.vx).toFixed(2), b.look || 0]);
      for (const e of events) if (inView({ x: e[0], y: e[1] })) ev.push(e);
      const core = p.core;
      const chest = p.chest && this.structures.get(p.chest);
      if (p.chest && !this.canUseChest(p, chest)) p.chest = 0;
      const team = this.teamOf(p);
      for (const [from, at] of p.invites) if (this.now - at > C.TEAM.inviteTime || !this.players.has(from)) p.invites.delete(from);
      const msg = {
        t: 's', tm, pl, zs, ss, pr, ev, it,
        me: {
          x: Math.round(p.x), y: Math.round(p.y), hp: Math.round(p.hp), maxHp: p.maxHp,
          res: Inv.totals(p.inv), inv: p.inv.map((s) => (s ? [s.item, s.n] : 0)), eq: p.equip, stats: p.stats, hb: p.hotbar,
          prot: Math.max(0, Math.ceil(p.protectUntil - this.time)), calm: Math.max(0, Math.ceil(p.calmUntil - this.time)),
          lvl: p.level, xp: Math.floor(p.xp), xpNext: this.xpNeeded(p.level), sp: p.sp, skills: p.skills, ammo: p.stats.ammo ? (this.ammoFor(p, p.stats.ammo) || C.AMMO[p.stats.ammo].types[0]).item : null, st: Math.round(p.stamina), ex: p.exhausted ? 1 : 0, dead: p.dead, rt: +p.respawnT.toFixed(1), score: p.score, kills: p.kills,
          core: core ? [core.id, core.x, core.y, core.level, lv(core).radius] : null,
          count: p.count, max: core ? lv(core).maxStructures : 0, mines: p.counts.mine || 0, counts: p.counts,
          forge: p.forge ? [p.forge.id, p.forge.x, p.forge.y, p.forge.level] : null,
          // Offene Truhe / offenes Kern-Lager: [id, Slots im Format des Inventars, Unterhalt (nur Kern)]
          ch: p.chest ? [chest.id, chest.items.map((s) => (s ? [s.item, s.n] : 0)), chest.type === 'core' ? this.upkeepInfo(chest) : null] : null,
          up: core ? this.upkeepInfo(core) : null,
          // Team: Mitglieder als [id, Name, x, y, Leben-Anteil, tot, Kern-x, Kern-y] (Positionen für die Karten)
          team: team ? {
            id: team.id, name: team.name, leader: team.leader,
            m: team.members.map((id) => this.players.get(id)).filter(Boolean).map((o) => [
              o.id, o.name, Math.round(o.x), Math.round(o.y), +(o.hp / o.maxHp).toFixed(2), o.dead ? 1 : 0,
              o.core ? o.core.x : 0, o.core ? o.core.y : 0,
            ]),
          } : null,
          ti: [...p.invites.keys()].map((id) => [id, this.players.get(id).name]),
        },
      };
      if (lb) { msg.lb = lb; msg.on = this.players.size; }
      if (resUpdate) msg.ru = resUpdate;
      if (sendMinimap) {
        // Gegner im weiten Umkreis als [x, y, feindlich, ...] + fremde Spieler im Radar-Umkreis als [x, y, ...]
        // (Koordinaten / 10). Fremde tauchen nie auf der großen Karte auf, Teammitglieder kommen über me.team.
        const R = C.MINIMAP_RANGE, e = [], pp = [];
        for (const z of this.zombies.values()) {
          if (Math.abs(z.x - vx) < R && Math.abs(z.y - vy) < R) e.push(Math.round(z.x / 10), Math.round(z.y / 10), z.ai !== 'neutral' || z.target ? 1 : 0);
        }
        for (const o of this.players.values()) {
          if (o === p || o.dead || this.allied(p, o.id) || Math.abs(o.x - vx) >= R || Math.abs(o.y - vy) >= R) continue;
          pp.push(Math.round(o.x / 10), Math.round(o.y / 10));
        }
        msg.mm = { e, p: pp };
      }
      p.conn.send(JSON.stringify(msg));
    }
  }
}

module.exports = Game;
