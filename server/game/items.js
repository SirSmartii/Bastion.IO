'use strict';
// Items: Inventar, Items am Boden, Essen, Hotbar, Ausrüstung, Werte und Herstellen.

const C = require('../config');
const Inv = require('../inventory');
const { clamp, uid, lookup } = require('./util');

module.exports = {
  isKnownItem(item) {
    return !!(lookup(C.EQUIPMENT, item) || lookup(C.ITEMS.names, item));
  },

  // ---------- Inventar & Items am Boden ----------

  // Ins Inventar legen; was nicht passt, fällt bei (x, y) auf den Boden
  give(p, item, n, x, y) {
    const left = Inv.add(p.inv, item, n);
    if (left > 0) this.dropItem(x, y, item, left);
  },

  // Item auf den Boden legen. blockId: dieser Spieler hebt es erst auf, nachdem er sich einmal entfernt hat
  // (gemerkt beim Spieler in p.dropBlocked, damit es auch nach Teleport oder Tod stimmt). d: Daten eines Ausrüstungsteils
  dropItem(x, y, item, n, blockId = 0, d = null) {
    const dropper = blockId ? this.players.get(blockId) : null;
    if (n <= 0) return;
    const W = C.WORLD_SIZE;
    x = clamp(x, 20, W - 20);
    y = clamp(y, 20, W - 20);
    // Mit einem nahen Haufen gleicher Art zusammenlegen (Ausrüstung bleibt einzeln)
    if (!C.EQUIPMENT[item]) {
      const pile = this.nearbyGroundItems(x, y, 30).find((it) => it.item === item && Math.hypot(it.x - x, it.y - y) < 30);
      if (pile) {
        pile.n += n;
        pile.t = this.now;
        if (dropper) dropper.dropBlocked.add(pile.id);
        return;
      }
    }
    // Zu viele Items am Boden: das älteste verschwindet
    if (this.items.size >= C.ITEMS.maxGround) this.removeGroundItem(this.items.values().next().value);
    const it = { id: uid(), item, n, x, y, br: 1, t: this.now };
    if (d) it.d = d;
    if (dropper) dropper.dropBlocked.add(it.id);
    this.items.set(it.id, it);
    this.itemGrid.insert(it);
  },

  // Items am Boden in der Nähe (über das Raster, nur solche, die noch existieren)
  nearbyGroundItems(x, y, r) {
    return this.itemGrid.query(x, y, r).filter((it) => this.items.has(it.id));
  },

  removeGroundItem(it) {
    this.items.delete(it.id);
    this.itemGrid.remove(it);
  },

  // Items, die zu lange liegen, verschwinden
  updateGroundItems() {
    for (const it of this.items.values()) if (this.now - it.t > C.ITEMS.despawn) this.removeGroundItem(it);
  },

  dropFromSlot(p, slot, n, x, y) {
    if (p.dead || slot < 0 || slot >= p.inv.length) return;
    const taken = Inv.take(p.inv, slot, n);
    if (taken) this.dropFromHand(p, taken.item, x, y, taken.n, taken.d);
  },

  // Werfen: an die Zielposition (höchstens maxDropDist weit) oder vor die Füße
  dropFromHand(p, item, x, y, n = 1, d = null) {
    const max = C.ITEMS.maxDropDist;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      x = p.x + Math.cos(p.angle) * 70;
      y = p.y + Math.sin(p.angle) * 70;
    } else {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > max) { x = p.x + ((x - p.x) / d) * max; y = p.y + ((y - p.y) / d) * max; }
    }
    this.dropItem(x, y, item, n, p.id, d);
  },

  pickupItems(p) {
    const range = p.r + C.ITEMS.pickupRadius;
    // Selbst geworfene Items: wieder aufhebbar, sobald man einmal außer Reichweite war
    for (const id of p.dropBlocked) {
      const it = this.items.get(id);
      if (!it || Math.hypot(it.x - p.x, it.y - p.y) > range) p.dropBlocked.delete(id);
    }
    for (const it of this.nearbyGroundItems(p.x, p.y, range)) {
      if (p.dropBlocked.has(it.id) || Math.hypot(it.x - p.x, it.y - p.y) > range) continue;
      const left = Inv.add(p.inv, it.item, it.n, it.d);
      if (left === it.n) continue; // Inventar voll
      this.events.push([Math.round(it.x), Math.round(it.y), 'pick', it.n - left, it.item, p.id]);
      it.n = left;
      if (!left) this.removeGroundItem(it);
    }
  },

  // Bringt das Verbrauchen von def gerade etwas? (Essen bei Hunger, Wasser bei Durst, Verband bei Wunden)
  foodHelps(p, def) {
    const max = C.SURVIVAL.max;
    return (def.food > 0 && p.hunger < max - 1) || (def.water > 0 && p.thirst < max - 1) || (def.hp > 0 && p.hp < p.maxHp);
  },

  // Essen, Trinken oder Verband benutzen – aus einem Slot oder (slot < 0, Taste [H]) das Passendste:
  // erst was gegen den größeren Mangel hilft, Verbände nur bei Wunden
  eat(p, slot) {
    if (p.dead || this.now - p.eatT < C.ITEMS.eatCooldown) return;
    const food = C.ITEMS.food;
    if (slot < 0) {
      slot = this.bestFoodSlot(p);
      if (slot < 0 && p.inv.some((it) => it && lookup(food, it.item))) return this.msg(p, 'Du bist satt, hast keinen Durst und bist unverletzt.');
    }
    const s = p.inv[slot], def = s && lookup(food, s.item);
    if (!def) return this.msg(p, 'Nichts Essbares im Inventar.');
    if (!this.foodHelps(p, def)) return this.msg(p, def.food ? 'Du bist schon satt.' : def.water ? 'Du hast keinen Durst.' : 'Du bist unverletzt.');
    const item = s.item, S = C.SURVIVAL;
    Inv.take(p.inv, slot, 1);
    if (def.returns) this.give(p, def.returns, 1, p.x, p.y);
    p.hunger = Math.min(S.max, p.hunger + (def.food || 0));
    p.thirst = Math.min(S.max, p.thirst + (def.water || 0));
    if (def.hp) p.hp = clamp(p.hp + def.hp, 1, p.maxHp);
    p.eatT = this.now;
    this.events.push([Math.round(p.x), Math.round(p.y), 'eat', def.hp || 0, p.id, item]);
    if (def.hp < 0) this.msg(p, '{item} roh bekommt dir nicht – brate es lieber am Lagerfeuer.', { item: C.ITEMS.names[item] });
    // Wirkung auf Zeit (z. B. Eintopf: doppelte Regeneration)
    if (def.buff) {
      p.buffs = p.buffs || {};
      for (const [k, v] of Object.entries(def.buff)) if (k !== 't') p.buffs[k] = { v, until: this.now + def.buff.t };
      this.msg(p, def.buff.regen ? '{item}: doppelte Regeneration für {n} s.' : '{item}: schnellere Ausdauer-Erholung für {n} s.', { item: C.ITEMS.names[item], n: def.buff.t });
    }
  },

  // Faktor einer laufenden Wirkung (1 = keine)
  buffFactor(p, k) {
    const b = p.buffs && p.buffs[k];
    return b && b.until > this.now ? b.v : 1;
  },

  bestFoodSlot(p) {
    const food = C.ITEMS.food, thirsty = p.thirst < p.hunger;
    let best = -1, bestScore = 0;
    p.inv.forEach((s, i) => {
      const def = s && lookup(food, s.item);
      if (!def || !this.foodHelps(p, def)) return;
      // Was gegen den größeren Mangel hilft, zählt doppelt; Verbände nur, wenn nichts anderes da ist
      const score = (def.food || 0) * (thirsty ? 1 : 2) + (def.water || 0) * (thirsty ? 2 : 1) + (def.food || def.water ? 0 : 0.1) + Math.max(0, def.hp || 0) * 0.2;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  },

  // ---------- Hotbar ----------

  assignHotbar(p, i, item) {
    if (i < 0 || i >= C.HOTBAR_SIZE) return;
    if (item === null || item === undefined) { p.hotbar[i] = null; return; }
    if (!this.isKnownItem(item)) return;
    // Ein Item steht höchstens einmal in der Hotbar
    for (let k = 0; k < p.hotbar.length; k++) if (p.hotbar[k] === item) p.hotbar[k] = null;
    p.hotbar[i] = item;
  },

  // Slot benutzen: Ausrüstung anlegen, Essen essen, Munitionstyp wählen
  useHotbar(p, i) {
    const item = p.hotbar[i];
    if (!item || p.dead) return;
    const slot = p.inv.findIndex((s) => s && s.item === item);
    const eq = lookup(C.EQUIPMENT, item);
    if (eq) {
      if (p.equip[eq.slot] === item) return;
      if (slot < 0) return this.msg(p, '{name} ist nicht im Inventar.', { name: eq.name });
      return this.equip(p, slot);
    }
    if (lookup(C.ITEMS.food, item)) {
      if (slot < 0) return this.msg(p, 'Kein {item} im Inventar.', { item: C.ITEMS.names[item] });
      return this.eat(p, slot);
    }
    const group = Object.keys(C.AMMO).find((g) => C.AMMO[g].types.some((t) => t.item === item));
    if (group) {
      p.ammoPref[group] = item;
      this.msg(p, 'Munition: {item} ({n})', { item: C.ITEMS.names[item], n: Inv.count(p.inv, item) });
    }
  },

  // ---------- Ausrüstung & Werte ----------

  // Grundwerte + Ausrüstung + Fertigkeiten → effektive Werte in p.stats
  computeStats(p) {
    const P = C.PLAYER;
    const gm = this.gearMods(p); // Boni & Flüche der Ausrüstung
    const st = {
      maxHp: P.hp, armor: 0, damage: P.fistDamage, gather: P.fistGather, mine: 0, tool: 0, // mine 0 = Gestein wie alles andere (gather)
      speed: P.speed, attackSpeed: +(1 / P.attackCooldown).toFixed(2), regen: P.regen, reach: P.reach,
      stamina: P.stamina, range: 0,
    };
    // Waffen ersetzen die Faustwerte, alles andere addiert sich
    const WEAPON_REPLACES = ['damage', 'gather', 'mine', 'tool', 'attackSpeed', 'reach', 'range'];
    // Verbesserungsstufe: Waffen mehr Schaden, Kleidung mehr Rüstung & Leben
    const MAIN_STATS = { weapon: ['damage'], armor: ['armor', 'maxHp'] };
    for (const slot of C.EQUIP_SLOTS) {
      const def = C.EQUIPMENT[p.equip[slot.id]];
      if (!def) continue;
      const up = this.upgradeFactor(p.gear[slot.id]), main = MAIN_STATS[slot.id === 'weapon' ? 'weapon' : 'armor'];
      for (const [k, raw] of Object.entries(def.stats)) {
        const v = main.includes(k) ? +(raw * up).toFixed(1) : raw;
        if (slot.id === 'weapon' && WEAPON_REPLACES.includes(k)) st[k] = v;
        else st[k] = (st[k] || 0) + v;
      }
    }
    st.maxHp = Math.round(st.maxHp + (gm.hp || 0));
    st.armor = Math.max(0, +(st.armor + (gm.armor || 0)).toFixed(1));
    // Fertigkeiten: flache Boni addieren, Prozent-Boni multiplizieren
    const bonus = {};
    for (const skill of C.SKILLS) {
      const rank = p.skills[skill.id] || 0;
      for (const [k, v] of Object.entries(skill.per)) bonus[k] = (bonus[k] || 0) + v * rank;
    }
    for (const k of ['maxHp', 'stamina', 'armor', 'regen']) if (bonus[k]) st[k] = +(st[k] + bonus[k]).toFixed(1);
    const weapon = C.EQUIPMENT[p.equip.weapon];
    st.ranged = !!(weapon && weapon.ammo);
    // Fertigkeitspunkte und Übung (PRACTICE) verstärken sich gegenseitig nicht, sie addieren sich
    const practice = (key) => this.practiceBonus(p, key);
    const dmgBonus = (st.ranged ? bonus.rangedDmg : bonus.meleeDmg) || 0, dmgPractice = practice(st.ranged ? 'rangedDmg' : 'meleeDmg');
    const pct = (k) => (gm[k] || 0) / 100;
    st.damage = +(st.damage * (1 + dmgBonus + dmgPractice) * (1 + pct('dmgPct'))).toFixed(1);
    st.attackSpeed = +(st.attackSpeed * (1 + practice(st.ranged ? 'rangedRate' : 'meleeRate')) * Math.max(0.3, 1 + pct('atkPct'))).toFixed(2);
    st.speed = Math.max(80, Math.round(st.speed * (1 + (bonus.speedPct || 0) + practice('speedPct') + pct('speedPct'))));
    if (st.ranged) st.range = Math.round(st.range * (1 + pct('reachPct')));
    else st.reach = Math.round(st.reach * (1 + pct('reachPct')));
    st.regen = +Math.max(0, (st.regen + (gm.regen || 0)) * (1 + pct('regenPct'))).toFixed(2);
    // Werte, die nur der Server braucht (Anzeige im Charakterfenster über die Boni-Liste)
    st.lifesteal = pct('lifesteal');
    st.yieldBonus = pct('yield');
    st.lootBonus = pct('loot');
    st.sprintCost = pct('sprintPct');
    st.needs = Math.max(0.2, 1 + pct('needsPct'));
    st.noise = Math.max(0.5, 1 + pct('noisePct'));
    st.doubleGather = +(bonus.doubleGather || 0).toFixed(2);
    st.ammo = st.ranged ? weapon.ammo : null;
    st.reduction = +(st.armor / (st.armor + P.armorFactor)).toFixed(3); // Anteil des abgewehrten Schadens
    p.stats = st;
    p.maxHp = st.maxHp;
    p.hp = Math.min(p.hp, p.maxHp);
  },

  // Inventargröße: Grundplätze + Rucksack (EQUIPMENT[*].slots)
  invSizeFor(backItem) {
    const def = backItem && C.EQUIPMENT[backItem];
    return C.INVENTORY.slots + ((def && def.slots) || 0);
  },

  // Inventar auf size Plätze bringen; verkleinern nur, wenn die wegfallenden Plätze leer sind (except: dieser zählt nicht)
  resizeInventory(p, size, except = -1) {
    if (p.inv.some((s, i) => s && i >= size && i !== except)) return false;
    p.inv.length = Math.min(p.inv.length, size);
    while (p.inv.length < size) p.inv.push(null);
    return true;
  },

  // Item aus einem Inventar-Slot anlegen; ein vorher getragenes Teil landet im selben Slot (samt seinen Daten)
  equip(p, slot) {
    const it = p.inv[slot];
    const def = it && lookup(C.EQUIPMENT, it.item);
    if (!def || p.dead) return;
    const old = p.equip[def.slot], oldD = p.gear[def.slot];
    if (def.slot === 'back') {
      // Rucksack wechseln: die Plätze, die wegfallen, müssen leer sein – und das alte Teil muss in den Slot passen
      const size = this.invSizeFor(it.item);
      if ((old && slot >= size) || p.inv.some((s, i) => s && i >= size && i !== slot)) {
        return this.msg(p, 'Räume zuerst die Rucksack-Plätze leer.');
      }
    }
    p.equip[def.slot] = it.item;
    p.gear[def.slot] = it.d || null;
    p.inv[slot] = old ? (oldD ? { item: old, n: 1, d: oldD } : { item: old, n: 1 }) : null;
    if (def.slot === 'back') this.resizeInventory(p, this.invSizeFor(it.item));
    this.computeStats(p);
  },

  // Ablegen: in einen bestimmten freien Slot, irgendeinen freien Slot oder auf den Boden
  unequip(p, slotId, toSlot, drop, x, y) {
    if (p.dead || !C.EQUIP_SLOTS.some((s) => s.id === slotId)) return;
    const item = p.equip[slotId], d = p.gear[slotId] || null;
    if (!item) return;
    // Rucksack ablegen: nur mit leeren Rucksack-Plätzen
    if (slotId === 'back' && !this.resizeInventory(p, C.INVENTORY.slots)) return this.msg(p, 'Räume zuerst die Rucksack-Plätze leer.');
    if (drop) {
      p.equip[slotId] = null;
      p.gear[slotId] = null;
      this.computeStats(p);
      return this.dropFromHand(p, item, x, y, 1, d);
    }
    if (toSlot >= 0 && toSlot < p.inv.length && !p.inv[toSlot]) p.inv[toSlot] = d ? { item, n: 1, d } : { item, n: 1 };
    else if (Inv.add(p.inv, item, 1, d || undefined) > 0) {
      if (slotId === 'back') this.resizeInventory(p, this.invSizeFor(item)); // Rucksack bleibt an
      return this.msg(p, 'Inventar voll!');
    }
    p.equip[slotId] = null;
    p.gear[slotId] = null;
    this.computeStats(p);
  },

  // ---------- Herstellen ----------

  // An der eigenen Schmiede herstellen; ihr Level bestimmt, was möglich ist
  craft(p, id) {
    const equipment = lookup(C.EQUIPMENT, id), stackRecipe = lookup(C.ITEMS.recipes, id);
    const def = equipment || (stackRecipe && { name: C.ITEMS.names[id], recipe: stackRecipe });
    if (!def || !def.recipe || p.dead) return;
    // Kochen: nur neben einem brennenden Lagerfeuer (eigenes oder vom Team)
    if (def.recipe.campfire) {
      const fire = [...this.statics.query(p.x, p.y, C.STRUCTURES.campfire.useRange)]
        .find((o) => o.kind === 's' && o.type === 'campfire' && o.active && this.allied(p, o.owner) && Math.hypot(o.x - p.x, o.y - p.y) <= C.STRUCTURES.campfire.useRange);
      if (!fire) return this.msg(p, '{name} kochst du an einem brennenden Lagerfeuer.', { name: def.name });
      if (!Inv.canAfford(p.inv, def.recipe.cost)) return this.msg(p, 'Nicht genug Zutaten für {name}.', { name: def.name });
      Inv.pay(p.inv, def.recipe.cost);
      this.give(p, id, def.recipe.amount || 1, p.x, p.y);
      for (const [item, n] of Object.entries(def.recipe.returns || {})) this.give(p, item, n, p.x, p.y);
      this.events.push([Math.round(fire.x), Math.round(fire.y), 'up']);
      this.addXp(p, C.XP.craft);
      return this.msg(p, '{name} gekocht!', { name: def.name });
    }
    // An der Schmiede alles bis zu ihrem Level; unterwegs nur einfache Rezepte (hand)
    const forge = p.forge;
    const atForge = !!forge && Math.hypot(forge.x - p.x, forge.y - p.y) <= C.STRUCTURES.forge.useRange;
    if (!atForge && !def.recipe.hand) {
      return forge ? this.msg(p, 'Geh näher an deine Schmiede.') : this.msg(p, '{name} kann nur an einer Schmiede hergestellt werden.', { name: def.name });
    }
    if (atForge && !def.recipe.hand && forge.level + 1 < def.recipe.forge) return this.msg(p, '{name} braucht Schmiede Lv {n}.', { name: def.name, n: def.recipe.forge });
    if (!Inv.canAfford(p.inv, def.recipe.cost)) return this.msg(p, 'Nicht genug Ressourcen für {name}.', { name: def.name });
    Inv.pay(p.inv, def.recipe.cost);
    const n = def.recipe.amount || 1;
    // Ausrüstung wird als Einzelstück ausgewürfelt (Seltenheit & Boni)
    const d = equipment ? this.rollGear(id, 'craft', p) : null;
    if (equipment) for (let i = 0; i < n; i++) this.giveGear(p, id, i ? this.rollGear(id, 'craft', p) : d);
    else this.give(p, id, n, p.x, p.y);
    const at = atForge ? forge : p;
    this.events.push([Math.round(at.x), Math.round(at.y), 'up']);
    this.addXp(p, C.XP.craft);
    const total = Object.values(def.recipe.cost).reduce((a, b) => a + b, 0);
    this.addPractice(p, 'smithing', 1 + Math.floor(total / 40));
    const v = { n, name: def.name, rarity: d ? C.GEAR.rarities[d.r].name : '' };
    if (!equipment) return this.msg(p, '{n}× {name} hergestellt!', v);
    const many = n > 1 ? '{n}× ' : '';
    if (!d) return this.msg(p, many + '{name} hergestellt! Ausrüsten im Charakterfenster [C].', v); // ohne Seltenheit (Fackel, Angel …)
    this.msg(p, d.c ? many + '{name} ({rarity}, verflucht) hergestellt! Ausrüsten im Charakterfenster [C].'
      : many + '{name} ({rarity}) hergestellt! Ausrüsten im Charakterfenster [C].', v);
  },
};
