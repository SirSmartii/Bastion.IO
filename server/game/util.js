'use strict';
// Kleine Helfer, die überall in der Spiellogik gebraucht werden.

const C = require('../config');

const TAU = Math.PI * 2;

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
const rand = (min, max) => min + Math.random() * (max - min);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Fortlaufende IDs für alles, was in der Welt existiert (Gegner, Gebäude, Items, Ressourcen, Gäste)
let nextId = 1;
const uid = () => nextId++;

// Spieler mit Account haben eine feste ID (ACCOUNT_ID_BASE + Account-ID), damit ihre Basen
// über Logins und Serverneustarts hinweg zugeordnet bleiben. Gäste bekommen eine uid().
const ACCOUNT_ID_BASE = 1e9;

// Nachschlagen in Config-Tabellen nur über eigene Schlüssel. Sonst würden Nachrichten wie
// { type: '__proto__' } oder { id: 'constructor' } eingebaute Objekt-Eigenschaften treffen.
const lookup = (table, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);

// Werte der aktuellen Stufe eines Gebäudes (hp, Kosten, Reichweite …)
const levelOf = (s) => C.STRUCTURES[s.type].levels[s.level];

// Halbe Breite & Höhe (Welteinheiten) eines Gebäudetyps bei Drehung rot (0–3, in 90°-Schritten)
function structureHalfSize(type, rot = 0) {
  const size = C.STRUCTURES[type].size, [w, h] = Array.isArray(size) ? size : [size, size];
  const [tw, th] = rot % 2 ? [h, w] : [w, h];
  return { hw: (tw * C.TILE) / 2, hh: (th * C.TILE) / 2 };
}

module.exports = { TAU, clamp, rand, dist, uid, ACCOUNT_ID_BASE, lookup, levelOf, structureHalfSize };
