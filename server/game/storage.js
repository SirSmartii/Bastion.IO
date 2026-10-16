'use strict';
// Behälter (Truhen, Schmelzöfen und das Lager im Basis-Kern) sowie Unterhalt & Verfall der Basen.

const C = require('../config');
const Inv = require('../inventory');
const { levelOf } = require('./util');

const CONTAINER_NAMES = { core: 'Dieser Kern', storage: 'Diese Truhe', furnace: 'Dieser Ofen', campfire: 'Dieses Lagerfeuer' };
const REFUSED = {
  core: 'Ins Kern-Lager gehören nur Holz, Stein und Gold für den Unterhalt.',
  furnace: 'In den Schmelzofen gehören nur Eisenerz, Kohle und Eisenbarren.',
  campfire: 'Ins Lagerfeuer gehören nur Holz und was man braten kann (Fleisch, Kartoffeln, Mais).',
};

module.exports = {
  // ---------- Behälter ----------
  // Truhen, Öfen und Kern-Lager funktionieren gleich: Gebäude mit items. Nutzen dürfen Besitzer und Team.

  canUseChest(p, s) {
    return !!s && !!s.items && !p.dead && this.structures.has(s.id) && this.allied(p, s.owner) &&
      Math.hypot(s.x - p.x, s.y - p.y) <= C.STRUCTURES[s.type].useRange + 40;
  },

  openChest(p, id) {
    const s = this.structures.get(id);
    if (!s || !s.items) return;
    const what = CONTAINER_NAMES[s.type] || 'Dieser Behälter';
    if (!this.allied(p, s.owner)) return this.msg(p, `${what} gehört nicht dir oder deinem Team.`);
    if (!this.canUseChest(p, s)) return this.msg(p, 'Geh näher heran.');
    p.chest = s.id;
  },

  // Verschieben zwischen Inventar (Behälter 0) und offenem Behälter (1).
  // m: { fc: von-Behälter, from: Slot, tc: nach-Behälter, to: Slot, n: Anzahl } oder { fc, from, quick: 1 } (ganzer Stapel rüber)
  chestMove(p, m) {
    const s = this.structures.get(p.chest);
    if (!this.canUseChest(p, s)) { p.chest = 0; return; }
    const fromBox = m.fc ? 1 : 0, toBox = m.quick ? 1 - fromBox : m.tc ? 1 : 0;
    const container = (box) => (box ? s.items : p.inv);
    const src = container(fromBox), dst = container(toBox), from = m.from | 0, to = m.to | 0;
    const stack = src[from];
    if (from < 0 || from >= src.length || !stack) return;

    // Ins Kern-Lager passen nur Unterhalts-Ressourcen, in den Ofen nur Erz, Kohle und Barren (auch nicht durch Tauschen)
    const allowed = this.containerAccepts(s);
    const fits = (box, item) => box === 0 || !allowed || allowed.includes(item);
    const swappedBack = !m.quick && dst[to] && dst[to].item !== stack.item ? dst[to].item : null;
    if (!fits(toBox, stack.item) || (swappedBack && !fits(fromBox, swappedBack))) {
      return this.msg(p, REFUSED[s.type] || 'Das passt hier nicht hinein.');
    }
    if (m.quick) Inv.quickMove(src, from, dst);
    else Inv.transfer(src, from, dst, to, m.n | 0);

    // Verfallende Basis: frischer Vorrat wird sofort genutzt
    if (s.type === 'core' && s.decaying && this.payUpkeep(s)) s.upkeepT = C.UPKEEP.interval;
  },

  // Welche Items in den Behälter passen (null = alle)
  containerAccepts(s) {
    if (s.type === 'core') return C.UPKEEP.items;
    return C.STRUCTURES[s.type].accepts || null;
  },

  // ---------- Schmelzofen ----------
  //
  // Liegen genug Erz und Kohle im Ofen (smelt.cost), brennt er: nach time Sekunden (je nach Level)
  // werden sie verbraucht und ein Barren (smelt.out) liegt im Ofen. Ohne Material oder Platz geht er aus.

  updateFurnace(s, dt) {
    const { cost, out } = C.STRUCTURES.furnace.smelt;
    const canSmelt = Inv.canAfford(s.items, cost) && Inv.space(s.items, out) > 0;
    s.active = canSmelt;
    if (!canSmelt) { s.smeltT = 0; return; }
    s.smeltT = (s.smeltT || 0) + dt;
    const time = levelOf(s).time;
    if (s.smeltT < time) return;
    s.smeltT -= time;
    Inv.pay(s.items, cost);
    Inv.add(s.items, out, 1);
    const owner = this.players.get(s.owner);
    if (owner) this.addXp(owner, C.XP.smelt);
  },

  // Für die Anzeige: { a: brennt, p: Fortschritt 0..1, t: Sekunden pro Barren, n: wie viele Barren das Material noch ergibt }
  furnaceInfo(s) {
    const { cost } = C.STRUCTURES.furnace.smelt, time = levelOf(s).time;
    let bars = Infinity;
    for (const [item, k] of Object.entries(cost)) bars = Math.min(bars, Math.floor(Inv.count(s.items, item) / k));
    return { a: s.active ? 1 : 0, p: Math.round(Math.min(1, (s.smeltT || 0) / time) * 20) / 20, t: time, n: bars };
  },

  // ---------- Lagerfeuer ----------
  //
  // Brennt, solange Brennstoff da ist: alle burnTime Sekunden wird 1 Holz verbraucht. Während es brennt,
  // wird alle time Sekunden ein rohes Stück (cook) gar – sofern Platz für das Ergebnis ist.

  updateCampfire(s, dt) {
    const def = C.STRUCTURES.campfire;
    s.fuelT = (s.fuelT || 0) - dt;
    if (s.fuelT <= 0) {
      if (Inv.count(s.items, def.fuel) > 0) { Inv.remove(s.items, def.fuel, 1); s.fuelT += def.burnTime; } else s.fuelT = 0;
    }
    s.active = s.fuelT > 0;
    const raw = s.active ? this.nextCookable(s) : null;
    if (!raw) { s.cookT = 0; return; }
    s.cookT = (s.cookT || 0) + dt;
    const time = levelOf(s).time;
    if (s.cookT < time) return;
    s.cookT -= time;
    Inv.remove(s.items, raw, 1);
    Inv.add(s.items, def.cook[raw], 1);
  },

  // Erstes rohes Item, dessen gares Gegenstück noch hineinpasst
  nextCookable(s) {
    const cook = C.STRUCTURES.campfire.cook;
    for (const it of s.items) if (it && cook[it.item] && Inv.space(s.items, cook[it.item]) > 0) return it.item;
    return null;
  },

  // Für die Anzeige: { a: brennt, p: Fortschritt 0..1, t: Sekunden pro Stück, n: rohe Stücke, f: Sekunden Brennstoff }
  campfireInfo(s) {
    const def = C.STRUCTURES.campfire;
    let raw = 0;
    for (const it of s.items) if (it && def.cook[it.item]) raw += it.n;
    const time = levelOf(s).time;
    return {
      a: s.active ? 1 : 0, p: Math.round(Math.min(1, (s.cookT || 0) / time) * 20) / 20, t: time, n: raw,
      f: Math.ceil((s.fuelT || 0) + Inv.count(s.items, def.fuel) * def.burnTime),
    };
  },

  // ---------- Unterhalt & Verfall ----------
  //
  // Alle UPKEEP.interval Sekunden zahlt jede Basis aus ihrem Kern-Lager und wird dabei repariert.
  // Reicht der Vorrat nicht, verfällt sie: jedes Gebäude verliert laufend HP, bis wieder bezahlt wird.

  // Kosten einer Zahlung: pro Gebäude cost[Level], der Kern zählt coreMult-fach
  upkeepCost(ownerId) {
    const U = C.UPKEEP, cost = {};
    for (const s of this.ownedBy(ownerId)) {
      const k = s.type === 'core' ? U.coreMult : 1;
      for (const [item, n] of Object.entries(U.cost[s.level])) cost[item] = (cost[item] || 0) + n * k;
    }
    return cost;
  },

  // Zahlt aus dem Kern-Lager. Erfolg: Basis wird repariert. Sonst: Basis verfällt bis zur nächsten Zahlung.
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
    for (const s of this.ownedBy(core.owner)) s.hp = Math.min(s.maxHp, s.hp + s.maxHp * C.UPKEEP.repair);
    return true;
  },

  updateUpkeep(dt) {
    const U = C.UPKEEP;
    // Kosten für die Anzeige einmal pro Sekunde auffrischen
    this.upkeepDisplayT -= dt;
    const refresh = this.upkeepDisplayT <= 0;
    if (refresh) this.upkeepDisplayT = 1;

    for (const core of [...this.cores]) {
      if (refresh) core.upCost = this.upkeepCost(core.owner);
      core.upkeepT -= dt;
      if (core.upkeepT <= 0) {
        core.upkeepT += U.interval;
        this.payUpkeep(core);
      }
      if (core.decaying) this.decayBase(core.owner, dt);
    }
  },

  decayBase(ownerId, dt) {
    const loss = (C.UPKEEP.decay / 60) * dt; // Anteil der max. HP pro Sekunde
    for (const s of [...this.ownedBy(ownerId)]) {
      if (!this.structures.has(s.id)) continue; // schon mit dem Kern verschwunden
      s.hp -= s.maxHp * loss;
      if (s.hp <= 0) this.destroyStructure(s);
    }
  },

  // Für die Anzeige: { c: Kosten, t: Sekunden bis zur Zahlung, n: wie viele Zahlungen der Vorrat deckt, d: verfällt }
  upkeepInfo(core) {
    const cost = core.upCost || this.upkeepCost(core.owner);
    let payments = 999;
    for (const [item, k] of Object.entries(cost)) if (k > 0) payments = Math.min(payments, Math.floor(Inv.count(core.items, item) / k));
    return { c: cost, t: Math.max(0, Math.ceil(core.upkeepT)), n: payments, d: core.decaying ? 1 : 0 };
  },
};
