'use strict';
// Ausrüstung als Einzelstücke: Seltenheit, zufällige Boni & Flüche, Verbessern (+1 … +5), Umschmieden und Zerlegen.
//
// Ein Ausrüstungsteil liegt im Inventar als { item, n: 1, d } (getragen: p.equip[slot] = item, p.gear[slot] = d).
// d = { r: Seltenheit 0–4, u: Stufe 0–5, m: [[Bonus-ID, Wert], …], c: [Fluch-ID, Wert] oder fehlt, f: wie oft umgeschmiedet }
// Fehlt d, ist das Teil gewöhnlich und unverbessert (z. B. die Startaxt oder alte Spielstände).
// Werte: Boni mit pct sind Prozentpunkte (12 = +12 %), sonst feste Zahlen. Siehe GEAR, MODS und CURSES in der Config.

const C = require('../config');
const Inv = require('../inventory');
const { rand, lookup } = require('./util');

const gearSlot = (def) => (def.slot === 'weapon' ? 'weapon' : 'armor');
const isTool = (def) => def.kind === 'axe' || def.kind === 'pick';

// Welche Boni bzw. Flüche zu einem Teil passen
function pool(table, def) {
  return Object.keys(table).filter((id) => table[id].slots.includes(gearSlot(def)) && (!table[id].tool || isTool(def)));
}

// Wert eines Bonus würfeln; k verstärkt ihn (verfluchte Teile)
function rollValue(mod, k = 1) {
  const v = rand(mod.range[0], mod.range[1]) * k, step = mod.step || 1;
  return +(Math.round(v / step) * step).toFixed(2);
}

function weightedIndex(weights) {
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) if ((roll -= weights[i]) < 0) return i;
  return 0;
}

function pickNew(ids, taken) {
  const free = ids.filter((id) => !taken.includes(id));
  return free.length ? free[Math.floor(Math.random() * free.length)] : null;
}

// Kosten für Verbessern auf +target; Stahl-Ausrüstung und besser braucht Stahl statt Eisen (GEAR.steelFrom)
function upgradeCost(item, target) {
  const cost = { ...C.GEAR.upgrade[target - 1].cost }, def = C.EQUIPMENT[item];
  if (def && (def.tier || 0) >= C.GEAR.steelFrom && cost.iron) { cost.steel = cost.iron; delete cost.iron; }
  return cost;
}

