'use strict';
// Die Spielsimulation. Der Server ist autoritativ: Clients schicken nur Eingaben,
// alles andere wird hier berechnet.
//
// Die Logik ist nach Themen auf server/game/*.js verteilt. Jede Datei liefert Methoden,
// die unten in die Klasse Game eingemischt werden – überall ist `this` also das Spiel.
//
//   resources.js    Welt, Ressourcen abbauen & nachwachsen
//   players.js      Verbindung, Login, Spawnen, Bewegung, Erfahrung
//   persistence.js  Speichern & Laden (Charaktere, Basen)
//   items.js        Inventar, Items am Boden, Hotbar, Ausrüstung, Herstellen
//   building.js     Gebäude bauen, upgraden, zerstören; Türme & Minen
//   storage.js      Truhen, Kern-Lager, Schmelzofen, Unterhalt & Verfall
//   combat.js       Schläge, Schüsse, Projektile, Schaden
//   enemies.js      Gegner spawnen, Zielwahl, Bewegung
//   sight.js        Sichtlinien (Deckung hinter Bäumen, Felsen, Mauern)
//   practice.js     Fähigkeiten durch Übung (Laufen, Holzfällen, Schießen …)
//   gear.js         Ausrüstung als Einzelstücke: Seltenheit, Boni, Verbessern, Umschmieden, Zerlegen
//   social.js       Teams & Chat
//   network.js      Nachrichten annehmen, Zustand senden

const C = require('./config');
const { Grid } = require('./game/geometry');

class Game {
  // opts.db: Db-Instanz (server/db.js) für Accounts & Speichern; ohne db gibt es nur Gäste
  constructor(opts = {}) {
    this.db = opts.db || null;

    // Alles, was in der Welt existiert
    this.players = new Map();
    this.zombies = new Map();
    this.structures = new Map();
    this.structuresByOwner = new Map(); // Spieler-ID -> Set seiner Gebäude (auch offline)
    this.cores = new Set(); // alle Basis-Kerne
    this.items = new Map(); // Items am Boden
    this.teams = new Map(); // id -> { id, name, leader, members: [Spieler-IDs] }
    this.resources = [];
    this.projectiles = [];

    // Räumliche Raster für schnelle Nachbarschaftsabfragen
    this.statics = new Grid(200); // Ressourcen, Seen, Ruinen, Gebäude
    this.zgrid = new Grid(150); // Gegner (jedes Tick neu aufgebaut)
    this.itemGrid = new Grid(200); // Items am Boden

    // Was sich seit der letzten Sendung geändert hat
    this.events = [];
    this.resPending = []; // { type, at, pos } – nachwachsende Ressourcen
    this.resChanged = new Map(); // id -> Restanteil
    this.resAdded = [];
    this.resRemoved = [];

    // Zeit: time = Weltzeit (Tag/Nacht), now = Sekunden seit Serverstart
    this.cycle = C.DAY_LENGTH + C.NIGHT_LENGTH;
    this.time = C.DAY_LENGTH * 0.1;
    this.now = 0;
    this.tick = 0; // Anzahl Simulationsschritte (Zeitstempel für die Clients)
    if (this.db) {
      const saved = +this.db.getMeta('time');
      if (saved > 0) this.time = saved; // Tageszahl & Spawnschutz-Zeiten laufen über Neustarts weiter
    }

    // Zeitgeber
    this.sendTick = 0; // zählt Sendungen (für den Sicht-Zwischenspeicher)
    this.tickStats = { n: 0, sum: 0, max: 0 }; // Rechenzeit pro Tick (für die F3-Anzeige)
    this.lbTimer = 0;
    this.lbDirty = true;
    this.saveT = 0;
    this.upkeepDisplayT = 0;
    this.cleanupT = 0;
    this.savedOwners = new Set(); // Account-IDs, deren Basis zuletzt gespeichert wurde

    this.genWorld();
    this.loadBases();
  }

  get day() { return Math.floor(this.time / this.cycle) + 1; }
  get isNight() { return this.time % this.cycle >= C.DAY_LENGTH; }

  // Ein Simulationsschritt
  update(dt) {
    const wasNight = this.isNight;
    this.time += dt;
    this.now += dt;
    this.tick++;
    if (this.isNight !== wasNight) {
      this.broadcastMsg(this.isNight
        ? `Nacht ${this.day} bricht herein – die Untoten werden schneller, aggressiver und zahlreicher!`
        : `Tag ${this.day} – du hast die Nacht überlebt! Die Untoten der Nacht zerfallen im Morgenlicht.`);
      if (!this.isNight) this.startDawn();
    }

    this.zgrid.clear();
    for (const z of this.zombies.values()) this.zgrid.insert(z);

    for (const p of this.players.values()) this.updatePlayer(p, dt);
    this.spawnZombies(dt);
    this.spawnCityZombies(dt);
    for (const z of [...this.zombies.values()]) this.updateZombie(z, dt);
    for (const s of [...this.structures.values()]) this.updateStructure(s, dt);
    this.cleanupZombies(dt);
    this.updateUpkeep(dt);
    this.updateProjectiles(dt);
    this.updateGroundItems();
    this.updateResources();
    this.autosave(dt);
  }

  autosave(dt) {
    if (!this.db) return;
    this.saveT += dt;
    if (this.saveT < C.ACCOUNTS.autosave) return;
    this.saveT = 0;
    try { this.saveAll(); } catch (e) { console.error('Autosave fehlgeschlagen:', e); }
  }
}

for (const part of ['resources', 'players', 'persistence', 'items', 'building', 'storage', 'combat', 'enemies', 'sight', 'practice', 'gear', 'social', 'network']) {
  Object.assign(Game.prototype, require(`./game/${part}`));
}

module.exports = Game;
