'use strict';
// Gegner & Tiere: Spawnen (rund um Spieler, Basen und in Städten), Zielwahl und Bewegung.
//
// KI-Typen (ENEMIES[*].ai in der Config):
//   zombie      – jagt Spieler; nachts schneller, aggressiver und häufiger (SPAWN.night*). Jagt nie Tiere,
//                 wehrt sich aber, wenn eines zubeißt
//   pack        – Rudeltier, folgt seinem Alpha und jagt Spieler, ignoriert Basen
//   neutral     – friedlich, wehrt sich gegen Spieler; vor beißenden Tieren flieht es
//   territorial – greift nur in der Nähe an, verfolgt dann bis zur Leine
//
// Rudel (z.pack): { leader, members, hunger, raging, … } – jedes Raubtier hat eines (ein Bär ist ein Rudel aus einem).
// Raubtiere (ENEMIES[*].predator) werden hungrig; rasend vor Hunger jagen sie das schwächste Wesen in der Nähe.
// Brennende Lagerfeuer verscheuchen Tiere, die nicht rasen (z.fear).

const C = require('../config');
const { TAU, clamp, rand, dist, uid, levelOf } = require('./util');
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const { pushOutOfCircle } = require('./geometry');

module.exports = {
  // ---------- Spawnen ----------

  spawnZombie(type, x, y) {
    const def = C.ENEMIES[type], S = C.SPAWN, day = this.day;
    const hp = def.hp * (1 + S.hpScale * (day - 1));
    const z = {
      id: uid(), kind: 'z', type, ai: def.ai, x, y, r: def.r, br: def.r, angle: 0,
      hp, maxHp: hp,
      speed: def.speed * rand(0.9, 1.1), // nachts kommt nightSpeed dazu (siehe nightFactor)
      dmg: def.dmg * (1 + 0.08 * (day - 1)), // Schaden an Spielern
      sdmg: def.sdmg * (1 + 0.1 * (day - 1)), // Schaden an Gebäuden
      atkCd: 0, spikeCd: 0, attacks: 0,
      target: null, retarget: 0, wanderA: rand(0, TAU), angryAt: 0, angryUntil: 0,
      targetVisible: true, seenX: x, seenY: y, seenAt: -99, // letzte bekannte Position des Ziels
      windup: 0, windupTarget: null, // laufender Schlag (siehe ENEMY_ATTACK)
      nightSpawn: this.isNight && def.ai === 'zombie', // zerfällt im Morgengrauen
      burning: false,
    };
    this.zombies.set(z.id, z);
    this.zgrid.insert(z); // sofort auffindbar, nicht erst ab dem nächsten Tick
    return z;
  },

  // Rund um jeden Spieler Gegner nachliefern (nachts mehr und öfter)
  spawnZombies(dt) {
    const S = C.SPAWN, day = this.day;
    for (const p of this.players.values()) {
      if (p.dead || this.zombies.size >= S.maxTotal || this.isProtected(p)) continue;
      const night = this.isNight && !this.isCalm(p); // ruhige erste Nacht: Spawns wie am Tag
      p.spawnCd -= dt;
      if (p.spawnCd > 0) continue;
      p.spawnCd = (night ? S.nightInterval : S.dayInterval) * rand(0.7, 1.3);

      const wanted = night ? S.nightBase + day * S.nightPerDay : S.dayBase + Math.floor(day / 2);
      if (this.countZombiesNear(p, 1500) >= wanted) continue;

      for (let tries = 0; tries < 10; tries++) {
        const a = rand(0, TAU), d = rand(850, 1150);
        const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
        if (x < 50 || y < 50 || x > C.WORLD_SIZE - 50 || y > C.WORLD_SIZE - 50) continue;
        if (!this.isFree(x, y, 40) || this.tooCloseToPlayersOrBases(x, y)) continue;
        const type = this.pickEnemyType(night, day, (t) => this.canSpawnAnimal(t, x, y));
        this.spawnGroup(type, x, y);
        break;
      }
    }
  },

  // Einzelner Gegner – oder ein ganzes Rudel. Raubtiere und Rudeltiere bekommen ein gemeinsames Rudel-Objekt.
  spawnGroup(type, x, y) {
    const def = C.ENEMIES[type];
    const n = def.pack ? randInt(def.pack[0], def.pack[1]) : 1;
    const pack = def.pack || def.predator ? this.newPack(type) : null;
    for (let i = 0; i < n; i++) {
      const z = this.spawnZombie(type, x + rand(-40, 40), y + rand(-40, 40));
      if (pack) this.joinPack(z, pack);
    }
    return pack;
  },

  newPack(type) {
    const P = C.ENEMIES[type].predator;
    return {
      id: uid(), type, leader: null, members: new Set(),
      hunger: P ? rand(0.4, 1) : 1, rate: P ? 1 / rand(P.hungerTime[0], P.hungerTime[1]) : 0, raging: false,
      fleeUntil: 0, fleeX: 0, fleeY: 0, // nach dem Tod des Alphas: weg von dieser Stelle
    };
  },

  // Der Erste wird Alpha (stärker & größer laut ENEMIES[*].alpha), die anderen suchen sich einen Platz um ihn herum
  joinPack(z, pack) {
    z.pack = pack;
    pack.members.add(z);
    if (!pack.leader) {
      pack.leader = z;
      z.alpha = true;
      const a = C.ENEMIES[z.type].alpha;
      if (a) {
        z.hp *= a.hp; z.maxHp *= a.hp; z.dmg *= a.dmg; z.sdmg *= a.dmg;
        z.r = z.br = Math.round(z.r * a.r);
      }
      return;
    }
    z.slotA = rand(0, TAU);
    z.slotD = rand(70, 170);
  },

  // Aus dem Rudel austreten (tot oder verschwunden). Stirbt der Alpha, übernimmt der Stärkste –
  // mit dem Fell des Alphas, aber ohne dessen Kraft – und das Rudel flieht kurz.
  leavePack(z, killed) {
    const pack = z.pack;
    if (!pack) return;
    pack.members.delete(z);
    z.pack = null;
    if (pack.leader !== z) return;
    pack.leader = null;
    let best = null;
    for (const m of pack.members) if (!best || m.hp > best.hp) best = m;
    if (!best) return;
    pack.leader = best;
    best.alpha = true;
    best.target = null;
    if (killed && pack.members.size) {
      pack.fleeUntil = this.now + C.WILDLIFE.alphaFlee;
      pack.fleeX = z.x;
      pack.fleeY = z.y;
    }
  },

  // Gegner aus der Welt nehmen (killed: getötet, nicht nur verschwunden)
  removeZombie(z, killed = false) {
    this.zombies.delete(z.id);
    this.leavePack(z, killed);
  },

  // Raubtier frisst: Hunger steigt um amount; ab calm ist die Raserei vorbei
  feedPredator(z, amount) {
    const pack = z.pack, P = C.ENEMIES[z.type].predator;
    if (!pack || !P) return;
    pack.hunger = Math.min(1, pack.hunger + amount);
    if (pack.hunger >= P.calm) pack.raging = false;
  },

  // Hunger sinkt (einmal pro Rudel, beim Alpha); leer = rasend
  updateHunger(pack, dt) {
    if (!pack.rate) return;
    pack.hunger = Math.max(0, pack.hunger - pack.rate * dt);
    if (pack.hunger <= 0) pack.raging = true;
  },

  // Darf hier ein Tier dieser Art spawnen? (Lebensraum und Obergrenze; Rudel zählen einmal)
  canSpawnAnimal(type, x, y) {
    const def = C.ENEMIES[type];
    if (def.habitat && !def.habitat.includes(this.world.biomeAt(x, y))) return false;
    if (!def.cap) return true;
    const R = C.WILDLIFE.capRadius;
    let near = 0, total = 0;
    for (const z of this.zombies.values()) {
      if (z.type !== type || (z.pack && z.pack.leader !== z)) continue;
      total++;
      if (Math.abs(z.x - x) < R && Math.abs(z.y - y) < R) near++;
    }
    return near < def.cap.near && total < def.cap.perPlayer * Math.max(1, this.players.size);
  },

  countZombiesNear(center, range) {
    let n = 0;
    for (const z of this.zombies.values()) if (Math.abs(z.x - center.x) < range && Math.abs(z.y - center.y) < range) n++;
    return n;
  },

  // Städte sind gefährlich: dort laufen Zombies herum, sobald Spieler in der Nähe sind
  spawnCityZombies(dt) {
    const M = C.MAP, day = this.day, night = this.isNight;
    for (const city of this.world.cities) {
      if (this.zombies.size >= C.SPAWN.maxTotal) return;
      city.spawnCd = (city.spawnCd || 0) - dt;
      if (city.spawnCd > 0) continue;
      city.spawnCd = rand(1.5, 2.5);
      const visitors = [...this.players.values()].filter((p) => !p.dead && Math.hypot(p.x - city.x, p.y - city.y) < city.r + 1300);
      if (!visitors.length) continue;

      let inCity = 0;
      for (const z of this.zombies.values()) if (z.ai === 'zombie' && Math.hypot(z.x - city.x, z.y - city.y) < city.r) inCity++;
      const wanted = Math.round((M.cityZombies + M.cityZombiesPerDay * (day - 1)) * (night ? 1.5 : 1));
      if (inCity >= wanted) continue;

      for (let tries = 0; tries < 8; tries++) {
        const a = rand(0, TAU), d = Math.sqrt(Math.random()) * city.r * 0.9;
        const x = city.x + Math.cos(a) * d, y = city.y + Math.sin(a) * d;
        if (!this.isFree(x, y, 30) || visitors.some((p) => Math.hypot(p.x - x, p.y - y) < 450)) continue;
        let type = this.pickEnemyType(night, day);
        if (C.ENEMIES[type].ai !== 'zombie') type = 'normal'; // in Städten nur Zombies
        this.spawnZombie(type, x, y);
        break;
      }
    }
  },

  tooCloseToPlayersOrBases(x, y) {
    for (const p of this.players.values()) if (!p.dead && Math.hypot(p.x - x, p.y - y) < 700) return true;
    for (const core of this.cores) if (Math.hypot(core.x - x, core.y - y) < levelOf(core).radius + 150) return true;
    return false;
  },

  // Gewichtete Zufallswahl laut ENEMIES[*].spawn; allow(type) = false schließt einen Typ aus
  pickEnemyType(night, day, allow) {
    const weights = Object.entries(C.ENEMIES).map(([type, def]) => {
      const sp = def.spawn;
      let w = (night ? sp.night : sp.day) || 0;
      if (w > 0 && allow && !allow(type)) w = 0;
      if (w > 0 && sp.perDay) w = Math.min(sp.max || Infinity, w + sp.perDay * (day - 1));
      return [type, w];
    });
    let roll = Math.random() * weights.reduce((sum, [, w]) => sum + w, 0);
    for (const [type, w] of weights) if ((roll -= w) < 0) return type;
    return 'normal';
  },

  // ---------- Zielwahl ----------

  isAlive(target) {
    if (target.kind === 'p') return this.players.has(target.id) && !target.dead;
    if (target.kind === 'z') return this.zombies.has(target.id);
    return this.structures.has(target.id);
  },

  // Gegner weit weg von allen Spielern und Basen verschwinden (z.far)
  findZombieTarget(z) {
    const def = C.ENEMIES[z.type];
    let nearestAny = Infinity;
    for (const p of this.players.values()) if (!p.dead) nearestAny = Math.min(nearestAny, dist(z, p));
    for (const core of this.cores) nearestAny = Math.min(nearestAny, dist(z, core));
    z.far = nearestAny > 2300;

    // Wer angegriffen wurde, verfolgt seinen Angreifer (alle Typen) – er weiß, woher der Schlag kam
    z.targetVisible = true;
    const attacker = this.players.get(z.angryAt);
    if (attacker && !attacker.dead && !this.isProtected(attacker) && this.now < z.angryUntil && dist(z, attacker) < (def.leash || 900)) return attacker;
    // Von einem Tier gebissen: zurückschlagen (Wildschweine fliehen stattdessen, siehe updateZombie)
    if (z.ai !== 'neutral' && this.biter(z)) return z.foe;
    if (z.ai === 'neutral') return null;

    // Rudel: Folger übernehmen das Ziel ihres Alphas
    const pack = z.pack, leader = pack && pack.leader !== z ? pack.leader : null;
    if (leader && leader.target && leader.targetVisible && this.isAlive(leader.target)) return leader.target;
    // Rasend vor Hunger: das schwächste Wesen, das man sieht
    if (pack && pack.raging) {
      const prey = this.findPrey(z, def.predator);
      if (prey) return prey;
    }
    // Satte Tiere am brennenden Lagerfeuer jagen nicht
    if (z.fear) return null;

    // Spieler werden nur entdeckt, wenn der Gegner sie sehen kann
    const t = z.target, huntable = (p) => p.kind === 'p' && this.players.has(p.id) && !p.dead && !this.isProtected(p);
    const sees = (p) => {
      if (!this.seesBody(z.x, z.y, p)) return false;
      z.seenX = p.x; z.seenY = p.y; z.seenAt = this.now; // letzte bekannte Position
      return true;
    };
    // Revier-Tiere halten ihr Ziel bis zur Leine, greifen aber nur in der Nähe an
    if (z.ai === 'territorial' && t && huntable(t) && dist(z, t) < def.leash && sees(t)) return t;

    const aggro = def.aggro || (this.isNight ? C.SPAWN.nightAggro : C.SPAWN.dayAggro);
    let best = null, bestD = Infinity;
    for (const p of this.players.values()) {
      if (p.dead || this.isProtected(p)) continue;
      const d = dist(z, p);
      if (d < aggro * (p.stats.noise || 1) && d < bestD && sees(p)) { best = p; bestD = d; }
    }
    // Ziel hinter Deckung verschwunden: noch eine Weile zur letzten bekannten Position laufen
    if (!best && t && huntable(t) && this.now - z.seenAt < C.SIGHT.memory && dist(z, t) < (def.leash || aggro * 1.5)) {
      z.targetVisible = false;
      return t;
    }
    // Ein Folger hat etwas entdeckt: der Alpha (und damit das ganze Rudel) greift an
    if (best && leader && !leader.target) { leader.target = best; leader.targetVisible = true; }
    return best;
  },

  // Wer hat z zuletzt gebissen (und lebt noch, ist nah genug, die Wut ist nicht verflogen)?
  biter(z) {
    const foe = z.foe;
    return !!foe && this.zombies.has(foe.id) && this.now < z.foeUntil && dist(z, foe) < 900;
  },

  // Beute für ein rasendes Raubtier: das schwächste Wesen (wenigste Lebenspunkte) im Umkreis, das es sieht –
  // Spieler, Zombies, andere Tiere, aber nie die eigene Art. Sichtprüfungen nur für die schwächsten Kandidaten.
  findPrey(z, P) {
    const range = P.range, candidates = [];
    for (const o of this.zgrid.query(z.x, z.y, range)) {
      if (o !== z && o.type !== z.type && this.zombies.has(o.id) && dist(z, o) < range) candidates.push(o);
    }
    for (const p of this.players.values()) if (!p.dead && !this.isProtected(p) && dist(z, p) < range) candidates.push(p);
    candidates.sort((a, b) => a.hp - b.hp);
    for (const c of candidates.slice(0, 8)) {
      if (!this.seesBody(z.x, z.y, c)) continue;
      if (c.kind === 'p') { z.seenX = c.x; z.seenY = c.y; z.seenAt = this.now; }
      return c;
    }
    return null;
  },

  // Brennendes Lagerfeuer oder Spieler mit Fackel in der Nähe (verscheucht Tiere) – oder null
  burningFireNear(z) {
    const R = C.WILDLIFE.fireScare;
    for (const o of this.statics.query(z.x, z.y, R)) {
      if (o.kind === 's' && o.type === 'campfire' && o.active && Math.hypot(o.x - z.x, o.y - z.y) < R) return o;
    }
    const T = C.WILDLIFE.torchScare;
    for (const p of this.players.values()) {
      if (!p.dead && p.equip.weapon === 'torch' && Math.hypot(p.x - z.x, p.y - z.y) < T) return p;
    }
    return null;
  },

  // Nachts sind Untote wilder: Faktor für Tempo, Schaden oder Schlagrate (1 für Tiere und tagsüber)
  nightFactor(z, factor) {
    return z.ai === 'zombie' && this.isNight ? factor : 1;
  },

  // ---------- Bewegung & Angriff ----------

  updateZombie(z, dt) {
    if (z.burning && !this.burnZombie(z, dt)) return;
    z.atkCd -= dt;
    z.spikeCd -= dt;
    z.retarget -= dt;
    const pack = z.pack;
    if (pack && pack.leader === z) this.updateHunger(pack, dt);
    if (z.retarget <= 0 || (z.target && !this.isAlive(z.target))) {
      z.retarget = 0.5 + Math.random() * 0.2;
      // Tiere meiden brennende Lagerfeuer – außer sie rasen vor Hunger
      z.fear = z.ai !== 'zombie' && !(pack && pack.raging) ? this.burningFireNear(z) : null;
      z.target = this.findZombieTarget(z);
      if (z.far) { this.removeZombie(z); return; }
    }

    // Ziel ansteuern, fliehen, dem Alpha folgen oder langsam umherwandern
    let tx, ty, speed = z.speed * this.nightFactor(z, C.SPAWN.nightSpeed), moving = true;
    if (pack && pack.raging) speed *= C.ENEMIES[z.type].predator.rageSpeed || 1; // Hunger treibt an
    const away = (fx, fy) => { const a = Math.atan2(z.y - fy, z.x - fx); tx = z.x + Math.cos(a) * 100; ty = z.y + Math.sin(a) * 100; };
    if (pack && this.now < pack.fleeUntil) {
      // Alpha gefallen: das Rudel stiebt auseinander
      z.target = null;
      away(pack.fleeX, pack.fleeY);
    } else if (z.ai === 'neutral' && this.biter(z) && !z.target) {
      away(z.foe.x, z.foe.y); // Wildschwein flieht vor dem Raubtier
    } else if (z.fear && !z.target) {
      away(z.fear.x, z.fear.y);
      speed *= 0.8;
    } else if (z.target && !z.targetVisible) {
      // Spieler versteckt sich: zur letzten bekannten Position; dort angekommen, aufgeben
      tx = z.seenX;
      ty = z.seenY;
      if (Math.hypot(tx - z.x, ty - z.y) < z.r + 10) { z.target = null; z.retarget = 0.3; }
    } else if (z.target) {
      tx = z.target.x;
      ty = z.target.y;
    }
    if (tx === undefined) {
      const leader = pack && pack.leader !== z ? pack.leader : null;
      if (leader) {
        // Folger: eigener Platz um den Alpha, der langsam mitwandert; nah dran bleiben sie stehen
        z.slotA += dt * 0.15;
        tx = leader.x + Math.cos(z.slotA) * z.slotD;
        ty = leader.y + Math.sin(z.slotA) * z.slotD;
        const gap = Math.hypot(tx - z.x, ty - z.y);
        speed *= gap > 260 ? 1 : gap > 50 ? 0.45 : 0;
        moving = gap > 50;
      } else {
        if (Math.random() < dt * 0.4) z.wanderA += rand(-1.5, 1.5);
        tx = z.x + Math.cos(z.wanderA) * 100;
        ty = z.y + Math.sin(z.wanderA) * 100;
        speed *= 0.35;
      }
    }
    const dx = tx - z.x, dy = ty - z.y, d = Math.hypot(dx, dy);
    if (moving && d > 1) z.angle = Math.atan2(dy, dx);
    // Berührt wird nur ein Ziel (Spieler oder bei Raubtieren ein anderes Wesen), das der Gegner sieht –
    // gemessen an seiner echten Position (nicht an der letzten bekannten, zu der er gerade läuft)
    const target = z.target;
    const touching = !!target && (target.kind === 'p' || target.kind === 'z') && z.targetVisible &&
      Math.hypot(target.x - z.x, target.y - z.y) < z.r + target.r + 10;
    if (!touching && moving && d > 1) {
      z.x += (dx / d) * speed * dt;
      z.y += (dy / d) * speed * dt;
    }

    this.separateZombies(z);
    for (const p of this.players.values()) if (!p.dead) pushOutOfCircle(z, p.x, p.y, p.r);

    // Gebäude blockieren; das Ziel (oder irgendein berührtes Gebäude) wird angegriffen, Stacheln verletzen
    let blocker = null;
    this.collideStatics(z, (s) => !C.STRUCTURES[s.type].walkable, (s) => {
      if (!blocker || s === z.target) blocker = s;
      if (s.type === 'spike' && z.spikeCd <= 0) {
        z.spikeCd = 0.6;
        this.damageZombie(z, levelOf(s).dmg, s.owner);
      }
    });
    if (!this.zombies.has(z.id)) return; // an Stacheln gestorben
    z.x = clamp(z.x, z.r, C.WORLD_SIZE - z.r);
    z.y = clamp(z.y, z.r, C.WORLD_SIZE - z.r);

    if (this.updateWindup(z, dt) || z.atkCd > 0) return;
    if (touching) {
      // Ausholen beginnt (der Client zeigt jetzt den Vorstoß); getroffen wird erst danach
      z.windup = C.ENEMY_ATTACK.windup;
      z.windupTarget = target;
      z.atkCd = 1 / this.nightFactor(z, C.SPAWN.nightAttackSpeed);
      z.attacks++;
    } else if (blocker && z.sdmg > 0) {
      // Mit Ziel wird eingeschlagen, was im Weg steht; ohne Ziel nur selten – meist dreht der Gegner ab.
      // Rasend hungrige Tiere wollen Fleisch, keine Mauern: sie drehen immer ab.
      z.atkCd = 1;
      const hungry = pack && pack.raging;
      if (!hungry && (z.target || Math.random() < C.ENEMY_ATTACK.idleStructureChance)) {
        this.damageStructure(blocker, z.sdmg);
        z.attacks++;
      } else {
        z.wanderA = Math.atan2(z.y - blocker.y, z.x - blocker.x) + rand(-1, 1);
      }
    }
  },

  // Laufender Schlag: am Ende trifft er, wenn das Ziel noch in Reichweite ist. true = Gegner ist beschäftigt.
  // Raubtiere werden von jedem Biss etwas satter, von einer erlegten Beute ganz.
  updateWindup(z, dt) {
    if (z.windup <= 0) return false;
    z.windup -= dt;
    if (z.windup > 0) return true;
    const t = z.windupTarget;
    z.windupTarget = null;
    if (!t || !this.isAlive(t) || Math.hypot(t.x - z.x, t.y - z.y) >= z.r + t.r + C.ENEMY_ATTACK.reach) return true;
    const dmg = z.dmg * this.nightFactor(z, C.SPAWN.nightDamage), P = C.ENEMIES[z.type].predator;
    const killed = t.kind === 'p' ? this.damagePlayer(t, dmg) : this.damageZombie(t, dmg, 0, z);
    if (P) this.feedPredator(z, killed ? 1 : P.bite);
    return true;
  },

  // ---------- Morgengrauen & Aufräumen ----------

  // Steht (x, y) im Sichtfeld irgendeines Spielers? (wie beim Senden, mit Rand)
  inAnyView(x, y) {
    const halfW = C.VIEW.w / 2 + 250, halfH = C.VIEW.h / 2 + 250;
    for (const p of this.players.values()) if (Math.abs(p.x - x) < halfW && Math.abs(p.y - y) < halfH) return true;
    return false;
  },

  // Kämpft der Gegner gerade? (Ziel-Spieler in der Nähe oder kürzlich angegriffen)
  isEngaged(z) {
    if (this.now < z.angryUntil) return true;
    const t = z.target;
    return !!t && t.kind === 'p' && z.targetVisible && Math.hypot(t.x - z.x, t.y - z.y) < 500;
  },

  // Gegner leise entfernen (keine Beute, keine Punkte)
  vanishZombie(z, burnt) {
    this.removeZombie(z);
    if (burnt) this.events.push([Math.round(z.x), Math.round(z.y), 'burn']);
  },

  // Sonnenaufgang: Nacht-Untote außer Sicht verschwinden sofort, die anderen beginnen zu zerfallen
  startDawn() {
    for (const z of [...this.zombies.values()]) {
      if (!z.nightSpawn) continue;
      if (!this.inAnyView(z.x, z.y) && !this.isEngaged(z)) this.vanishZombie(z, false);
      else z.burning = true;
    }
  },

  // Zerfall pro Tick. false = der Gegner ist zerfallen
  burnZombie(z, dt) {
    if (this.isEngaged(z)) return true; // kämpft noch – Zerfall pausiert
    z.hp -= (z.maxHp / C.SPAWN.dawnBurn) * dt;
    if (z.hp > 0) return true;
    this.vanishZombie(z, true);
    return false;
  },

  // Überzählige Gegner um Spieler abbauen (z. B. nach einem Lockruf oder dem Ende der Nacht)
  cleanupZombies(dt) {
    const S = C.SPAWN;
    this.cleanupT -= dt;
    if (this.cleanupT > 0) return;
    this.cleanupT = S.cleanupInterval;
    for (const p of this.players.values()) {
      const night = this.isNight && !this.isCalm(p);
      const wanted = (night ? S.nightBase + this.day * S.nightPerDay : S.dayBase + Math.floor(this.day / 2)) + S.cleanupSlack;
      // Nur Untote – Tiere haben ihre eigene Obergrenze (ENEMIES[*].cap) und Rudel bleiben ganz
      const near = [...this.zombies.values()].filter((z) => z.ai === 'zombie' && Math.abs(z.x - p.x) < 1500 && Math.abs(z.y - p.y) < 1500);
      if (near.length <= wanted) continue;
      // Nur untätige Gegner außerhalb jedes Sichtfelds und nicht in Städten (die haben ihren eigenen Bestand) –
      // die entferntesten zuerst
      const removable = near
        .filter((z) => !this.isEngaged(z) && !this.inAnyView(z.x, z.y) && !this.cityAt(z.x, z.y))
        .sort((a, b) => Math.hypot(b.x - p.x, b.y - p.y) - Math.hypot(a.x - p.x, a.y - p.y));
      for (const z of removable.slice(0, Math.min(S.cleanupPerPass, near.length - wanted))) this.vanishZombie(z, false);
    }
  },

  // Gegner schieben sich gegenseitig auseinander, damit sie nicht übereinander stehen
  separateZombies(z) {
    for (const o of this.zgrid.query(z.x, z.y, z.r * 2 + 10)) {
      if (o === z) continue;
      const ox = z.x - o.x, oy = z.y - o.y, min = z.r + o.r, d2 = ox * ox + oy * oy;
      if (d2 >= min * min || d2 <= 0.01) continue;
      const d = Math.sqrt(d2), push = (min - d) * 0.5;
      z.x += (ox / d) * push; z.y += (oy / d) * push;
      o.x -= (ox / d) * push; o.y -= (oy / d) * push;
    }
  },
};
