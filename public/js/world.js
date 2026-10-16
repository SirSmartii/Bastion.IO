// Statische Welt (Gelände, Städte, Seen, Wege) und Ressourcen (Bäume, Steine, Erze, Kisten, Autowracks …).
// Ressourcen und Ruinen liegen zusätzlich in einem Raster, damit Zeichnen, Schatten und Licht
// nur die Objekte in der Nähe anfassen statt der ganzen Welt.

import { cfg, now } from './state.js';
import { BIOME_COLORS, TAU } from './constants.js';

// Punkt-Raster: jedes Objekt liegt in genau einer Zelle (nach seinem Mittelpunkt)
class Buckets {
  constructor(cellSize) {
    this.cell = cellSize;
    this.map = new Map();
  }

  key(x, y) { return Math.floor(x / this.cell) * 100000 + Math.floor(y / this.cell); }

  add(o) {
    const k = this.key(o.x, o.y);
    if (!this.map.has(k)) this.map.set(k, []);
    this.map.get(k).push(o);
  }

  remove(o) {
    const list = this.map.get(this.key(o.x, o.y));
    if (!list) return;
    const i = list.indexOf(o);
    if (i >= 0) list.splice(i, 1);
  }

  clear() { this.map.clear(); }

  // Alle Objekte mit Mittelpunkt im Rechteck (x0, y0)–(x1, y1)
  query(x0, y0, x1, y1) {
    const out = [], c = this.cell;
    for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++) {
      for (let cy = Math.floor(y0 / c); cy <= Math.floor(y1 / c); cy++) {
        const list = this.map.get(cx * 100000 + cy);
        if (list) for (const o of list) if (o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1) out.push(o);
      }
    }
    return out;
  }
}

// ---------- Gelände ----------

export let world = null; // { n, G, biomes, lakes, roads, cities, ruinTiles }
export let worldVersion = 0; // steigt bei jeder neuen Welt (z. B. für den Karten-Cache)
export const groundCanvas = document.createElement('canvas'); // 1 Pixel pro Biom-Zelle, wird weich hochskaliert
const ruinIndex = new Buckets(400);

export function setupWorld(w) {
  world = w;
  worldVersion++;
  world.ruinTiles = w.cities.flatMap((c) => c.ruins);
  ruinIndex.clear();
  for (const [x, y, variant] of world.ruinTiles) ruinIndex.add({ x, y, variant });
  // Straßen: Begrenzungsrechteck für schnelles Aussortieren beim Zeichnen
  world.roadBoxes = w.roads.map((pts) => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { pts, x0: Math.min(...xs) - 60, y0: Math.min(...ys) - 60, x1: Math.max(...xs) + 60, y1: Math.max(...ys) + 60 };
  });

  // Bodenbild: eine Zelle = ein Pixel, mit leichter Farbvariation für Struktur
  groundCanvas.width = groundCanvas.height = w.n;
  const g = groundCanvas.getContext('2d'), img = g.createImageData(w.n, w.n);
  for (let i = 0; i < w.n * w.n; i++) {
    const [r, gr, b] = BIOME_COLORS[+w.biomes[i]];
    const v = 1 + (hash2(i % w.n, Math.floor(i / w.n)) - 0.5) * 0.08;
    img.data[i * 4] = r * v;
    img.data[i * 4 + 1] = gr * v;
    img.data[i * 4 + 2] = b * v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

// Deterministischer Zufall pro Rasterzelle (für Deko, die beim Scrollen nicht flackert)
export function hash2(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const biomeAt = (i, j) => +world.biomes[j * world.n + i];

// Ruinen-Kacheln { x, y, variant } im Rechteck
export const ruinsIn = (x0, y0, x1, y1) => ruinIndex.query(x0, y0, x1, y1);

// ---------- Ressourcen ----------

export let resources = [];
export const resById = new Map();
const resIndex = new Buckets(300);
const MAX_RES_RADIUS = 120; // größter Grundradius einer Ressource (Rand für Rasterabfragen)

export function setResources(list) {
  resources = list.map((a) => makeResource(a, false));
  resById.clear();
  resIndex.clear();
  for (const r of resources) { resById.set(r.id, r); resIndex.add(r); }
}

function makeResource([id, type, x, y, r, frac, angle], born) {
  return { id, type, x, y, r, frac, angle: angle || 0, shake: -9, hitT: -9, bornT: born ? now : -9, pts: rockShape(id, r) };
}

// Server-Update { c: [id, Anteil, …], a: [neue Ressourcen], r: [entfernte IDs] }
export function applyResourceUpdate(update) {
  for (let i = 0; i < update.c.length; i += 2) {
    const r = resById.get(update.c[i]);
    if (r) r.frac = update.c[i + 1];
  }
  for (const a of update.a) {
    const r = makeResource(a, true);
    resources.push(r);
    resById.set(r.id, r);
    resIndex.add(r);
  }
  if (update.r.length) {
    const gone = new Set(update.r);
    for (const id of gone) {
      const r = resById.get(id);
      if (r) resIndex.remove(r);
      resById.delete(id);
    }
    resources = resources.filter((r) => !gone.has(r.id));
  }
}

// Ressourcen, die das Rechteck berühren könnten
export const resourcesIn = (x0, y0, x1, y1) => resIndex.query(x0 - MAX_RES_RADIUS, y0 - MAX_RES_RADIUS, x1 + MAX_RES_RADIUS, y1 + MAX_RES_RADIUS);

// Aktuelle Größe: schrumpft mit dem Vorrat, wächst beim Nachwachsen kurz auf
export function resScale(r) {
  const def = cfg.RESOURCES[r.type];
  if (def.loot) return 1; // Kisten & Co. schrumpfen nicht
  const grow = Math.min(1, (now - r.bornT) / 0.8), born = grow < 1 ? 1 - Math.pow(1 - grow, 3) : 1;
  if (def.pick) return born; // Pflanzen tragen nur weniger Früchte
  const min = cfg.RESOURCE_MIN_SCALE;
  return (min + (1 - min) * r.frac) * born;
}

// Unregelmäßiges Achteck als Felsform, aus der ID abgeleitet (immer gleich)
function rockShape(seed, r) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + rnd() * 0.3, rr = r * (0.82 + rnd() * 0.2);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return pts;
}
