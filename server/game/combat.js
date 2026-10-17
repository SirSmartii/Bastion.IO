'use strict';
// Kampf: Nahkampfschläge, Schüsse, Projektile, Schaden an Gegnern und Spielern, Beute.

const C = require('../config');
const Inv = require('../inventory');
const { TAU, rand } = require('./util');
const { circleHitsRect } = require('./geometry');

module.exports = {
  // ---------- Munition ----------

  // Welche Munition wird verschossen? Gewählter Typ, sonst der stärkste vorhandene.
  ammoFor(p, group) {
    const types = C.AMMO[group].types;
    const preferred = types.find((t) => t.item === p.ammoPref[group]);
    if (preferred && Inv.count(p.inv, preferred.item) > 0) return preferred;
    for (let i = types.length - 1; i >= 0; i--) if (Inv.count(p.inv, types[i].item) > 0) return types[i];
    return null;
  },

  // [R]: zum nächsten vorhandenen Munitionstyp der ausgerüsteten Waffe wechseln
  cycleAmmo(p) {
    const def = C.EQUIPMENT[p.equip.weapon];
    if (!def || !def.ammo) return;
    const owned = C.AMMO[def.ammo].types.filter((t) => Inv.count(p.inv, t.item) > 0);
    if (owned.length < 2) return this.msg(p, owned.length ? `Nur ${C.ITEMS.names[owned[0].item]} vorhanden.` : 'Keine Munition.');
    const current = this.ammoFor(p, def.ammo);
    const next = owned[(owned.indexOf(current) + 1) % owned.length];
    p.ammoPref[def.ammo] = next.item;
    this.msg(p, `Munition: ${C.ITEMS.names[next.item]} (${Inv.count(p.inv, next.item)})`);
  },

  // ---------- Angriffe ----------

  // Fernwaffe: verbraucht 1 Munition und feuert `pellets` Geschosse mit Streuung. Schüsse sind laut.
  shoot(p) {
    const def = C.EQUIPMENT[p.equip.weapon], proj = def.projectile;
    const ammo = this.ammoFor(p, def.ammo);
    if (!ammo) {
      if (this.now - p.ammoMsgT > 2) {
        p.ammoMsgT = this.now;
        this.msg(p, `Keine Munition (${C.AMMO[def.ammo].label})! In der Schmiede herstellen.`);
      }
      return;
    }
    Inv.remove(p.inv, ammo.item, 1);
    p.swings++;
    const muzzle = p.r + (def.kind === 'gun' ? 34 : 10);
    const mx = p.x + Math.cos(p.angle) * muzzle, my = p.y + Math.sin(p.angle) * muzzle;
    const pellets = proj.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const a = p.angle + (Math.random() - 0.5) * 2 * (proj.spread || 0);
      // Schrot fliegt unterschiedlich weit, damit die Garbe nicht als Linie endet
      const range = p.stats.range * (pellets > 1 ? rand(0.8, 1) : 1);
      this.projectiles.push({
        x: mx, y: my, vx: Math.cos(a) * proj.speed, vy: Math.sin(a) * proj.speed,
        dmg: p.stats.damage + ammo.damage, life: range / proj.speed, owner: p.id, fromPlayer: true,
        look: ammo.look, ammo: ammo.item, recover: ammo.recover,
      });
    }
    if (def.kind === 'gun') this.events.push([Math.round(mx), Math.round(my), 'shot', +p.angle.toFixed(2)]);
    // Lärm: feindliche Gegner im Umkreis werden auf den Schützen aufmerksam
    if (def.noise) {
      for (const z of this.zgrid.query(p.x, p.y, def.noise)) {
        if (z.ai === 'neutral' || Math.hypot(z.x - p.x, z.y - p.y) > def.noise) continue;
        this.angerZombie(z, p.id);
      }
    }
  },

  // Gegner verfolgt den Angreifer für ANGER_TIME Sekunden – bei Rudeln das ganze Rudel
  angerZombie(z, attackerId) {
    for (const m of z.pack ? z.pack.members : [z]) {
      m.angryAt = attackerId;
      m.angryUntil = this.now + C.ANGER_TIME;
      m.retarget = 0;
    }
  },

  // Nahkampfschlag in Blickrichtung: trifft Gegner, baut Ressourcen ab, repariert eigene Gebäude
  playerHit(p) {
    const st = p.stats, reach = st.reach;
    const hx = p.x + Math.cos(p.angle) * reach * 0.65, hy = p.y + Math.sin(p.angle) * reach * 0.65;
    const hr = reach * 0.55;

    for (const z of this.zgrid.query(hx, hy, hr + 40)) {
      if (Math.hypot(z.x - hx, z.y - hy) >= hr + z.r) continue;
      this.angerZombie(z, p.id);
      this.damageZombie(z, st.damage, p.id);
      this.lifesteal(p, st.damage);
      this.addPractice(p, 'melee', 2);
    }
    for (const o of this.statics.query(hx, hy, hr + 80)) {
      if (o.kind === 'res' && Math.hypot(o.x - hx, o.y - hy) < hr * 0.5 + o.r) this.gather(p, o);
      else if (o.kind === 's' && circleHitsRect(hx, hy, hr * 0.6, o)) {
        if (this.allied(p, o.owner)) this.repair(p, o);
        else if (C.PVP) this.damageStructure(o, st.damage * 1.5);
      }
    }
    if (C.PVP) {
      for (const o of this.players.values()) {
        if (o === p || o.dead || this.allied(p, o.id)) continue;
        if (Math.hypot(o.x - hx, o.y - hy) < hr + o.r) this.damagePlayer(o, st.damage);
      }
    }
  },

  // Ressource abbauen (Kisten, Regale, Autowracks … brechen nach mehreren Schlägen auf und geben dann Beute)
  gather(p, o) {
    if (C.RESOURCES[o.type].loot) {
      o.shook = this.now;
      this.events.push([Math.round(o.x), Math.round(o.y), 'g', 0, o.id, 'crate', p.id]);
      this.depleteResource(o, 1, p);
      return;
    }
    const def = C.RESOURCES[o.type], kind = def.gives;
    if (def.pick) return this.harvest(p, o, def);
    // Spitzhacken bauen Gestein mit ihrem mine-Wert ab, sonst zählt der normale Abbau-Wert
    const power = def.hard && p.stats.mine ? p.stats.mine : p.stats.gather;
    if (def.tool && (p.stats.tool || 0) < def.tool) {
      if (this.now - p.fullMsgT > 2) {
        p.fullMsgT = this.now;
        const need = Object.values(C.MATERIALS).find((m) => m.tier === def.tool);
        this.msg(p, `Zu hart – dafür brauchst du mindestens eine Axt oder Spitzhacke aus ${need ? need.name : 'besserem Material'}.`);
      }
      return;
    }
    // Sammler-Skill: Chance auf doppelten Ertrag
    const want = Math.min(power * (Math.random() < p.stats.doubleGather ? 2 : 1), o.amount);
    if (!want) return;
    // Übung (Holzfällen bei Holz, Bergbau bei Gestein) und Ertrags-Boni der Ausrüstung: Chance auf +1
    const skill = def.hard ? 'mining' : kind === 'wood' ? 'woodcutting' : null;
    const extraChance = (skill ? this.practiceBonus(p, skill === 'mining' ? 'extraOre' : 'extraWood') : 0) + p.stats.yieldBonus;
    const extra = Math.random() < extraChance ? 1 : 0;
    const got = want + extra - Inv.add(p.inv, kind, want + extra);
    if (!got) {
      if (this.now - p.fullMsgT > 2) { p.fullMsgT = this.now; this.msg(p, 'Inventar voll! [Tab] zum Aufräumen.'); }
      return;
    }
    p.score += got;
    this.lbDirty = true;
    this.events.push([Math.round(o.x), Math.round(o.y), 'g', got, o.id, kind, p.id]);
    this.addXp(p, got * C.XP.gather);
    if (skill) this.addPractice(p, skill, got);
    // Apfelbaum: mit etwas Glück fällt ein Apfel herunter
    if (def.fruit && Math.random() < def.fruit.chance) this.give(p, def.fruit.item, 1, o.x, o.y);
    this.depleteResource(o, got, p);
  },

  // Beeren, Gemüse: 1 Stück pro Schlag, egal womit (auch mit der Faust oder einem Bogen in der Hand)
  harvest(p, o, def) {
    if (Inv.add(p.inv, def.gives, 1) > 0) {
      if (this.now - p.fullMsgT > 2) { p.fullMsgT = this.now; this.msg(p, 'Inventar voll! [Tab] zum Aufräumen.'); }
      return;
    }
    o.shook = this.now;
    this.events.push([Math.round(o.x), Math.round(o.y), 'g', 1, o.id, def.gives, p.id]);
    this.addXp(p, C.XP.gather);
    this.depleteResource(o, 1, p);
  },

  // ---------- Schaden ----------

  // byAnimal: das Raubtier, das zugebissen hat. Das Opfer wehrt sich (bzw. flieht); was Tiere erlegen,
  // lässt nichts fallen und bringt niemandem Punkte. Ergebnis: true, wenn der Gegner gestorben ist.
  damageZombie(z, dmg, attackerId, byAnimal = null) {
    if (!this.zombies.has(z.id)) return false;
    z.hp -= dmg;
    this.events.push([Math.round(z.x), Math.round(z.y - z.r), 'hit', Math.max(1, Math.round(dmg))]);
    if (byAnimal) {
      z.foe = byAnimal;
      z.foeUntil = this.now + C.ANGER_TIME;
      if (z.retarget > 0.1) z.retarget = 0.1;
    }
    if (z.hp > 0) return false;

    this.removeZombie(z, true);
    const def = C.ENEMIES[z.type];
    this.events.push([Math.round(z.x), Math.round(z.y), 'die']);
    if (byAnimal) return true;
    this.dropLoot(z, def.drops);
    const killer = this.players.get(attackerId);
    if (killer) {
      killer.score += def.score;
      killer.kills++;
      this.addXp(killer, def.xp);
      this.lbDirty = true;
    }
    return true;
  },

  // Droptable würfeln; Beute fällt verstreut auf den Boden (nachts mehr, außer fixedMult ist gesetzt).
  // Ausrüstung wird einzeln als Fundstück ausgewürfelt (Seltenheit & Boni, GEAR.sources.loot).
  dropLoot(source, drops, fixedMult) {
    const mult = fixedMult || (this.isNight ? C.DROP_NIGHT_BONUS : 1);
    for (const d of drops || []) {
      if (Math.random() >= d.chance) continue;
      const n = Math.round((d.min + Math.floor(Math.random() * (d.max - d.min + 1))) * mult);
      const a = rand(0, TAU), r = rand(8, (source.r || 20) + 10);
      const x = source.x + Math.cos(a) * r, y = source.y + Math.sin(a) * r;
      if (C.EQUIPMENT[d.item]) for (let i = 0; i < n; i++) this.dropItem(x + i * 12, y, d.item, 1, 0, this.rollGear(d.item, 'loot'));
      else this.dropItem(x, y, d.item, n);
    }
  },

  // Lebensraub: ein Teil des Schadens heilt den Angreifer
  lifesteal(p, dmg) {
    if (!p || !p.stats.lifesteal || p.dead) return;
    p.hp = Math.min(p.maxHp, p.hp + dmg * p.stats.lifesteal);
  },

  // raw: an der Rüstung vorbei (Hunger, Durst). deathMsg: was der Spieler beim Tod liest.
  // Ergebnis: true, wenn der Spieler daran gestorben ist.
  damagePlayer(p, dmg, raw = false, deathMsg = 'Du wurdest überrannt!') {
    if (p.dead || this.isProtected(p)) return false;
    const taken = raw ? dmg : dmg * (1 - p.stats.reduction);
    p.hp -= taken;
    p.lastHurt = this.now;
    this.events.push([Math.round(p.x), Math.round(p.y - p.r), 'hurt', Math.max(1, Math.round(taken)), p.id]);
    if (p.hp > 0) return false;

    p.dead = true;
    p.hp = 0;
    p.spawnChoice = null;
    p.fishing = null;
    p.bestAlive = Math.max(p.bestAlive, p.alive);
    p.alive = 0;
    p.respawnT = C.PLAYER.respawnTime;
    p.chest = 0;
    // Ein Teil des Inventars fällt als Beute auf den Boden – Ausrüstung als ganze Einzelstücke (samt Daten)
    for (const [item, n] of Object.entries(Inv.totals(p.inv))) {
      let lose = Math.floor(n * C.PLAYER.deathLoss);
      if (!lose) continue;
      if (!C.EQUIPMENT[item]) {
        Inv.remove(p.inv, item, lose);
        this.dropItem(p.x + rand(-25, 25), p.y + rand(-25, 25), item, lose);
        continue;
      }
      for (let i = p.inv.length - 1; i >= 0 && lose > 0; i--) {
        const s = p.inv[i];
        if (!s || s.item !== item) continue;
        p.inv[i] = null;
        lose--;
        this.dropItem(p.x + rand(-25, 25), p.y + rand(-25, 25), item, 1, 0, s.d);
      }
    }
    p.score = Math.floor(p.score * 0.8);
    this.lbDirty = true;
    this.msg(p, deathMsg);
    return true;
  },

  // ---------- Projektile ----------

  updateProjectiles(dt) {
    const alive = [];
    for (const b of this.projectiles) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      const hit = this.projectileHitsZombie(b) || this.projectileHitsPlayer(b) || this.projectileBlocked(b);
      // Pfeile bleiben je nach Typ manchmal liegen
      if (hit && b.recover && Math.random() < b.recover) this.dropItem(b.x - b.vx * 0.02, b.y - b.vy * 0.02, b.ammo, 1);
      if (!hit && b.life > 0) alive.push(b);
    }
    this.projectiles = alive;
  },

  projectileHitsZombie(b) {
    for (const z of this.zgrid.query(b.x, b.y, 40)) {
      if (!this.zombies.has(z.id) || Math.hypot(z.x - b.x, z.y - b.y) >= z.r + 5) continue;
      if (b.fromPlayer) {
        this.angerZombie(z, b.owner);
        this.addPractice(this.players.get(b.owner), 'shooting', 2);
        this.lifesteal(this.players.get(b.owner), b.dmg);
      }
      this.damageZombie(z, b.dmg, b.owner);
      return true;
    }
    return false;
  },

  projectileHitsPlayer(b) {
    if (!C.PVP) return false;
    for (const p of this.players.values()) {
      if (p.dead || this.allied(p, b.owner) || Math.hypot(p.x - b.x, p.y - b.y) >= p.r + 5) continue;
      this.damagePlayer(p, b.dmg);
      return true;
    }
    return false;
  },

  // Spielergeschosse stoppen an Ressourcen, Ruinen und fremden Gebäuden (außer Fenstern).
  // Turmgeschosse fliegen über alles hinweg. Seen halten nichts auf.
  projectileBlocked(b) {
    if (!b.fromPlayer) return false;
    const shooter = this.players.get(b.owner);
    for (const o of this.statics.query(b.x, b.y, 10)) {
      if (o.kind === 'water') continue;
      if (o.kind === 'res') { if (Math.hypot(o.x - b.x, o.y - b.y) < o.cr) return true; continue; }
      if (!circleHitsRect(b.x, b.y, 3, o)) continue;
      if (o.kind === 'ruin') return true;
      const friendly = o.owner === b.owner || this.allied(shooter, o.owner);
      if (!friendly && !C.STRUCTURES[o.type].shootThrough) return true;
    }
    return false;
  },
};
