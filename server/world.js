'use strict';
// Weltgenerator: Biome (Rauschen), Städte mit Gebäuden, Kisten & Autowracks, Feldwege, Seen.
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

// Eine Ruinenstadt: Straßenraster (Zellen der Größe cityBlock), je Zelle höchstens ein Gebäude mit Abstand
// zur Straße. Gebäudetypen (Wohnhaus, Supermarkt, Polizei …) bestimmen Größe, Einrichtung und Beute.
// Auf den Straßen stehen Autowracks und Fässer. Die Hauptstraßen durch die Mitte enden an vier Stadttoren.
//
// Ergebnis: buildings [x, y, Breite, Höhe, Typ], ruins [x, y, Variante] (Mauerkacheln),
// crates [x, y, Kistentyp, Winkel] (alles Plünderbare), streets [[x, y], [x, y]]
function makeCity(rng, x, y, name) {
  const M = C.MAP, T = C.TILE, B = M.cityBlock, R = M.cityRadius;
  x = Math.round(x / T) * T;
  y = Math.round(y / T) * T;
  const city = { x, y, r: R, name, buildings: [], ruins: [], crates: [], streets: [] };
  const cells = Math.ceil(R / B);
  // Straßen entlang der Zellgrenzen, auf den Stadtkreis zugeschnitten
  for (let k = -cells; k <= cells; k++) {
    const L = Math.sqrt(R * R - (k * B) ** 2);
    if (!(L > B * 0.4)) continue;
    city.streets.push([[x + k * B, Math.round(y - L)], [x + k * B, Math.round(y + L)]]);
    city.streets.push([[Math.round(x - L), y + k * B], [Math.round(x + L), y + k * B]]);
  }
  city.gates = [[x + R, y], [x - R, y], [x, y + R], [x, y - R]];

  // Bauplätze (Straßenzellen) in zufälliger Reihenfolge; ein Teil bleibt leer
  const lots = [];
  for (let i = -cells; i < cells; i++) {
    for (let j = -cells; j < cells; j++) {
      const cx0 = x + i * B, cy0 = y + j * B;
      if (Math.hypot(cx0 + B / 2 - x, cy0 + B / 2 - y) > R - 150 || rng() < 0.2) continue;
      lots.push([cx0, cy0]);
    }
  }
  shuffle(lots, rng);
  // Erst je ein Sondergebäude, danach nach Gewicht
  const types = Object.keys(M.buildings), specials = types.filter((t) => M.buildings[t].special);
  lots.forEach((lot, n) => addBuilding(city, rng, lot, n < specials.length ? specials[n] : pickWeighted(rng, types)));
  addStreetProps(city, rng);
  return city;
}

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const k = Math.floor(rng() * (i + 1));
    [list[i], list[k]] = [list[k], list[i]];
  }
}

function pickWeighted(rng, types) {
  const B = C.MAP.buildings;
  let roll = rng() * types.reduce((sum, t) => sum + B[t].weight, 0);
  for (const t of types) if ((roll -= B[t].weight) < 0) return t;
  return types[0];
}

// Gebäude auf einem Bauplatz: Mauern mit Eingang (2 Kacheln), Regale, Kisten
function addBuilding(city, rng, [cx0, cy0], type) {
  const M = C.MAP, T = C.TILE, def = M.buildings[type];
  const maxTiles = Math.floor((M.cityBlock - 2 * M.streetMargin) / T);
  const size = () => Math.min(maxTiles, def.size[0] + Math.floor(rng() * (def.size[1] - def.size[0] + 1)));
  const w = size(), h = size();
  const ox = cx0 + M.streetMargin + Math.floor(rng() * (maxTiles - w + 1)) * T;
  const oy = cy0 + M.streetMargin + Math.floor(rng() * (maxTiles - h + 1)) * T;
  city.buildings.push([ox, oy, w * T, h * T, type]);
  const at = (i, j) => [ox + i * T + T / 2, oy + j * T + T / 2];

  // Eingang auf einer zufälligen Seite: Lücke in der Mauer und die Kacheln direkt dahinter bleiben frei
  const side = Math.floor(rng() * 4), len = side % 2 ? h : w, door = 1 + Math.floor(rng() * (len - 3));
  const doorTiles = [];
  for (const k of [door, door + 1]) {
    if (side === 0) doorTiles.push([k, 0], [k, 1]);
    else if (side === 2) doorTiles.push([k, h - 1], [k, h - 2]);
    else if (side === 1) doorTiles.push([w - 1, k], [w - 2, k]);
    else doorTiles.push([0, k], [1, k]);
  }
  const used = new Set(doorTiles.map(([i, j]) => i + ',' + j));

  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
      if (!edge || used.has(i + ',' + j)) continue;
      const corner = (i === 0 || i === w - 1) && (j === 0 || j === h - 1);
      if (!corner && rng() < M.ruinDecay) continue; // verfallene Stelle
      city.ruins.push([...at(i, j), Math.floor(rng() * 4)]);
    }
  }

  // Supermarkt: Regalreihen in jeder zweiten Zeile, abwechselnd links/rechts ein Durchgang
  if (def.shelves) {
    for (let j = 2, row = 0; j < h - 1; j += 2, row++) {
      const gap = row % 2 ? 1 : w - 2;
      for (let i = 1; i < w - 1; i++) {
        if (i === gap || used.has(i + ',' + j)) continue;
        used.add(i + ',' + j);
        city.crates.push([...at(i, j), 'shelf', 0]);
      }
    }
  }
  // Kisten auf freien Innenkacheln
  const free = [];
  for (let i = 1; i < w - 1; i++) for (let j = 1; j < h - 1; j++) if (!used.has(i + ',' + j)) free.push([i, j]);
  shuffle(free, rng);
  for (const [kind, min, max] of def.loot) {
    const n = min + Math.floor(rng() * (max - min + 1));
    for (let k = 0; k < n && free.length; k++) city.crates.push([...at(...free.pop()), kind, 0]);
  }
}

