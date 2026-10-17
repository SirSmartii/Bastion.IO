'use strict';
// Gebäude: bauen, prüfen, upgraden, abreißen, reparieren, zerstören – und was Türme, Minen und Öfen jedes Tick tun.

const C = require('../config');
const Inv = require('../inventory');
const { TAU, rand, dist, uid, lookup, levelOf, structureHalfSize } = require('./util');
const { circleHitsRect } = require('./geometry');

module.exports = {
  // ---------- Verwaltung ----------
  //
  // Jedes Gebäude steht in this.structures (nach ID), im statischen Raster (Kollision),
  // in this.structuresByOwner (für Unterhalt, Speichern, Abriss) und Kerne zusätzlich in this.cores.

  // rot: Drehung in 90°-Schritten (0–3)
  createStructure(type, owner, x, y, level = 0, rot = 0) {
    const def = C.STRUCTURES[type], L = def.levels[level], { hw, hh } = structureHalfSize(type, rot);
    const s = {
      id: uid(), kind: 's', type, owner, x, y, hw, hh, rot, br: Math.hypot(hw, hh) + 1,
      level, hp: L.hp, maxHp: L.hp, cd: type === 'mine' ? def.interval : 0, angle: 0,
    };
    if (L.slots) s.items = new Array(L.slots).fill(null); // Truhe, Ofen bzw. Kern-Lager
    if (type === 'core') { s.upkeepT = C.UPKEEP.interval; s.decaying = false; }
    return s;
  },

  addStructure(s) {
    this.structures.set(s.id, s);
    this.statics.insert(s);
    if (s.type === 'core') this.cores.add(s);
    if (!this.structuresByOwner.has(s.owner)) this.structuresByOwner.set(s.owner, new Set());
    this.structuresByOwner.get(s.owner).add(s);
  },

  // Alle Gebäude eines Spielers (auch offline)
  ownedBy(ownerId) {
    return this.structuresByOwner.get(ownerId) || new Set();
  },

  // ---------- Bauen ----------

  // Auf das Raster einrasten: Mittelpunkt, halbe Breite & Höhe
  snap(type, x, y, rot = 0) {
    const T = C.TILE, { hw, hh } = structureHalfSize(type, rot);
    return { x: Math.round((x - hw) / T) * T + hw, y: Math.round((y - hh) / T) * T + hh, hw, hh };
  },

  build(p, type, wx, wy, rot = 0) {
    const def = lookup(C.STRUCTURES, type);
    if (!def || p.dead || !Number.isFinite(wx) || !Number.isFinite(wy)) return;
    rot = (rot | 0) & 3;
    const { x, y, hw, hh } = this.snap(type, wx, wy, rot);
    const err = this.placementError(p, type, x, y, hw, hh);
    if (err) return this.msg(p, err);

    Inv.pay(p.inv, def.levels[0].cost);
    const s = this.createStructure(type, p.id, x, y, 0, rot);
    if (type === 'core') {
      // Das Unterhalts-Lager startet mit etwas Vorrat
      for (const [item, n] of Object.entries(C.UPKEEP.startStock)) Inv.add(s.items, item, n);
    }
    this.addStructure(s);

    if (type === 'core') {
      p.core = s;
      this.msg(p, 'Basis gegründet! Baue Mauern, Türme & Stacheln im Radius.');
      return;
    }
    this.addXp(p, C.XP.build);
    if (!def.anywhere) p.count++; // zählt nicht zum Gebäude-Limit der Basis
    p.counts[type] = (p.counts[type] || 0) + 1;
    if (type === 'forge') {
      p.forge = s;
      this.msg(p, 'Schmiede gebaut! Stell dich daneben und drücke [F].');
    }
    if (type === 'furnace') this.msg(p, 'Schmelzofen gebaut! Lege Erz und Kohle hinein [F].');
    if (type === 'tanner') this.msg(p, 'Gerbgestell gebaut! Lege Fell hinein [F] – daraus wird Leder.');
    if (type === 'sleeping_bag') this.msg(p, 'Schlafsack gelegt! Nach dem Tod kannst du hier aufwachen.');
    if (type === 'campfire') this.msg(p, 'Lagerfeuer gebaut! Lege Holz und Rohes (Fleisch, Kartoffeln, Mais) hinein [F].');
  },

  // Grund, warum hier nicht gebaut werden kann – oder null
  placementError(p, type, x, y, hw, hh) {
    const def = C.STRUCTURES[type], W = C.WORLD_SIZE;
    if (x - hw < 0 || y - hh < 0 || x + hw > W || y + hh > W) return 'Außerhalb der Welt.';
    if (Math.hypot(x - p.x, y - p.y) > C.PLAYER.buildRange) return 'Zu weit entfernt.';
    if (type === 'core') {
      if (p.core) return 'Du hast bereits einen Basis-Kern.';
      for (const core of this.cores) {
        if (Math.hypot(core.x - x, core.y - y) < levelOf(core).radius + 400) return 'Zu nah an einer anderen Basis.';
      }
    } else if (def.anywhere) {
      // Lagerfeuer & Co.: ohne Basis, nicht in fremden Basen
      if (def.limit && (p.counts[type] || 0) >= def.limit) return `Maximal ${def.limit}× ${def.name}.`;
      for (const core of this.cores) {
        if (!this.allied(p, core.owner) && Math.hypot(core.x - x, core.y - y) < levelOf(core).radius) return 'Nicht in fremden Basen.';
      }
    } else {
      if (!p.core) return 'Baue zuerst deinen Basis-Kern (Baumenü [B]).';
      if (Math.hypot(x - p.core.x, y - p.core.y) > levelOf(p.core).radius) return 'Nur innerhalb deines Basis-Radius.';
      if (p.count >= levelOf(p.core).maxStructures) return 'Gebäude-Limit erreicht – Kern upgraden!';
      if (def.limit && (p.counts[type] || 0) >= def.limit) return `Maximal ${def.limit}× ${def.name}.`;
    }
    if (!Inv.canAfford(p.inv, def.levels[0].cost)) return 'Nicht genug Ressourcen im Inventar.';
    if (this.cityAt(x, y, C.MAP.noBuildMargin + Math.max(hw, hh))) return 'In Städten kann nicht gebaut werden.';

    const box = { x, y, hw: hw - 1, hh: hh - 1 };
    for (const o of this.statics.query(x, y, Math.max(Math.max(hw, hh) * 1.5 + 70, 400))) {
      const blocked = o.cr !== undefined
        ? circleHitsRect(o.x, o.y, o.cr, box)
        : Math.abs(o.x - x) < o.hw + hw - 1 && Math.abs(o.y - y) < o.hh + hh - 1;
      if (blocked) return 'Platz ist blockiert.';
    }
    for (const z of this.zgrid.query(x, y, Math.max(hw, hh) + 60)) {
      if (this.zombies.has(z.id) && circleHitsRect(z.x, z.y, z.r, box)) return 'Ein Zombie steht im Weg.';
    }
    for (const o of this.players.values()) {
      if (!o.dead && o.id !== p.id && circleHitsRect(o.x, o.y, o.r, box)) return 'Ein Spieler steht im Weg.';
    }
    return null;
  },

  upgrade(p, id) {
    const s = this.structures.get(id);
    if (!s || s.owner !== p.id) return;
    const levels = C.STRUCTURES[s.type].levels;
    if (s.level + 1 >= levels.length) return this.msg(p, 'Maximales Level erreicht.');
    if (s.type !== 'core' && (!p.core || s.level + 1 > p.core.level)) return this.msg(p, 'Upgrade zuerst deinen Basis-Kern.');
    const next = levels[s.level + 1];
    if (!Inv.canAfford(p.inv, next.cost)) return this.msg(p, 'Nicht genug Ressourcen im Inventar.');
    Inv.pay(p.inv, next.cost);
    s.level++;
    s.maxHp = next.hp;
    s.hp = next.hp;
    if (s.items) while (s.items.length < next.slots) s.items.push(null); // größeres Lager
    this.events.push([s.x, s.y, 'up']);
  },

  // Abreißen gibt die Hälfte der Baukosten zurück (außer beim Kern – der nimmt die ganze Basis mit)
  demolish(p, id) {
    const s = this.structures.get(id);
    if (!s || s.owner !== p.id) return;
    if (s.type !== 'core') {
      for (const [item, n] of Object.entries(C.STRUCTURES[s.type].levels[0].cost)) this.give(p, item, Math.floor(n / 2), s.x, s.y);
    }
    this.destroyStructure(s);
  },

  // Eigene Gebäude (und die des Teams) mit der Waffe schlagen = reparieren, kostet Holz
  repair(p, s) {
    if (s.hp >= s.maxHp) return;
    const cost = 2 + s.level * 2;
    if (Inv.count(p.inv, 'wood') < cost) return this.msg(p, `Reparieren kostet ${cost} Holz.`);
    Inv.remove(p.inv, 'wood', cost);
    s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.1);
    this.events.push([s.x, s.y, 'fix']);
  },

  damageStructure(s, dmg) {
    if (!this.structures.has(s.id)) return;
    s.hp -= dmg;
    s.lastHit = this.now;
    if (s.hp <= 0) this.destroyStructure(s);
  },

  // Gebäude entfernen. Lagerinhalt fällt auf den Boden; ein Kern reißt die ganze Basis mit.
  destroyStructure(s) {
    if (!this.structures.has(s.id)) return;
    this.structures.delete(s.id);
    this.statics.remove(s);
    this.cores.delete(s);
    this.ownedBy(s.owner).delete(s);
    this.events.push([s.x, s.y, 'boom']);

    for (const it of s.items || []) {
      if (!it) continue;
      const a = rand(0, TAU), d = rand(5, Math.max(s.hw, s.hh) + 15);
      this.dropItem(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, it.item, it.n, 0, it.d);
    }

    const owner = this.players.get(s.owner);
    if (s.type === 'core') {
      // Die ganze Basis fällt mit – Schlafsäcke und Lagerfeuer draußen (anywhere) bleiben stehen
      for (const o of [...this.ownedBy(s.owner)]) if (!C.STRUCTURES[o.type].anywhere) this.destroyStructure(o);
      if (!this.ownedBy(s.owner).size) this.structuresByOwner.delete(s.owner);
      if (owner) {
        owner.core = null;
        owner.forge = null;
        owner.count = 0;
        this.msg(owner, 'Dein Basis-Kern wurde zerstört! Baue einen neuen.');
      }
    } else if (owner) {
      if (!C.STRUCTURES[s.type].anywhere) owner.count--;
      owner.counts[s.type]--;
      if (s.type === 'forge') owner.forge = null;
    }
  },

  // ---------- Pro Tick ----------

  updateStructure(s, dt) {
    if (s.type === 'turret') this.updateTurret(s, dt);
    else if (s.type === 'mine') this.updateMine(s, dt);
    else if (C.STRUCTURES[s.type].modes) this.updateProcessor(s, dt); // Schmelzofen, Gerbgestell
    else if (s.type === 'campfire') this.updateCampfire(s, dt);
  },

  // Turm: zielt auf den nächsten sichtbaren Gegner (er schaut über Mauern, aber nicht durch Bäume) (bei PvP auch auf fremde Spieler) und schießt.
  // Das Ziel wird 4× pro Sekunde neu gewählt; dazwischen wird nur nachgeführt.
  updateTurret(s, dt) {
    const L = levelOf(s);
    s.cd -= dt;
    s.retarget = (s.retarget || 0) - dt;
    let target = s.target;
    const gone = target && (target.kind === 'z' ? !this.zombies.has(target.id) : target.dead || !this.players.has(target.id));
    if (gone || s.retarget <= 0) {
      s.retarget = 0.25;
      s.target = target = this.findTurretTarget(s, L.range);
    }
    if (!target || dist(s, target) > L.range) return;
    s.angle = Math.atan2(target.y - s.y, target.x - s.x);
    if (s.cd > 0) return;
    s.cd = 1 / L.rate;
    const speed = 900;
    this.projectiles.push({
      x: s.x + Math.cos(s.angle) * 22, y: s.y + Math.sin(s.angle) * 22,
      vx: Math.cos(s.angle) * speed, vy: Math.sin(s.angle) * speed,
      dmg: L.dmg, life: L.range / speed + 0.15, owner: s.owner,
    });
  },

  findTurretTarget(s, range) {
    const candidates = [];
    for (const z of this.zgrid.query(s.x, s.y, range)) if (this.zombies.has(z.id)) candidates.push(z);
    if (C.PVP) for (const p of this.players.values()) if (!p.dead && !this.allied(p, s.owner)) candidates.push(p);
    let target = null, bestD = range;
    for (const e of candidates) {
      const d = dist(s, e);
      if (d < bestD && this.seesBody(s.x, s.y, e, true)) { target = e; bestD = d; }
    }
    return target;
  },

  // Mine: fördert regelmäßig; bei vollem Inventar stapelt sich der Ertrag neben der Mine.
  // Offline-Besitzer bekommen nichts.
  updateMine(s, dt) {
    s.cd -= dt;
    if (s.cd > 0) return;
    s.cd = C.STRUCTURES.mine.interval;
    const owner = this.players.get(s.owner);
    if (!owner) return;
    const income = levelOf(s).income;
    for (const [item, n] of Object.entries(income)) this.give(owner, item, n, s.x, s.y + s.hh + 15);
    this.events.push([s.x, s.y, 'mine', income.gold, s.owner]);
  },
};
