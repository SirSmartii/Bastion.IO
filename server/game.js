'use strict';
const C = require('./config');
const Inv = require('./inventory');

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

const lv = (s) => C.STRUCTURES[s.type].levels[s.level];

class Game {
  constructor() {
    this.players = new Map();
    this.zombies = new Map();
    this.structures = new Map();
    this.items = new Map(); // Items am Boden
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
    this.genWorld();
  }

  get day() { return Math.floor(this.time / this.cycle) + 1; }
  get isNight() { return this.time % this.cycle >= C.DAY_LENGTH; }

  genWorld() {
    for (const [type, def] of Object.entries(C.RESOURCES)) {
      for (let i = 0; i < def.count; i++) this.spawnResource(type, false);
    }
  }

  // Neue Ressource an freier Stelle; respawn = true meidet Basen und Spieler
  spawnResource(type, respawn) {
    const def = C.RESOURCES[type], W = C.WORLD_SIZE;
    for (let tries = 0; tries < 25; tries++) {
      const r = rand(def.minR, def.maxR);
      const x = rand(r + 80, W - r - 80), y = rand(r + 80, W - r - 80);
      const near = this.statics.query(x, y, r + 120);
      if (near.some((o) => (o.kind === 'res' ? Math.hypot(o.x - x, o.y - y) < o.br + r + 50 : circleHitsRect(x, y, r + 30, o)))) continue;
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
  depleteResource(o, n) {
    o.amount -= n;
    const def = C.RESOURCES[o.type];
    if (o.amount <= 0) {
      this.statics.remove(o);
      this.resources.splice(this.resources.indexOf(o), 1);
      this.resChanged.delete(o.id);
      this.resRemoved.push(o.id);
      this.resPending.push({ type: o.type, at: this.now + def.respawn });
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
    let player = null;
    conn.on('message', (raw) => {
      if (raw.length > 2048) return;
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      if (!msg || typeof msg !== 'object') return;
      if (!player) {
        if (msg.t === 'join') player = this.addPlayer(conn, msg.name);
        return;
      }
      this.handle(player, msg);
    });
    conn.on('close', () => { if (player) this.removePlayer(player); });
  }

  addPlayer(conn, name) {
    name = String(name || '').replace(/[^\p{L}\p{N} _\-.!?]/gu, '').trim().slice(0, 16) || 'Überlebender';
    const P = C.PLAYER;
    const p = {
      id: uid(), kind: 'p', conn, name, x: 0, y: 0, r: P.radius, br: P.radius,
      angle: 0, hp: P.hp, maxHp: P.hp, keys: 0, attacking: false, atkCd: 0, swings: 0,
      inv: Inv.create(), equip: {}, stats: null, core: null, forge: null, count: 0, counts: {},
      score: 0, kills: 0, dead: false, respawnT: 0, lastHurt: -99, spawnCd: 3, fullMsgT: -99, eatT: -99,
      stamina: P.stamina, sprinting: false, exhausted: false, sprintStop: -99, ammoMsgT: -99,
    };
    for (const [item, n] of Object.entries(P.startRes)) Inv.add(p.inv, item, n);
    for (const sl of C.EQUIP_SLOTS) p.equip[sl.id] = P.startEquip[sl.id] || null;
    this.computeStats(p);
    p.hp = p.maxHp;
    this.placeAtSpawn(p);
    this.players.set(p.id, p);
    this.lbDirty = true;
    conn.send(JSON.stringify({
      t: 'init', id: p.id,
      cfg: {
        WORLD_SIZE: C.WORLD_SIZE, TILE: C.TILE, VIEW: C.VIEW, PVP: C.PVP,
        DAY_LENGTH: C.DAY_LENGTH, NIGHT_LENGTH: C.NIGHT_LENGTH,
        PLAYER: C.PLAYER, EQUIPMENT: C.EQUIPMENT, EQUIP_SLOTS: C.EQUIP_SLOTS, FORGE_TABS: C.FORGE_TABS, RESOURCE_MIN_SCALE: C.RESOURCE_MIN_SCALE, INVENTORY: C.INVENTORY, ITEMS: C.ITEMS, STRUCTURES: C.STRUCTURES, ENEMIES: C.ENEMIES, BUILD_CATEGORIES: C.BUILD_CATEGORIES, MINIMAP_RANGE: C.MINIMAP_RANGE,
      },
      res: this.resources.map((r) => this.resWire(r)),
    }));
    this.msg(p, 'Sammle Holz & Stein und baue deinen Basis-Kern (Baumenü [B])!');
    return p;
  }

  removePlayer(p) {
    if (p.core) this.destroyStructure(p.core);
    this.players.delete(p.id);
    this.lbDirty = true;
  }

  placeAtSpawn(p) {
    if (p.core) {
      const a = rand(0, TAU);
      p.x = p.core.x + Math.cos(a) * 90;
      p.y = p.core.y + Math.sin(a) * 90;
      return;
    }
    const W = C.WORLD_SIZE;
    for (let i = 0; i < 60; i++) {
      const x = rand(200, W - 200), y = rand(200, W - 200);
      if (!this.isFree(x, y, p.r + 10)) continue;
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
      if (o.kind === 'res' ? Math.hypot(o.x - x, o.y - y) < o.cr + r : circleHitsRect(x, y, r, o)) return false;
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
      case 'eat': this.eat(p, Number.isInteger(m.slot) ? m.slot : -1); break;
      case 'drop': this.dropFromSlot(p, m.slot | 0, m.n | 0, +m.x, +m.y); break;
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
    this.structures.set(s.id, s);
    this.statics.insert(s);
    if (type === 'core') {
      p.core = s;
      this.msg(p, 'Basis gegründet! Baue Mauern, Türme & Stacheln im Radius.');
    } else {
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
    for (const o of this.statics.query(x, y, half * 1.5 + 70)) {
      if (o.kind === 'res') {
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
    st.speed = Math.max(80, st.speed);
    st.ranged = !!(C.EQUIPMENT[p.equip.weapon] && C.EQUIPMENT[p.equip.weapon].kind === 'bow');
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
    this.events.push([Math.round(z.x), Math.round(z.y), 'hit']);
    if (z.hp > 0) return;
    this.zombies.delete(z.id);
    const def = C.ENEMIES[z.type];
    const killer = this.players.get(attackerId);
    this.dropLoot(z, def.drops);
    if (killer) {
      killer.score += def.score;
      killer.kills++;
      this.lbDirty = true;
    }
    this.events.push([Math.round(z.x), Math.round(z.y), 'die']);
  }

  // Droptable würfeln; Beute fällt verstreut auf den Boden
  dropLoot(z, drops) {
    const mult = this.isNight ? C.DROP_NIGHT_BONUS : 1;
    for (const d of drops || []) {
      if (Math.random() >= d.chance) continue;
      const n = Math.round((d.min + Math.floor(Math.random() * (d.max - d.min + 1))) * mult);
      const a = rand(0, TAU), r = rand(8, z.r + 10);
      this.dropItem(z.x + Math.cos(a) * r, z.y + Math.sin(a) * r, d.item, n);
    }
  }

  damagePlayer(p, dmg) {
    if (p.dead) return;
    p.hp -= dmg * (1 - p.stats.reduction);
    p.lastHurt = this.now;
    this.events.push([Math.round(p.x), Math.round(p.y), 'hurt']);
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
    for (const z of [...this.zombies.values()]) this.updateZombie(z, dt);
    for (const s of [...this.structures.values()]) this.updateStructure(s, dt);
    this.updateProjectiles(dt);
    for (const it of this.items.values()) if (this.now - it.t > C.ITEMS.despawn) this.items.delete(it.id);
    // Nachwachsen (klappt es gerade nicht, wird es später erneut versucht)
    for (const pend of this.resPending) {
      if (this.now >= pend.at && this.spawnResource(pend.type, true)) pend.done = true;
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
    // Eigene Gebäude sind für den Besitzer begehbar (sonst bräuchte man Türen)
    this.collideStatics(p, (s) => s.owner !== p.id);
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

  // Bogen: verbraucht einen Pfeil und schießt in Blickrichtung
  shoot(p) {
    if (Inv.count(p.inv, 'arrow') <= 0) {
      if (this.now - p.ammoMsgT > 2) { p.ammoMsgT = this.now; this.msg(p, 'Keine Pfeile! In der Schmiede herstellen.'); }
      return;
    }
    Inv.remove(p.inv, 'arrow', 1);
    p.swings++;
    const sp = C.ARROW_SPEED, a = p.angle;
    this.projectiles.push({
      x: p.x + Math.cos(a) * (p.r + 10), y: p.y + Math.sin(a) * (p.r + 10),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      dmg: p.stats.damage, life: p.stats.range / sp, owner: p.id, fromPlayer: true,
    });
  }

  collideStatics(e, structFilter, onTouch) {
    for (const o of this.statics.query(e.x, e.y, e.r + 90)) {
      if (o.kind === 'res') pushOutCircle(e, o.x, o.y, o.cr);
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
          const kind = C.RESOURCES[o.type].gives;
          const want = Math.min(tool.gather, o.amount);
          if (!want) continue;
          const got = want - Inv.add(p.inv, kind, want);
          if (!got) {
            if (this.now - p.fullMsgT > 2) { p.fullMsgT = this.now; this.msg(p, 'Inventar voll! [Tab] zum Aufräumen.'); }
            continue;
          }
          p.score += got;
          this.lbDirty = true;
          this.events.push([Math.round(o.x), Math.round(o.y), 'g', got, o.id, kind, p.id]);
          this.depleteResource(o, got);
        }
      } else if (circleHitsRect(hx, hy, hr * 0.6, o)) {
        if (o.owner === p.id) this.repair(p, o);
        else if (C.PVP) this.damageStructure(o, tool.damage * 1.5);
      }
    }
    if (C.PVP) {
      for (const o of this.players.values()) {
        if (o !== p && !o.dead && Math.hypot(o.x - hx, o.y - hy) < hr + o.r) this.damagePlayer(o, tool.damage);
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
    const night = this.isNight, day = this.day;
    for (const p of this.players.values()) {
      if (p.dead || this.zombies.size >= S.maxTotal) continue;
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
    if (attacker && !attacker.dead && this.now < z.angryUntil && dist(z, attacker) < (def.leash || 900)) return attacker;
    if (z.ai === 'neutral') return null;

    // Revier-Tiere halten ihr Ziel bis zur Leine, greifen aber nur in der Nähe an
    if (z.ai === 'territorial' && z.target && z.target.kind === 'p' && !z.target.dead && dist(z, z.target) < def.leash) return z.target;

    const aggro = def.aggro || (night ? C.SPAWN.nightAggro : C.SPAWN.dayAggro);
    let best = null, bestD = Infinity;
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const d = dist(z, p);
      if (d < aggro && d < bestD) { best = p; bestD = d; }
    }
    // Nur Zombies greifen nachts gezielt Basen an, außer ein Spieler steht direkt daneben
    if (z.ai === 'zombie' && night && !(best && bestD < 260)) {
      for (const s of this.structures.values()) {
        if (s.type !== 'core') continue;
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
        this.damagePlayer(z.target, z.dmg);
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
          if (p.id === s.owner || p.dead) continue;
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
          if (p.id !== b.owner && !p.dead && Math.hypot(p.x - b.x, p.y - b.y) < p.r + 5) {
            this.damagePlayer(p, b.dmg);
            hit = true;
            break;
          }
        }
      }
      if (!hit && b.fromPlayer) {
        for (const o of this.statics.query(b.x, b.y, 10)) {
          if (o.kind === 'res' ? Math.hypot(o.x - b.x, o.y - b.y) < o.cr : o.owner !== b.owner && circleHitsRect(b.x, b.y, 3, o)) { hit = true; break; }
        }
      }
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
        pl.push([o.id, Math.round(o.x), Math.round(o.y), +o.angle.toFixed(2), Math.round(o.hp), o.maxHp, o.name, o.swings, this.equipLook(o), o.sprinting ? 1 : 0]);
      }
      for (const z of this.zombies.values()) {
        if (!inView(z)) continue;
        zs.push([z.id, z.type, Math.round(z.x), Math.round(z.y), +z.angle.toFixed(2), Math.round(z.hp), Math.round(z.maxHp), z.attacks, z.target ? 1 : 0]);
      }
      for (const s of this.structures.values()) {
        if (!inView(s, 400)) continue;
        ss.push([s.id, s.type, s.x, s.y, s.level, Math.round(s.hp), s.maxHp, s.owner, +s.angle.toFixed(2)]);
      }
      for (const b of this.projectiles) if (inView(b)) pr.push([Math.round(b.x), Math.round(b.y), +Math.atan2(b.vy, b.vx).toFixed(2)]);
      for (const e of events) if (inView({ x: e[0], y: e[1] })) ev.push(e);
      const core = p.core;
      const msg = {
        t: 's', tm, pl, zs, ss, pr, ev, it,
        me: {
          x: Math.round(p.x), y: Math.round(p.y), hp: Math.round(p.hp), maxHp: p.maxHp,
          res: Inv.totals(p.inv), inv: p.inv.map((s) => (s ? [s.item, s.n] : 0)), eq: p.equip, stats: p.stats, st: Math.round(p.stamina), ex: p.exhausted ? 1 : 0, dead: p.dead, rt: +p.respawnT.toFixed(1), score: p.score, kills: p.kills,
          core: core ? [core.id, core.x, core.y, core.level, lv(core).radius] : null,
          count: p.count, max: core ? lv(core).maxStructures : 0, mines: p.counts.mine || 0,
          forge: p.forge ? [p.forge.id, p.forge.x, p.forge.y, p.forge.level] : null,
        },
      };
      if (lb) { msg.lb = lb; msg.on = this.players.size; }
      if (resUpdate) msg.ru = resUpdate;
      if (sendMinimap) {
        // Gegner im weiten Umkreis als [x, y, feindlich, ...] + alle Spieler als [x, y, ...] (Koordinaten / 10)
        const R = C.MINIMAP_RANGE, e = [], pp = [];
        for (const z of this.zombies.values()) {
          if (Math.abs(z.x - vx) < R && Math.abs(z.y - vy) < R) e.push(Math.round(z.x / 10), Math.round(z.y / 10), z.ai !== 'neutral' || z.target ? 1 : 0);
        }
        for (const o of this.players.values()) if (o !== p && !o.dead) pp.push(Math.round(o.x / 10), Math.round(o.y / 10));
        msg.mm = { e, p: pp };
      }
      p.conn.send(JSON.stringify(msg));
    }
  }
}

module.exports = Game;
