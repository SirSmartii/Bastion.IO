'use strict';
// Weltgenerator: Biome (Rauschen), Städte mit Ruinen & Kisten, Feldwege, Seen.
// Alles hängt nur vom Seed ab – gleiche Welt bei gleichem Seed.

const C = require('./config');

const BIOMES = ['grass', 'forest', 'rocky', 'sand', 'meadow', 'urban'];
const CITY_NAMES = ['Altdorf', 'Grauweiler', 'Rabenfels', 'Moorbrück', 'Eschental', 'Kaltenburg', 'Steinhausen', 'Nebelfurt', 'Dornheim', 'Wolfsgrund'];

// Kleiner, schneller Seed-Zufallsgenerator
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Value-Noise auf einem cells×cells-Gitter, Eingabe u, v in [0, 1]
function valueNoise(rng, cells) {
  const n = cells + 1;
  const g = Float32Array.from({ length: n * n }, () => rng());
  const s = (t) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = Math.min(u * cells, cells - 1e-6), y = Math.min(v * cells, cells - 1e-6);
    const xi = Math.floor(x), yi = Math.floor(y), a = g[yi * n + xi], b = g[yi * n + xi + 1];
    const c = g[(yi + 1) * n + xi], d = g[(yi + 1) * n + xi + 1];
    const fx = s(x - xi), fy = s(y - yi);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function fbm(rng) {
  const oct = [valueNoise(rng, 4), valueNoise(rng, 9), valueNoise(rng, 19)];
  return (u, v) => (oct[0](u, v) * 0.55 + oct[1](u, v) * 0.3 + oct[2](u, v) * 0.15);
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// Eine Ruinenstadt: Häuser auf einem 3×3-Raster aus Ruinenmauer-Kacheln mit Eingängen & Lücken
function makeCity(rng, x, y, name) {
  const M = C.MAP, T = C.TILE;
  const city = { x, y, r: M.cityRadius, name, buildings: [], ruins: [], crates: [] };
  const snap = (v) => Math.round(v / T) * T;
  for (let bx = -1; bx <= 1; bx++) {
    for (let by = -1; by <= 1; by++) {
      if (rng() < 0.2) continue;
      const w = 5 + Math.floor(rng() * 4), h = 4 + Math.floor(rng() * 4);
      const ox = snap(x + bx * M.cityBlock - (w * T) / 2 + (rng() - 0.5) * 80);
      const oy = snap(y + by * M.cityBlock - (h * T) / 2 + (rng() - 0.5) * 80);
      city.buildings.push([ox, oy, w * T, h * T]);
      // Eingang: 2 Kacheln breite Lücke auf einer zufälligen Seite
      const side = Math.floor(rng() * 4), len = side % 2 ? h : w, door = 1 + Math.floor(rng() * (len - 3));
      for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
          const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
          if (!edge) continue;
          const corner = (i === 0 || i === w - 1) && (j === 0 || j === h - 1);
          const along = side === 0 ? (j === 0 ? i : -1) : side === 2 ? (j === h - 1 ? i : -1) : side === 1 ? (i === w - 1 ? j : -1) : (i === 0 ? j : -1);
          if (along === door || along === door + 1) continue;
          if (!corner && rng() < M.ruinDecay) continue; // verfallene Stelle
          city.ruins.push([ox + i * T + T / 2, oy + j * T + T / 2, Math.floor(rng() * 4)]);
        }
      }
      // Kisten im Inneren
      const nCrates = 1 + Math.floor(rng() * 2);
      for (let k = 0; k < nCrates; k++) {
        const ci = 1 + Math.floor(rng() * (w - 2)), cj = 1 + Math.floor(rng() * (h - 2));
        city.crates.push([ox + ci * T + T / 2, oy + cj * T + T / 2]);
      }
    }
  }
  return city;
}