// Autowracks auf den Fahrspuren (nicht auf Kreuzungen oder dem Marktplatz) und Fässer am Straßenrand
function addStreetProps(city, rng) {
  const M = C.MAP, B = M.cityBlock, half = (M.streetMargin * 1.5) / 2;
  const placed = [];
  const place = (kind, lane, minGap) => {
    for (let tries = 0; tries < 40; tries++) {
      const [[ax, ay], [bx, by]] = city.streets[Math.floor(rng() * city.streets.length)];
      const vertical = ax === bx, t = rng();
      const along = vertical ? ay + (by - ay) * t : ax + (bx - ax) * t;
      const fromCrossing = Math.abs(((along - (vertical ? city.y : city.x)) % B + B) % B - B / 2);
      if (fromCrossing > B / 2 - 90) continue; // zu nah an einer Kreuzung
      const off = (rng() < 0.5 ? -1 : 1) * lane;
      const px = vertical ? ax + off : along, py = vertical ? along : ay + off;
      if (Math.hypot(px - city.x, py - city.y) < 180 || Math.hypot(px - city.x, py - city.y) > city.r - 60) continue;
      if (placed.some(([qx, qy]) => Math.hypot(qx - px, qy - py) < minGap)) continue;
      placed.push([px, py]);
      const angle = (vertical ? Math.PI / 2 : 0) + (rng() < 0.5 ? Math.PI : 0) + (rng() - 0.5) * 0.35;
      city.crates.push([Math.round(px), Math.round(py), kind, kind === 'car' ? +angle.toFixed(2) : 0]);
      return;
    }
  };
  for (let n = 0; n < M.cityCars; n++) place('car', half / 2, 140);
  for (let n = 0; n < M.cityBarrels; n++) place('barrel', half - 6, 60);
}

function generateWorld(seed) {
  const rng = mulberry32(seed);
  const W = C.WORLD_SIZE, M = C.MAP;

  // Städte: gleichmäßig verteilt, mit Mindestabstand
  const cities = [];
  const names = CITY_NAMES.slice().sort(() => rng() - 0.5);
  for (let tries = 0; tries < 2000 && cities.length < M.cities; tries++) {
    const edge = M.cityRadius + 250;
    const x = edge + rng() * (W - 2 * edge), y = edge + rng() * (W - 2 * edge);
    if (cities.some((c) => Math.hypot(c.x - x, c.y - y) < M.citySpacing)) continue;
    // Eigener Zufall pro Stadt: Änderungen am Stadtinhalt verschieben nicht den Rest der Welt
    const cityRng = mulberry32((seed * 7919 + cities.length * 104729) | 0);
    cities.push(makeCity(cityRng, x, y, names[cities.length % names.length]));
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
    // Weg: Stadtmitte -> Hauptstraße -> Tor (zur anderen Stadt hin) -> Feldweg -> Tor -> Hauptstraße -> Mitte
    const a = cities[best.i], b = cities[best.j];
    const gate = (c, o) => {
      const dx = o.x - c.x, dy = o.y - c.y;
      const dir = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
      return { p: [c.x + dir[0] * c.r, c.y + dir[1] * c.r], out: [c.x + dir[0] * (c.r + 180), c.y + dir[1] * (c.r + 180)] };
    };
    const ga = gate(a, b), gb = gate(b, a);
    const pts = [[a.x, a.y], ga.p, ga.out];
    const [ax, ay] = ga.out, [bx, by] = gb.out, d = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / d, ny = (bx - ax) / d;
    for (const t of [0.33, 0.66]) {
      let off = (rng() - 0.5) * d * 0.18;
      const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
      // Biegung nur, wenn sie nicht in eine Stadt führt
      if (cities.some((c) => Math.hypot(c.x - (px + nx * off), c.y - (py + ny * off)) < c.r + 150)) off = 0;
      pts.push([px + nx * off, py + ny * off]);
    }
    pts.push(gb.out, gb.p, [b.x, b.y]);
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
