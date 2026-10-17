// Spielregeln, die der Client für Vorschau und Hinweise braucht.
// Der Server entscheidet immer selbst – hier geht es nur um eine passende Anzeige.

import { cfg, me, myId, structs } from './state.js';
import { world, resourcesIn, resScale } from './world.js';

export const canAfford = (cost) => !!me && Object.entries(cost).every(([k, v]) => (me.res[k] || 0) >= v);

// Gehört ownerId zu mir oder meinem Team?
export function isAllied(ownerId) {
  return ownerId === myId || !!(me && me.team && me.team.m.some((m) => m[0] === ownerId));
}

// Andere Teammitglieder als [id, Name, x, y, Leben, tot, Kern-x, Kern-y]
export function teammates() {
  return me && me.team ? me.team.m.filter((m) => m[0] !== myId) : [];
}

// ---------- Interaktion ----------

export function nearForge() {
  return !!me && !!me.forge && !me.dead && Math.hypot(me.forge[1] - me.x, me.forge[2] - me.y) <= cfg.STRUCTURES.forge.useRange;
}

const CONTAINERS = ['storage', 'furnace', 'core', 'campfire', 'tanner'];

// Steht man am Seeufer (zum Trinken)?
export function nearWater() {
  if (!me || me.dead) return null;
  return world.lakes.find(([x, y, r]) => Math.hypot(me.x - x, me.y - y) < r + cfg.SURVIVAL.drinkRange - 5) || null;
}

// Nächster nutzbarer Behälter (Truhe, Ofen, Kern – eigene oder vom Team) in Reichweite: { s, d } oder null
// Steht man an einem brennenden Lagerfeuer (eigenes oder vom Team)? Nötig für Rezepte mit campfire
export function nearFire() {
  const R = cfg.STRUCTURES.campfire.useRange;
  for (const s of structs.values()) if (s.type === 'campfire' && s.active && isAllied(s.owner) && Math.hypot(s.x - me.x, s.y - me.y) <= R) return true;
  return false;
}

export function nearestContainer() {
  if (!me || me.dead) return null;
  let best = null;
  for (const s of structs.values()) {
    if (!CONTAINERS.includes(s.type) || !isAllied(s.owner)) continue;
    const d = Math.hypot(s.x - me.x, s.y - me.y);
    if (d <= cfg.STRUCTURES[s.type].useRange && (!best || d < best.d)) best = { s, d };
  }
  return best;
}

// ---------- Bauen ----------

// Halbe Breite & Höhe eines Gebäudetyps bei Drehung rot (0–3, 90°-Schritte) – wie structureHalfSize auf dem Server
export function structSize(type, rot = 0) {
  const size = cfg.STRUCTURES[type].size, [w, h] = Array.isArray(size) ? size : [size, size];
  const [tw, th] = rot % 2 ? [h, w] : [w, h];
  return { hw: (tw * cfg.TILE) / 2, hh: (th * cfg.TILE) / 2 };
}

// Auf das Raster einrasten: Mittelpunkt, halbe Breite & Höhe
export function snap(type, x, y, rot = 0) {
  const T = cfg.TILE, { hw, hh } = structSize(type, rot);
  return { x: Math.round((x - hw) / T) * T + hw, y: Math.round((y - hh) / T) * T + hh, hw, hh };
}

// Warum ein Gebäude-Typ gerade gar nicht gebaut werden kann (fürs Baumenü) – oder null
export function buildBlocker(type) {
  const def = cfg.STRUCTURES[type];
  if (type === 'core') return me.core ? 'Bereits gebaut' : null;
  if (def.anywhere) return def.limit && (me.counts[type] || 0) >= def.limit ? `Limit erreicht (${def.limit}/${def.limit})` : null;
  if (!me.core) return 'Basis-Kern nötig';
  if (def.limit && (me.counts[type] || 0) >= def.limit) return `Limit erreicht (${def.limit}/${def.limit})`;
  if (me.count >= me.max) return 'Gebäude-Limit – Kern upgraden';
  return null;
}

// Kann an dieser Stelle (g = snap(…)) gebaut werden? Liefert einen Grund oder null.
export function placementError(type, g) {
  const def = cfg.STRUCTURES[type];
  if (!me || me.dead) return 'tot';
  if (Math.hypot(g.x - me.x, g.y - me.y) > cfg.PLAYER.buildRange) return 'weit';
  if (buildBlocker(type)) return 'gesperrt';
  if (type !== 'core' && !def.anywhere && Math.hypot(g.x - me.core[1], g.y - me.core[2]) > me.core[4]) return 'radius';
  if (!canAfford(def.levels[0].cost)) return 'kosten';
  if (world.cities.some((c) => Math.hypot(c.x - g.x, c.y - g.y) < c.r + cfg.MAP.noBuildMargin + Math.max(g.hw, g.hh))) return 'stadt';
  const nearest = (px, py) => [Math.max(g.x - g.hw, Math.min(px, g.x + g.hw)), Math.max(g.y - g.hh, Math.min(py, g.y + g.hh))];
  for (const [x, y, r] of world.lakes) {
    const [cx, cy] = nearest(x, y);
    if (Math.hypot(x - cx, y - cy) < r) return 'wasser';
  }
  for (const s of structs.values()) {
    const { hw, hh } = structSize(s.type, s.rot);
    if (Math.abs(s.x - g.x) < hw + g.hw - 1 && Math.abs(s.y - g.y) < hh + g.hh - 1) return 'belegt';
  }
  for (const r of resourcesIn(g.x - g.hw, g.y - g.hh, g.x + g.hw, g.y + g.hh)) {
    const [cx, cy] = nearest(r.x, r.y);
    if (Math.hypot(r.x - cx, r.y - cy) < r.r * 0.75 * resScale(r)) return 'belegt';
  }
  return null;
}