function generateWorld(seed) {
  const rng = mulberry32(seed);
  const W = C.WORLD_SIZE, M = C.MAP;

  // Städte: gleichmäßig verteilt, mit Mindestabstand
  const cities = [];
  const names = CITY_NAMES.slice().sort(() => rng() - 0.5);
  for (let tries = 0; tries < 2000 && cities.length < M.cities; tries++) {
    const x = 900 + rng() * (W - 1800), y = 900 + rng() * (W - 1800);
    if (cities.some((c) => Math.hypot(c.x - x, c.y - y) < M.citySpacing)) continue;
    cities.push(makeCity(rng, x, y, names[cities.length % names.length]));
  }

  // Feldwege: minimaler Spannbaum (Prim) zwischen den Städten, leicht gewunden
  const roads = [];
  const linked = [0];
  while (linked.length < cities.length) {
    let best = null;
    for (const i of linked) {
      cities.forEach((c, j) => {
        if (linked.includes(j)) return;
        const d = Math.hypot(c.x - cities[i].x, c.y - cities[i].y);
        if (!best || d < best.d) best = { i, j, d };
      });
    }
    linked.push(best.j);
    const a = cities[best.i], b = cities[best.j], pts = [[a.x, a.y]];
    const nx = -(b.y - a.y) / best.d, ny = (b.x - a.x) / best.d;
    for (const t of [0.33, 0.66]) {
      const off = (rng() - 0.5) * best.d * 0.18;
      pts.push([a.x + (b.x - a.x) * t + nx * off, a.y + (b.y - a.y) * t + ny * off]);
    }
    pts.push([b.x, b.y]);
    roads.push(pts.map(([px, py]) => [Math.round(px), Math.round(py)]));
  }
  const nearRoad = (x, y, d) => roads.some((pts) => pts.some((p, i) => i > 0 && segDist(x, y, pts[i - 1][0], pts[i - 1][1], p[0], p[1]) < d));

  // Seen: Gruppen überlappender Kreise, weg von Städten und Wegen
  const lakes = [];
  for (let n = 0, tries = 0; n < M.lakes && tries < 500; tries++) {
    const cx = 500 + rng() * (W - 1000), cy = 500 + rng() * (W - 1000);
    if (cities.some((c) => Math.hypot(c.x - cx, c.y - cy) < c.r + 700)) continue;
    const blobs = [];
    const k = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < k; i++) {
      const r = 130 + rng() * 220, a = rng() * Math.PI * 2, d = i ? rng() * 260 : 0;
      blobs.push([Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), Math.round(r)]);
    }
    if (blobs.some(([x, y, r]) => nearRoad(x, y, r + 120) || x - r < 100 || y - r < 100 || x + r > W - 100 || y + r > W - 100)) continue;
    if (blobs.some(([x, y, r]) => lakes.some(([lx, ly, lr]) => Math.hypot(lx - x, ly - y) < lr + r + 300))) continue;
    lakes.push(...blobs);
    n++;
  }

  // Biome pro Rasterzelle (Höhe & Feuchte als Rauschen)
  const G = M.biomeCell, n = Math.ceil(W / G);
  const elev = fbm(rng), moist = fbm(rng);
  let biomes = '';
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * G, y = (j + 0.5) * G, u = x / W, v = y / W;
      let b = 0;
      const shore = lakes.some(([lx, ly, lr]) => Math.hypot(lx - x, ly - y) < lr + 110);
      const city = cities.some((c) => Math.hypot(c.x - x, c.y - y) < c.r);
      const e = elev(u, v), m = moist(u, v);
      if (city) b = 5;
      else if (shore) b = 3;
      else if (e > 0.61) b = 2;
      else if (m > 0.6) b = 1;
      else if (m < 0.43) b = 4;
      biomes += b;
    }
  }
  const biomeAt = (x, y) => {
    const i = Math.max(0, Math.min(n - 1, Math.floor(x / G))), j = Math.max(0, Math.min(n - 1, Math.floor(y / G)));
    return BIOMES[+biomes[j * n + i]];
  };

  return { seed, n, G, biomes, cities, lakes, roads, biomeAt };
}

module.exports = { generateWorld, BIOMES };
