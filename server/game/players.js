'use strict';
// Verbindungen, Login, Beitreten/Verlassen, Spawnen, Bewegung und Erfahrung der Spieler.

const C = require('../config');
const Inv = require('../inventory');
const { TAU, clamp, rand, uid, ACCOUNT_ID_BASE } = require('./util');
const { pushOutOfCircle, pushOutOfRect } = require('./geometry');

const NAME_RE = /^[\p{L}\p{N}_\-.]+$/u;
// Fehler mit Text für den Spieler (alles andere ist ein interner Fehler und wird nur geloggt)
const playerError = (text) => Object.assign(new Error(text), { forPlayer: true });
const MAX_MESSAGE_LENGTH = 2048;
const MAX_MESSAGES_PER_SECOND = 120; // mehr schickt kein normaler Client – Rest wird verworfen

module.exports = {
  // ---------- Verbindung & Login ----------

  onConnection(conn) {
    let player = null, authBusy = false, closed = false, lastLoginTry = 0;
    let windowStart = Date.now(), messagesInWindow = 0;
    const authError = (err) => conn.send(JSON.stringify({ t: 'auth', err }));

    conn.on('message', (raw) => {
      // Spam-Schutz: zu lange oder zu viele Nachrichten ignorieren
      if (raw.length > MAX_MESSAGE_LENGTH) return;
      if (Date.now() - windowStart > 1000) { windowStart = Date.now(); messagesInWindow = 0; }
      if (++messagesInWindow > MAX_MESSAGES_PER_SECOND) return;

      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      if (!msg || typeof msg !== 'object') return;

      if (player) {
        // Ein Fehler in einer Nachricht darf nie den ganzen Server abstürzen lassen
        try { this.handle(player, msg); } catch (e) { console.error(`Fehler bei Nachricht "${msg.t}" von ${player.name}:`, e); }
        return;
      }
      if (authBusy) return;

      if (msg.t === 'join') {
        // Gast: wird nicht gespeichert; Namen von Accounts sind für Gäste gesperrt
        const name = this.cleanName(msg.name);
        if (this.db && this.db.findAccount(name)) return authError('Dieser Name gehört zu einem Account – bitte einloggen.');
        player = this.addPlayer(conn, name);
      } else if (msg.t === 'login' || msg.t === 'register') {
        if (Date.now() - lastLoginTry < C.ACCOUNTS.loginCooldown * 1000) return authError('Bitte kurz warten.');
        lastLoginTry = Date.now();
        authBusy = true;
        this.authenticate(msg).then((acc) => {
          if (closed) return;
          if (this.players.has(ACCOUNT_ID_BASE + acc.id)) return authError('Dieser Account ist bereits im Spiel.');
          player = this.addPlayer(conn, acc.username, acc);
        }).catch((e) => {
          if (!e.forPlayer) console.error('Login fehlgeschlagen:', e);
          if (!closed) authError(e.forPlayer ? e.message : 'Login fehlgeschlagen – bitte nochmal versuchen.');
        }).finally(() => { authBusy = false; });
      }
    });

    conn.on('close', () => {
      closed = true;
      if (player) this.removePlayer(player);
    });
  },

  cleanName(name) {
    return String(name || '').replace(/[^\p{L}\p{N} _\-.!?]/gu, '').trim().slice(0, 16) || 'Überlebender';
  },

  // Login oder Registrierung prüfen; liefert { id, username } oder wirft einen Fehler mit Text für den Spieler
  async authenticate(msg) {
    const A = C.ACCOUNTS;
    if (!this.db) throw playerError('Accounts sind auf diesem Server deaktiviert – spiel als Gast.');
    const user = String(msg.user || '').trim(), pass = String(msg.pass || '');
    if (user.length < A.nameMin || user.length > A.nameMax || !NAME_RE.test(user)) {
      throw playerError(`Name: ${A.nameMin}–${A.nameMax} Zeichen (Buchstaben, Zahlen, _ - .).`);
    }
    if (pass.length < A.passMin || pass.length > A.passMax) throw playerError(`Passwort: ${A.passMin}–${A.passMax} Zeichen.`);
    if (msg.t === 'register') return this.db.register(user, pass);
    const acc = await this.db.login(user, pass);
    if (!acc) throw playerError('Name oder Passwort falsch.');
    return acc;
  },

  // ---------- Beitreten & Verlassen ----------

  addPlayer(conn, name, acc = null) {
    if (!acc) name = this.cleanName(name);
    const p = this.newPlayer(conn, name, acc);
    const saved = acc && this.db ? this.db.loadCharacter(acc.id) : null;
    if (acc) this.attachBase(p); // die Basis lief offline weiter (inkl. Unterhalt & Verfall)

    if (saved) {
      this.applySave(p, saved);
    } else {
      for (const [item, n] of Object.entries(C.PLAYER.startRes)) Inv.add(p.inv, item, n);
      for (const slot of C.EQUIP_SLOTS) p.equip[slot.id] = C.PLAYER.startEquip[slot.id] || null;
      p.hotbar[0] = p.equip.weapon;
    }
    this.computeStats(p);

    // Gespeicherte Position nur, wenn sie noch frei ist (sonst an der Basis bzw. zufällig)
    if (saved && !saved.dead && saved.hp > 0 && this.isFree(p.x, p.y, p.r + 2)) {
      p.hp = clamp(saved.hp, 1, p.maxHp);
    } else {
      p.hp = p.maxHp;
      this.placeAtSpawn(p);
    }
    this.players.set(p.id, p);
    this.lbDirty = true;
    this.sendInit(p, acc);

    if (saved) {
      this.msg(p, `Willkommen zurück, ${p.name}!${p.core ? '' : ' Deine Basis ist nicht mehr da – baue eine neue.'}`);
      if (p.core && p.core.decaying) this.msg(p, '⚠ Deine Basis verfällt! Lege Ressourcen in den Basis-Kern [F].');
      return p;
    }
    this.startSpawnProtection(p);
    this.msg(p, 'Sammle Holz & Stein und baue deinen Basis-Kern (Baumenü [B])!');
    this.msg(p, '🛡 Spawnschutz bis zur ersten Nacht – Gegner greifen dich nicht an.');
    if (acc) this.saveCharacter(p); // Account sofort mit Startausrüstung anlegen
    return p;
  },

  newPlayer(conn, name, acc) {
    const P = C.PLAYER;
    return {
      id: acc ? ACCOUNT_ID_BASE + acc.id : uid(), account: acc ? acc.id : 0, kind: 'p', conn, name,
      x: 0, y: 0, r: P.radius, br: P.radius, angle: 0,
      hp: P.hp, maxHp: P.hp, dead: false, respawnT: 0, lastHurt: -99,
      alive: 0, bestAlive: 0, // Sekunden seit dem letzten Tod und längstes Überleben bisher
      // Eingabe & Angriff
      keys: 0, attacking: false, atkCd: 0, swings: 0, inSeq: 0, inTicks: 0,
      // Ausdauer, Hunger & Durst
      stamina: P.stamina, sprinting: false, exhausted: false, sprintStop: -99,
      hunger: C.SURVIVAL.max, thirst: C.SURVIVAL.max, starveT: 0, needNote: {}, drinkT: -99,
      // Inventar & Ausrüstung
      inv: Inv.create(), equip: {}, gear: {}, stats: null, hotbar: new Array(C.HOTBAR_SIZE).fill(null), ammoPref: {},
      // Basis
      core: null, forge: null, count: 0, counts: {}, chest: 0,
      // Fortschritt
      score: 0, kills: 0, level: 1, xp: 0, sp: 0, skills: {}, practice: {}, walked: 0,
      // Team & Chat
      team: 0, invites: new Map(), chatT: -99,
      // Zeitstempel, damit Hinweise nicht spammen
      spawnCd: 3, fullMsgT: -99, eatT: -99, ammoMsgT: -99,
      protectUntil: 0, calmUntil: 0, protectNote: 2,
      lastSlow: null, // zuletzt gesendeter "langsamer" Zustand (siehe network.js)
      known: {}, // was der Client schon kennt: Gegner, Gebäude, Items (für Delta-Updates)
      dropBlocked: new Set(), // IDs selbst geworfener Items, die erst nach einem Schritt weg wieder aufhebbar sind
      sight: new Map(), // Sicht-Zwischenspeicher: Wesen-ID -> [Sendung, sichtbar]
    };
  },

  // Alles, was der Client einmalig braucht: Config, Ressourcen, Gelände
  sendInit(p, acc) {
    const cfg = {};
    for (const key of ['WORLD_SIZE', 'TILE', 'VIEW', 'PVP', 'DAY_LENGTH', 'NIGHT_LENGTH', 'PLAYER', 'AMMO', 'SKILLS', 'HOTBAR_SIZE',
      'EQUIPMENT', 'EQUIP_SLOTS', 'FORGE_TABS', 'RESOURCE_MIN_SCALE', 'INVENTORY', 'ITEMS', 'STRUCTURES', 'ENEMIES',
      'BUILD_CATEGORIES', 'MINIMAP_RANGE', 'MAP', 'TEAM', 'CHAT', 'UPKEEP',
      'RESOURCES', 'SIGHT', 'TICK_RATE', 'PRACTICE', 'SURVIVAL', 'WILDLIFE', 'GEAR', 'MODS', 'CURSES', 'MATERIALS', 'FISHING']) cfg[key] = C[key];
    const w = this.world;
    p.conn.send(JSON.stringify({
      t: 'init', id: p.id, acc: acc ? acc.username : null, cfg,
      res: this.resources.map((r) => this.resWire(r)),
      world: {
        n: w.n, G: w.G, biomes: w.biomes, lakes: w.lakes, roads: w.roads,
        cities: w.cities.map((c) => ({ x: c.x, y: c.y, r: c.r, name: c.name, buildings: c.buildings, ruins: c.ruins, streets: c.streets })),
      },
    }));
  },

  removePlayer(p) {
    this.leaveTeam(p, true);
    for (const o of this.players.values()) o.invites.delete(p.id);
    // Accounts: Charakter speichern, die Basis bleibt in der Welt. Gäste nehmen ihre Basis mit.
    if (p.account && this.db) {
      try { this.saveAll(); } catch (e) { console.error('Speichern fehlgeschlagen:', e); }
    } else {
      // Gäste nehmen alles mit – auch Lagerfeuer, die außerhalb einer Basis stehen
      for (const s of [...this.ownedBy(p.id)]) this.destroyStructure(s);
    }
    this.players.delete(p.id);
    this.lbDirty = true;
  },

  // ---------- Spawnschutz ----------

  // Geschützt bis zum nächsten Einbruch der Nacht, danach eine ruhige erste Nacht (Gegner nur wie tagsüber)
  startSpawnProtection(p) {
    const dayIndex = Math.floor(this.time / this.cycle);
    const nightStart = (this.isNight ? dayIndex + 1 : dayIndex) * this.cycle + C.DAY_LENGTH;
    p.protectUntil = nightStart;
    p.calmUntil = nightStart + C.NIGHT_LENGTH;
    p.protectNote = 0;
  },

  isProtected(p) { return !!p && this.time < p.protectUntil; },
  isCalm(p) { return !!p && this.time < p.calmUntil; },

  // Hinweise beim Wechsel der Schutzphasen
  updateProtection(p) {
    if (p.protectNote === 0 && !this.isProtected(p)) {
      p.protectNote = 1;
      this.msg(p, 'Dein Spawnschutz ist vorbei. Diese erste Nacht bleibt ruhig – nur so viele Gegner wie tagsüber.');
    } else if (p.protectNote === 1 && !this.isCalm(p)) {
      p.protectNote = 2;
      this.msg(p, 'Die Schonzeit ist vorbei – ab der nächsten Nacht werden die Untoten wild!');
    }
  },

  // ---------- Spawnen ----------

  // Zufällig in der Welt (der Kern ist kein Spawnpunkt – dafür gibt es Schlafsäcke)
  placeAtSpawn(p) {
    const W = C.WORLD_SIZE;
    for (let tries = 0; tries < 60; tries++) {
      const x = rand(200, W - 200), y = rand(200, W - 200);
      if (!this.isFree(x, y, p.r + 10) || this.cityAt(x, y, 500)) continue;
      // Möglichst weit weg von Basen und Gegnern; nach 50 Versuchen reicht ein freier Platz
      const crowded = [...this.cores].some((s) => Math.hypot(s.x - x, s.y - y) < 900) ||
        [...this.zombies.values()].some((z) => Math.hypot(z.x - x, z.y - y) < 500);
      if (crowded && tries < 50) continue;
      p.x = x;
      p.y = y;
      return;
    }
    p.x = W / 2;
    p.y = W / 2;
  },

  // Freien Platz neben einem Gebäude suchen (z. B. dem Schlafsack)
  placeNextTo(p, core) {
    for (let tries = 0; tries < 40; tries++) {
      const a = rand(0, TAU), d = Math.max(core.hw, core.hh) + p.r + 8 + Math.floor(tries / 8) * 25;
      const x = core.x + Math.cos(a) * d, y = core.y + Math.sin(a) * d;
      if (this.isFree(x, y, p.r + 2)) { p.x = x; p.y = y; return; }
    }
    p.x = core.x + core.hw + p.r + 8;
    p.y = core.y;
  },

  // Schlafsäcke des Spielers mit Wartezeit in Sekunden (0 = frei)
  sleepingBags(p) {
    const cd = C.STRUCTURES.sleeping_bag.cooldown;
    return [...this.ownedBy(p.id)].filter((s) => s.type === 'sleeping_bag')
      .map((s) => ({ s, wait: Math.max(0, Math.ceil((s.usedAt ?? -1e9) + cd - this.now)) }));
  },

  // Wahl im Todesbildschirm: Schlafsack-ID oder 0 (irgendwo in der Welt)
  chooseSpawn(p, id) {
    if (p.dead) p.spawnChoice = id || 'random';
  },

  // bag: Schlafsack, an dem man aufwacht (sonst zufällig in der Welt)
  respawn(p, bag = null) {
    p.dead = false;
    p.hp = p.maxHp;
    p.hunger = Math.max(p.hunger, C.SURVIVAL.max * C.SURVIVAL.respawnFill);
    p.thirst = Math.max(p.thirst, C.SURVIVAL.max * C.SURVIVAL.respawnFill);
    p.spawnChoice = null;
    if (bag) {
      bag.usedAt = this.now;
      this.placeNextTo(p, bag);
    } else this.placeAtSpawn(p);
  },

  // ---------- Pro Tick ----------

  updatePlayer(p, dt) {
    this.updateProtection(p);
    // Abgelaufene Team-Einladungen verwerfen
    for (const [from, at] of p.invites) if (this.now - at > C.TEAM.inviteTime || !this.players.has(from)) p.invites.delete(from);
    if (p.dead) {
      p.respawnT = Math.max(0, p.respawnT - dt);
      if (p.respawnT > 0) return;
      // Mit Schlafsäcken wartet man auf die Wahl im Todesbildschirm, ohne geht es zufällig weiter
      const bags = this.sleepingBags(p);
      if (!bags.length || p.spawnChoice === 'random') return this.respawn(p);
      const chosen = bags.find((b) => b.s.id === p.spawnChoice);
      if (chosen && !chosen.wait) this.respawn(p, chosen.s);
      return;
    }
    p.alive += dt;
    this.burnTorch(p, dt);
    this.updateFishing(p);
    this.movePlayer(p, dt);
    if (p.chest && !this.canUseChest(p, this.structures.get(p.chest))) p.chest = 0;
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
    this.updateNeeds(p, dt);
    // Leben regeneriert erst 5 s nach dem letzten Treffer – und nur, wer nicht hungert oder dürstet
    const fed = Math.min(p.hunger, p.thirst) >= C.SURVIVAL.noRegenBelow;
    if (fed && this.now - p.lastHurt > 5 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.stats.regen * this.buffFactor(p, 'regen') * dt);
  },

  // Hunger & Durst sinken (beim Sprinten schneller). Leer = jede Sekunde Schaden an der Rüstung vorbei.
  // Im Spawnschutz sinken sie nicht.
  updateNeeds(p, dt) {
    const S = C.SURVIVAL;
    if (this.isProtected(p)) return;
    const k = (p.sprinting ? S.sprintMult : 1) * p.stats.needs; // Ausrüstung kann Hunger & Durst bremsen oder beschleunigen
    p.hunger = Math.max(0, p.hunger - (S.max / S.hungerTime) * k * dt);
    p.thirst = Math.max(0, p.thirst - (S.max / S.thirstTime) * k * dt);
    this.needWarning(p, 'hunger', '🍖 Du hast Hunger – iss etwas [H].', '🍖 Du verhungerst! Iss sofort etwas [H].');
    this.needWarning(p, 'thirst', '💧 Du hast Durst – trink an einem See [F] oder aus einer Feldflasche.', '💧 Du verdurstest! Trink sofort etwas.');
    if (p.hunger > 0 && p.thirst > 0) { p.starveT = 0; return; }
    p.starveT += dt;
    if (p.starveT < 1) return;
    p.starveT -= 1;
    this.damagePlayer(p, S.starveDamage, true, p.thirst <= 0 ? 'Du bist verdurstet!' : 'Du bist verhungert!');
  },

  // Hinweis einmal beim Unterschreiten von warnAt und einmal bei 0 (wieder scharf, sobald man gegessen hat)
  needWarning(p, key, low, empty) {
    const v = p[key], note = p.needNote[key] || 0;
    if (v > C.SURVIVAL.warnAt) { p.needNote[key] = 0; return; }
    if (note < 1) { p.needNote[key] = 1; this.msg(p, low); }
    if (v <= 0 && note < 2) { p.needNote[key] = 2; this.msg(p, empty); }
  },

  // [F] am Seeufer: trinken und alle leeren Feldflaschen füllen
  drink(p) {
    const S = C.SURVIVAL;
    if (p.dead) return;
    if (p.equip.weapon === 'rod') return this.startFishing(p); // mit der Angel in der Hand wird geangelt
    if (this.now - p.drinkT < S.drinkCooldown) return;
    if (!this.nearLake(p)) return this.msg(p, 'Hier ist kein Wasser.');
    p.drinkT = this.now;
    const bottles = Inv.count(p.inv, 'bottle');
    if (bottles) { Inv.remove(p.inv, 'bottle', bottles); this.give(p, 'water', bottles, p.x, p.y); }
    if (p.thirst >= S.max && !bottles) return this.msg(p, 'Du hast keinen Durst.');
    p.thirst = Math.min(S.max, p.thirst + S.drinkAmount);
    this.events.push([Math.round(p.x), Math.round(p.y), 'drink', S.drinkAmount, p.id]);
    if (bottles) this.msg(p, `💧 ${bottles}× Feldflasche gefüllt.`);
  },

  // ---------- Fackel & Angel ----------

  // Die Fackel in der Hand brennt ab (torchLeft gilt für die gerade brennende; eine abgelegte brennt nicht weiter)
  burnTorch(p, dt) {
    if (p.equip.weapon !== 'torch') return;
    if (!(p.torchLeft > 0)) p.torchLeft = C.EQUIPMENT.torch.burn;
    p.torchLeft -= dt;
    if (p.torchLeft > 0) return;
    p.torchLeft = 0;
    p.equip.weapon = null;
    p.gear.weapon = null;
    this.computeStats(p);
    this.msg(p, '🔥 Deine Fackel ist abgebrannt.');
  },

  nearLake(p, extra = 0) {
    return this.world.lakes.some(([x, y, r]) => Math.hypot(p.x - x, p.y - y) < r + C.SURVIVAL.drinkRange + extra);
  },

  // Mit der Angel am Ufer [F]: nach FISHING.wait Sekunden beißt etwas an. Bewegen oder Zuschlagen bricht ab.
  startFishing(p) {
    if (p.fishing) return;
    if (!this.nearLake(p)) return this.msg(p, 'Zum Angeln musst du am Seeufer stehen.');
    const [a, b] = C.FISHING.wait;
    p.fishing = { start: this.now, until: this.now + a + Math.random() * (b - a) };
    this.msg(p, '🎣 Angel ausgeworfen – stillhalten …');
  },

  updateFishing(p) {
    const f = p.fishing;
    if (!f) return;
    if ((p.keys & 15) || p.attacking || p.equip.weapon !== 'rod') {
      p.fishing = null;
      return this.msg(p, 'Angeln abgebrochen.');
    }
    if (this.now < f.until) return;
    p.fishing = null;
    const catches = C.FISHING.catches, total = catches.reduce((s, c) => s + c.weight, 0);
    let roll = Math.random() * total, c = catches[0];
    for (const x of catches) { if ((roll -= x.weight) < 0) { c = x; break; } }
    const n = Array.isArray(c.n) ? c.n[0] + Math.floor(Math.random() * (c.n[1] - c.n[0] + 1)) : c.n;
    this.give(p, c.item, n, p.x, p.y);
    this.addXp(p, C.FISHING.xp);
    this.events.push([Math.round(p.x), Math.round(p.y), 'g', n, 0, c.item, p.id]);
    this.msg(p, c.msg || `🎣 ${n}× ${C.ITEMS.names[c.item]} gefangen!`);
  },

  // Tastenbits: 1 hoch, 2 runter, 4 links, 8 rechts, 16 sprinten
  movePlayer(p, dt) {
    const P = C.PLAYER, k = p.keys;
    p.inTicks++;
    const mx = (k & 8 ? 1 : 0) - (k & 4 ? 1 : 0), my = (k & 2 ? 1 : 0) - (k & 1 ? 1 : 0);
    const moving = mx !== 0 || my !== 0;

    // Sprinten kostet Ausdauer; leer = erschöpft, bis wieder exhaustedUntil erreicht ist
    p.sprinting = moving && (k & 16) !== 0 && !p.exhausted && p.stamina > 0;
    if (p.sprinting) {
      // Übung im Laufen und Ausrüstungs-Boni sparen Ausdauer
      const cost = P.sprintCost * Math.max(0.3, 1 + this.practiceBonus(p, 'sprintCost') + p.stats.sprintCost);
      p.stamina = Math.max(0, p.stamina - cost * dt);
      p.sprintStop = this.now;
      if (p.stamina <= 0) p.exhausted = true;
    } else if (this.now - p.sprintStop > P.staminaDelay) {
      p.stamina = Math.min(p.stats.stamina, p.stamina + P.staminaRegen * this.buffFactor(p, 'staminaRegen') * dt);
    }
    if (p.exhausted && p.stamina >= P.exhaustedUntil) p.exhausted = false;

    if (moving) {
      const len = Math.hypot(mx, my), speed = p.stats.speed * (p.sprinting ? P.sprintMult : 1);
      p.x += (mx / len) * speed * dt;
      p.y += (my / len) * speed * dt;
      this.trackRunning(p, speed * dt);
    }
    // Gebäude sind massiv; nur Türen des eigenen Teams lassen durch
    this.collideStatics(p, (s) => !C.STRUCTURES[s.type].walkable && !(C.STRUCTURES[s.type].passOwner && this.allied(p, s.owner)));
    p.x = clamp(p.x, p.r, C.WORLD_SIZE - p.r);
    p.y = clamp(p.y, p.r, C.WORLD_SIZE - p.r);
  },

  // Aus allem Festen herausschieben. blocksMe(s) entscheidet bei Gebäuden; onTouch(s) meldet berührte Gebäude.
  // Gegner prallen an Ressourcen mit enemySolid ab (Bäume: fast die ganze Krone).
  collideStatics(e, blocksMe, onTouch) {
    const enemy = e.kind === 'z';
    for (const o of this.statics.query(e.x, e.y, e.r + 90)) {
      if (enemy && o.kind === 'res') {
        const def = C.RESOURCES[o.type], k = def.enemySolid || def.solid;
        if (k) pushOutOfCircle(e, o.x, o.y, o.r * k);
      } else if (o.cr !== undefined) {
        if (o.cr) pushOutOfCircle(e, o.x, o.y, o.cr); // Ressource oder See (Büsche & Gemüse: cr 0, begehbar)
      }
      else if (o.kind === 'ruin') pushOutOfRect(e, o);
      else if (blocksMe(o) && pushOutOfRect(e, o) && onTouch) onTouch(o);
    }
  },

  // ---------- Erfahrung & Fertigkeiten ----------

  xpNeeded(level) {
    return Math.round(C.XP.base * level ** C.XP.exp);
  },

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
  },

  learnSkill(p, id) {
    const skill = C.SKILLS.find((s) => s.id === id);
    if (!skill || p.sp <= 0) return;
    const rank = p.skills[id] || 0;
    if (rank >= skill.max) return this.msg(p, `${skill.name} ist schon auf Maximum.`);
    p.skills[id] = rank + 1;
    p.sp--;
    const hpFrac = p.hp / p.maxHp;
    this.computeStats(p);
    // Mehr Max-Leben füllt den Zuwachs direkt auf
    if (skill.per.maxHp) p.hp = Math.min(p.maxHp, hpFrac * p.maxHp + skill.per.maxHp);
  },
};
