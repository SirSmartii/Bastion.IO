'use strict';
// Welt aufbauen, Ressourcen (Bäume, Steine, Erze) und Plünderbares (Kisten, Regale, Autowracks …) setzen,
// abbauen und nachwachsen lassen.

const C = require('../config');
const { generateWorld } = require('../world');
const { rand, uid, levelOf } = require('./util');
const { circleHitsStatic } = require('./geometry');

module.exports = {
  // Gelände erzeugen und Seen, Ruinen, Kisten und Ressourcen ins statische Raster eintragen
  genWorld() {
    // Mit Datenbank bleibt die Welt über Neustarts gleich (gespeicherte Basen passen dann zum Gelände)
    const seed = C.MAP.seed || (this.db && +this.db.getMeta('seed')) || Math.floor(Math.random() * 2 ** 31);
    if (this.db) this.db.setMeta('seed', seed);
    this.world = generateWorld(seed);

    for (const [x, y, r] of this.world.lakes) this.statics.insert({ kind: 'water', x, y, r, cr: r, br: r });
    const half = C.TILE / 2;
    for (const city of this.world.cities) {
      for (const [x, y] of city.ruins) this.statics.insert({ kind: 'ruin', x, y, hw: half, hh: half, br: half * 1.42 });
      for (const [x, y, type, angle] of city.crates) this.spawnResource(type, false, { x, y, angle });
    }
    // Steine, Erze & Pflanzen zunächst für einen leeren Server; mit Spielern wächst die Menge (balanceResources).
    // Bäume zuerst (dichter Wald), danach seltene Arten, damit sie in den knappen Felsgebieten noch Platz finden.
    const first = (t) => (C.RESOURCE_SCALE.exclude.includes(t) ? 0 : 1);
    const order = Object.keys(C.RESOURCES).sort((a, b) => first(a) - first(b) || C.RESOURCES[a].count - C.RESOURCES[b].count);
    for (const type of order) {
      for (let i = 0; i < this.resourceTarget(type); i++) this.spawnResource(type, false);
    }
  },

  cityAt(x, y, margin = 0) {
    return this.world.cities.find((c) => Math.hypot(c.x - x, c.y - y) < c.r + margin) || null;
  },

  // Steht an (x, y) mit Radius r nichts Festes (Ressource, See, Ruine, Gebäude)? Begehbares (Büsche, Gemüse) zählt nicht.
  isFree(x, y, r) {
    return !this.statics.query(x, y, r + 100).some((o) => o.cr !== 0 && circleHitsStatic(o, x, y, r));
  },

  // Neue Ressource an freier Stelle (oder genau an pos = { x, y, angle }).
  // respawn = true: Nachwachsen – nicht neben Spielern oder in Basen, und an alle Clients melden.
  spawnResource(type, respawn, pos) {
    const def = C.RESOURCES[type], W = C.WORLD_SIZE;
    const maxWeight = def.biomes ? Math.max(...Object.values(def.biomes)) : 1;
    for (let tries = 0; tries < (pos ? 1 : 150); tries++) {
      const r = rand(def.minR, def.maxR);
      const x = pos ? pos.x : rand(r + 80, W - r - 80);
      const y = pos ? pos.y : rand(r + 80, W - r - 80);
      if (!pos && !this.goodResourceSpot(type, def, maxWeight, x, y, r)) continue;
      if (respawn && this.nearPlayerOrBase(x, y)) continue;

      const amount = Math.round(rand(def.amount[0], def.amount[1]));
      const res = { id: uid(), kind: 'res', type, x, y, r, baseR: r, cr: r * def.solid, br: r, amount, maxAmount: amount };
      if (pos && pos.angle) res.angle = pos.angle; // Autowracks stehen schräg
      this.resources.push(res);
      this.statics.insert(res);
      if (respawn) this.resAdded.push(res);
      return res;
    }
    return null;
  },

  goodResourceSpot(type, def, maxWeight, x, y, r) {
    const biome = this.world.biomeAt(x, y);
    // Das Biom bestimmt die Wahrscheinlichkeit (Bäume im Wald, Steine & Gold im Fels …)
    if (def.biomes && Math.random() * maxWeight > (def.biomes[biome] || 0)) return false;
    if (this.cityAt(x, y, 60)) return false;
    // Im Wald stehen Bäume dicht (Kronen dürfen sich überlappen), sonst mit Abstand
    const gap = type === 'tree' && biome === 'forest' ? 12 : 50;
    return !this.statics.query(x, y, r + 120).some((o) => (o.kind === 'res'
      ? Math.hypot(o.x - x, o.y - y) < o.br + r + gap
      : circleHitsStatic(o, x, y, r + 30)));
  },

  nearPlayerOrBase(x, y) {
    for (const p of this.players.values()) if (Math.hypot(p.x - x, p.y - y) < 700) return true;
    for (const core of this.cores) if (Math.hypot(core.x - x, core.y - y) < levelOf(core).radius + 100) return true;
    return false;
  },

  // n Einheiten abbauen. Die Ressource schrumpft mit dem Vorrat; leer zerfällt sie
  // (mit Abbau-Bonus bzw. Kistenbeute) und wächst später woanders nach.
  depleteResource(o, n, p) {
    o.amount -= n;
    const def = C.RESOURCES[o.type];
    if (o.amount > 0) {
      const frac = o.amount / o.maxAmount;
      // Pflanzen behalten ihre Größe (sie tragen nur weniger Früchte), alles andere schrumpft
      if (!def.pick) o.r = o.baseR * (C.RESOURCE_MIN_SCALE + (1 - C.RESOURCE_MIN_SCALE) * frac);
      o.cr = o.r * def.solid;
      this.resChanged.set(o.id, +frac.toFixed(3));
      return;
    }
    if (def.loot) {
      this.dropLoot(o, def.loot, 1);
      // Übung im Plündern: Chance auf eine zweite Beute-Runde
      if (p && Math.random() < this.practiceBonus(p, 'lootTwice') + p.stats.lootBonus) this.dropLoot(o, def.loot, 1);
      if (p) this.addPractice(p, 'looting', 3);
    }
    if (p) this.addXp(p, def.loot ? C.XP.crate : C.XP.deplete);
    if (p && def.bonus) {
      for (const [item, k] of Object.entries(def.bonus)) this.give(p, item, k, o.x, o.y);
      this.events.push([Math.round(o.x), Math.round(o.y), 'bonus', 0, def.bonus, p.id]);
    }
    this.statics.remove(o);
    this.resources.splice(this.resources.indexOf(o), 1);
    this.resChanged.delete(o.id);
    this.resRemoved.push(o.id);
    // Kisten & Co. kommen an derselben Stelle wieder, alles andere wächst woanders nach
    this.resPending.push({ type: o.type, at: this.now + def.respawn, pos: def.loot ? { x: o.x, y: o.y, angle: o.angle } : null });
    this.events.push([Math.round(o.x), Math.round(o.y), 'deplete', 0, o.type]);
  },

  // Fällige Ressourcen nachwachsen lassen (ist gerade kein Platz, in 5 s erneut) und die Menge an die Spielerzahl anpassen
  updateResources(dt) {
    this.resBalanceT = (this.resBalanceT || 0) - dt;
    if (this.resBalanceT <= 0) {
      this.resBalanceT = C.RESOURCE_SCALE.interval;
      this.balanceResources();
    }
    for (const pending of this.resPending) {
      if (this.now < pending.at) continue;
      if (this.spawnResource(pending.type, true, pending.pos)) pending.done = true;
      else pending.at = this.now + 5;
    }
    this.resPending = this.resPending.filter((pending) => !pending.done);
  },

  // ---------- Menge nach Spielerzahl ----------
  //
  // Steine, Erze und Pflanzen gibt es so viele, wie zur Zahl der Spieler passt (RESOURCE_SCALE): count ×
  // Faktor. Bäume und Kisten bleiben fest. Alle interval Sekunden wird schrittweise (step) nachgefüllt (wie
  // Nachwachsen: nicht neben Spielern) oder abgebaut – dann nur unberührte Ressourcen außer Sicht.

  resourceFactor() {
    const S = C.RESOURCE_SCALE, n = [...this.players.values()].length;
    return Math.min(S.max, S.base + S.perPlayer * n);
  },

  scalesWithPlayers(type) {
    const def = C.RESOURCES[type];
    return !def.loot && def.count > 0 && !C.RESOURCE_SCALE.exclude.includes(type);
  },

  // Gewünschte Anzahl einer Ressource gerade jetzt
  resourceTarget(type) {
    const def = C.RESOURCES[type];
    return this.scalesWithPlayers(type) ? Math.round(def.count * this.resourceFactor()) : def.count;
  },

  balanceResources() {
    const S = C.RESOURCE_SCALE;
    const have = {};
    for (const r of this.resources) have[r.type] = (have[r.type] || 0) + 1;
    for (const p of this.resPending) have[p.type] = (have[p.type] || 0) + 1; // wächst schon nach
    for (const type of Object.keys(C.RESOURCES)) {
      if (!this.scalesWithPlayers(type)) continue;
      const target = this.resourceTarget(type), step = Math.max(2, Math.ceil(target * S.step));
      let diff = target - (have[type] || 0);
      // Zu wenige: nachfüllen (ein Platz findet sich nicht immer – dann mehr Versuche, höchstens 4 × step)
      for (let added = 0, tries = 0; diff > 0 && added < step && tries < step * 4; tries++) {
        if (this.spawnResource(type, true)) { added++; diff--; }
      }
      if (diff >= 0) continue;
      // Zu viele: erst Nachwachsendes streichen, dann unberührte Ressourcen weit weg von allen Spielern
      for (let i = this.resPending.length - 1; i >= 0 && diff < 0; i--) {
        if (this.resPending[i].type === type) { this.resPending.splice(i, 1); diff++; }
      }
      let removed = 0;
      for (const r of [...this.resources]) {
        if (diff >= 0 || removed >= step) break;
        if (r.type !== type || r.amount < r.maxAmount || this.nearPlayerOrBase(r.x, r.y) || this.inAnyView(r.x, r.y)) continue;
        this.statics.remove(r);
        this.resources.splice(this.resources.indexOf(r), 1);
        this.resChanged.delete(r.id);
        this.resRemoved.push(r.id);
        diff++;
        removed++;
      }
    }
  },

  // Format für den Client: [id, Typ, x, y, Grundradius, Restanteil, Winkel (nur wenn schräg)]
  resWire(r) {
    const wire = [r.id, r.type, Math.round(r.x), Math.round(r.y), Math.round(r.baseR), +(r.amount / r.maxAmount).toFixed(3)];
    if (r.angle) wire.push(r.angle);
    return wire;
  },
};