module.exports = {
  // Neues Teil auswürfeln. source: 'craft' | 'loot' | 'boss'. Ergebnis: d oder null (gewöhnlich)
  rollGear(item, source, p = null) {
    const def = lookup(C.EQUIPMENT, item), G = C.GEAR;
    if (!def || def.noRoll) return null; // Verbrauchsteile (Fackel, Angel, Rucksack) ohne Seltenheit
    let r = weightedIndex(G.sources[source] || G.sources.loot);
    // Übung im Schmieden: manchmal eine Seltenheit besser (höchstens bis Selten)
    if (p && source === 'craft' && r < 2 && Math.random() < this.practiceBonus(p, 'smithLuck')) r++;
    if (!r) return null;
    const rarity = G.rarities[r], d = { r, u: 0, m: [] };
    const cursed = Math.random() < rarity.curse;
    const ids = pool(C.MODS, def);
    for (let i = 0; i < rarity.mods; i++) {
      const id = pickNew(ids, d.m.map((m) => m[0]));
      if (id) d.m.push([id, rollValue(C.MODS[id], cursed ? G.curseBoost : 1)]);
    }
    if (cursed) {
      const id = pickNew(pool(C.CURSES, def), []);
      if (id) d.c = [id, rollValue(C.CURSES[id])];
    }
    return d;
  },

  // Gespeicherte / fremde Daten prüfen (Speicherstände können von älteren Configs stammen)
  cleanGear(item, d) {
    const def = lookup(C.EQUIPMENT, item);
    if (!def || !d || typeof d !== 'object') return null;
    const int = (v, max) => Math.max(0, Math.min(max, Number.isFinite(+v) ? +v | 0 : 0));
    const out = { r: int(d.r, C.GEAR.rarities.length - 1), u: int(d.u, C.GEAR.upgrade.length), m: [] };
    const valid = (table, e) => Array.isArray(e) && lookup(table, e[0]) && Number.isFinite(+e[1]) && table[e[0]].slots.includes(gearSlot(def));
    for (const e of Array.isArray(d.m) ? d.m.slice(0, 4) : []) if (valid(C.MODS, e)) out.m.push([e[0], +e[1]]);
    if (valid(C.CURSES, d.c)) out.c = [d.c[0], +d.c[1]];
    if (d.f > 0) out.f = int(d.f, 99);
    return out.r || out.u || out.m.length || out.c ? out : null;
  },

  // Summe aller Boni und Flüche der getragenen Ausrüstung: { dmgPct: 12, armor: -3, … }
  gearMods(p) {
    const sum = {};
    for (const d of Object.values(p.gear)) {
      if (!d) continue;
      for (const [id, v] of d.m) sum[C.MODS[id].stat] = (sum[C.MODS[id].stat] || 0) + v;
      if (d.c) sum[C.CURSES[d.c[0]].stat] = (sum[C.CURSES[d.c[0]].stat] || 0) + d.c[1];
    }
    return sum;
  },

  // Faktor auf den Hauptwert durch die Verbesserungsstufe
  upgradeFactor(d) {
    return 1 + C.GEAR.upgradeBonus * (d ? d.u : 0);
  },

  // Ausrüstungsteil ins Inventar (oder vor die Füße) legen
  giveGear(p, item, d) {
    if (Inv.add(p.inv, item, 1, d || undefined) > 0) this.dropItem(p.x, p.y, item, 1, 0, d);
  },

  // ---------- An der Schmiede ----------

  atForge(p) {
    const forge = p.forge;
    return !!forge && !p.dead && Math.hypot(forge.x - p.x, forge.y - p.y) <= C.STRUCTURES.forge.useRange;
  },

  // Teil, auf das sich eine Schmiede-Aktion bezieht: { src: 'inv', i: Slot } oder { src: 'eq', i: Ausrüstungs-Slot }
  gearRef(p, src, i) {
    if (src === 'eq') {
      const slot = C.EQUIP_SLOTS.find((s) => s.id === i);
      const item = slot && p.equip[slot.id];
      if (!item || C.EQUIPMENT[item].noRoll) return null;
      return {
        item, d: p.gear[slot.id] || null, equipped: true,
        set: (d) => { p.gear[slot.id] = d; this.computeStats(p); },
        remove: () => { p.equip[slot.id] = null; p.gear[slot.id] = null; this.computeStats(p); },
      };
    }
    const s = Number.isInteger(i) && i >= 0 && i < p.inv.length ? p.inv[i] : null;
    if (!s || !lookup(C.EQUIPMENT, s.item) || C.EQUIPMENT[s.item].noRoll) return null;
    return {
      item: s.item, d: s.d || null, equipped: false,
      set: (d) => { if (d) s.d = d; else delete s.d; },
      remove: () => { p.inv[i] = null; },
    };
  },

  // Chancen in % [Erfolg, nichts, Stufe −1, zerstört] fürs Verbessern auf +target – mit Übung und Schutzsiegel
  upgradeOdds(p, target, ward) {
    let [ok, none, drop, brk] = C.GEAR.upgrade[target - 1].odds;
    drop *= Math.max(0, 1 + this.practiceBonus(p, 'smithDrop'));
    brk *= Math.max(0, 1 + this.practiceBonus(p, 'smithBreak'));
    if (ward) brk = 0;
    ok = Math.min(100 - drop - brk, ok + this.practiceBonus(p, 'smithSuccess') * 100);
    none = 100 - ok - drop - brk;
    return [ok, none, drop, brk].map((v) => +v.toFixed(1));
  },

  upgradeGear(p, src, i, ward) {
    if (!this.atForge(p)) return this.msg(p, 'Verbessern geht nur an deiner Schmiede.');
    const ref = this.gearRef(p, src, i);
    if (!ref) return;
    const d = ref.d || { r: 0, u: 0, m: [] }, target = d.u + 1, name = C.EQUIPMENT[ref.item].name;
    if (target > C.GEAR.upgrade.length) return this.msg(p, `${name} ist schon auf +${d.u}.`);
    const cost = upgradeCost(ref.item, target);
    if (!Inv.canAfford(p.inv, cost)) return this.msg(p, `Nicht genug Material für +${target}.`);
    const useWard = !!ward && Inv.count(p.inv, 'ward') > 0 && C.GEAR.upgrade[target - 1].odds[3] > 0;
    const odds = this.upgradeOdds(p, target, useWard);
    Inv.pay(p.inv, cost);
    if (useWard) Inv.remove(p.inv, 'ward', 1);
    this.addPractice(p, 'smithing', 4 + 2 * target);

    // über die Summe würfeln: die Chancen sind gerundet und ergeben nicht immer genau 100
    const forge = p.forge, roll = Math.random() * odds.reduce((a, b) => a + b, 0);
    if (roll < odds[0]) {
      ref.set({ ...d, u: target });
      this.events.push([forge.x, forge.y, 'up']);
      return this.msg(p, `✨ ${name} ist jetzt +${target}!`);
    }
    if (roll < odds[0] + odds[1]) return this.msg(p, `Fehlschlag – ${name} bleibt +${d.u}, das Material ist verbraucht.`);
    if (roll < odds[0] + odds[1] + odds[2]) {
      ref.set(this.cleanGear(ref.item, { ...d, u: d.u - 1 }));
      return this.msg(p, `💢 Fehlschlag – ${name} fällt auf +${d.u - 1} zurück.`);
    }
    ref.remove();
    const [a, b] = C.GEAR.breakScrap;
    this.give(p, 'scrap', Math.round(rand(a, b)), p.x, p.y);
    this.events.push([forge.x, forge.y, 'boom']);
    return this.msg(p, `💥 ${name} ist beim Verbessern zerbrochen! Ein paar Schrottteile bleiben übrig.`);
  },

  // Kosten fürs nächste Umschmieden dieses Teils
  reforgeCost(d) {
    const R = C.GEAR.reforge, k = 1 + R.growth * ((d && d.f) || 0), cost = {};
    for (const [item, n] of Object.entries(R.cost)) cost[item] = Math.ceil(n * k);
    return cost;
  },

  // Einen Bonus (k = Index) neu würfeln oder den Fluch entfernen (k = -1). Ohne Fluch verlieren die Boni ihre Verstärkung.
  reforgeGear(p, src, i, k) {
    if (!this.atForge(p)) return this.msg(p, 'Umschmieden geht nur an deiner Schmiede.');
    const ref = this.gearRef(p, src, i);
    if (!ref || !ref.d) return;
    const d = ref.d, def = C.EQUIPMENT[ref.item];
    if (k === -1 ? !d.c : !(k >= 0 && k < d.m.length)) return;
    const cost = this.reforgeCost(d);
    if (!Inv.canAfford(p.inv, cost)) return this.msg(p, 'Nicht genug Material zum Umschmieden.');
    Inv.pay(p.inv, cost);
    this.addPractice(p, 'smithing', 3);
    const boost = d.c ? C.GEAR.curseBoost : 1, next = { ...d, m: d.m.map((m) => [...m]), f: (d.f || 0) + 1 };
    if (k === -1) {
      delete next.c;
      next.m = next.m.map(([id, v]) => [id, rollValue({ range: [v / boost, v / boost], step: C.MODS[id].step })]);
      this.msg(p, `Der Fluch ist gebrochen – die Boni von ${def.name} sind wieder normal stark.`);
    } else {
      // möglichst ein anderer Bonus als bisher; gibt es keinen mehr, wenigstens ein neuer Wert
      const ids = pool(C.MODS, def);
      const id = pickNew(ids, next.m.map((m) => m[0])) || pickNew(ids, next.m.filter((_, j) => j !== k).map((m) => m[0]));
      next.m[k] = [id, rollValue(C.MODS[id], boost)];
      this.msg(p, `Neuer Bonus: ${C.MODS[id].name}.`);
    }
    ref.set(next);
    this.events.push([p.forge.x, p.forge.y, 'fix']);
  },

  // Zerlegen (nur aus dem Inventar): ein Teil der Rezeptkosten zurück, gefundene Teile geben Schrott
  salvageGear(p, i) {
    if (!this.atForge(p)) return this.msg(p, 'Zerlegen geht nur an deiner Schmiede.');
    const ref = this.gearRef(p, 'inv', i);
    if (!ref) return;
    const def = C.EQUIPMENT[ref.item], back = {};
    if (def.recipe) {
      for (const [item, n] of Object.entries(def.recipe.cost)) {
        const k = Math.floor(n * C.GEAR.salvage);
        if (k > 0) back[item] = k;
      }
    } else back.scrap = 2 + (def.tier || 0);
    if (ref.d && ref.d.u) back.iron = (back.iron || 0) + ref.d.u; // Verbesserungen bringen etwas Eisen zurück
    ref.remove();
    for (const [item, n] of Object.entries(back)) this.give(p, item, n, p.x, p.y);
    this.addPractice(p, 'smithing', 1);
    this.msg(p, `${def.name} zerlegt: ${Object.entries(back).map(([item, n]) => `${n}× ${C.ITEMS.names[item]}`).join(', ') || 'nichts'}.`);
  },
};
