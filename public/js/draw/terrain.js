// Boden, Wege, Städte, Seen, Ruinen, Ressourcen und die Basis-Zone.

import { ctx, cfg, me, now, ui, mouse, screenToWorld } from '../state.js';
import { TAU, BIOME, ROCK_COLORS, RESOURCE_COLORS } from '../constants.js';
import { world, groundCanvas, hash2, biomeAt, ruinsIn, resScale } from '../world.js';
import { circle, rrect, poly, hpBar, ellipse } from './primitives.js';

// ---------- Boden ----------

// view = { x0, y0, x1, y1 }: sichtbarer Weltausschnitt
export function drawGround(view) {
  const { x0, y0, x1, y1 } = view, WS = cfg.WORLD_SIZE, G = world.G, n = world.n;
  ctx.fillStyle = '#26321d';
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  // Biome: nur der sichtbare Teil des kleinen Bodenbilds, weich auf Weltgröße gestreckt
  const i0 = Math.max(0, Math.floor(x0 / G) - 1), j0 = Math.max(0, Math.floor(y0 / G) - 1);
  const i1 = Math.min(n, Math.ceil(x1 / G) + 1), j1 = Math.min(n, Math.ceil(y1 / G) + 1);
  if (i1 > i0 && j1 > j0) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(groundCanvas, i0, j0, i1 - i0, j1 - j0, i0 * G, j0 * G, (i1 - i0) * G, (j1 - j0) * G);
  }
  drawGroundDecor(view);
  drawRoads(view);
  drawCities(view);
  drawLakes(view);
  if (ui.selected === 1 && ui.buildType && ui.panel !== 'build' && !me.dead) drawBuildGrid();
  // Weltrand
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 10;
  ctx.strokeRect(0, 0, WS, WS);
}

// Baugitter nur beim Platzieren eines Gebäudes, und nur rund um die Maus
function drawBuildGrid() {
  const WS = cfg.WORLD_SIZE, T = cfg.TILE, wm = screenToWorld(mouse.x, mouse.y), R = 260;
  const gx0 = Math.max(0, Math.floor((wm.x - R) / T) * T), gx1 = Math.min(WS, wm.x + R);
  const gy0 = Math.max(0, Math.floor((wm.y - R) / T) * T), gy1 = Math.min(WS, wm.y + R);
  const fade = ctx.createRadialGradient(wm.x, wm.y, 0, wm.x, wm.y, R);
  fade.addColorStop(0, 'rgba(255,255,255,0.22)');
  fade.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.strokeStyle = fade;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = gx0; x <= gx1; x += T) { ctx.moveTo(x, gy0); ctx.lineTo(x, gy1); }
  for (let y = gy0; y <= gy1; y += T) { ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); }
  ctx.stroke();
}

// Grasbüschel, Blumen, Kiesel – pro Zelle deterministisch
function drawGroundDecor({ x0, y0, x1, y1 }) {
  const G = world.G, n = world.n;
  const flowers = ['#f3e27a', '#f2f2f2', '#e88ab0', '#9fb8ff'];
  for (let j = Math.max(0, Math.floor(y0 / G)); j <= Math.min(n - 1, Math.floor(y1 / G)); j++) {
    for (let i = Math.max(0, Math.floor(x0 / G)); i <= Math.min(n - 1, Math.floor(x1 / G)); i++) {
      const biome = biomeAt(i, j);
      if (biome === BIOME.urban) continue;
      for (let k = 0; k < 3; k++) {
        const hx = hash2(i * 3 + k, j), hy = hash2(j * 3 + k, i + 7), ht = hash2(i + k * 13, j + 3);
        const x = i * G + hx * G, y = j * G + hy * G;
        if (biome === BIOME.sand || biome === BIOME.rocky) {
          if (ht < 0.5) circle(x, y, 2 + ht * 4, biome === BIOME.sand ? 'rgba(150,130,90,0.45)' : 'rgba(80,85,70,0.4)');
        } else if (biome === BIOME.meadow && ht < 0.45) {
          circle(x, y, 3, flowers[Math.floor(ht * 9) % 4]);
          circle(x, y, 1.2, '#c48a1a');
        } else if (ht < 0.7) {
          ctx.strokeStyle = biome === BIOME.forest ? 'rgba(25,60,20,0.5)' : 'rgba(45,95,30,0.5)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (const dx of [-4, 0, 4]) { ctx.moveTo(x + dx * 0.5, y + 4); ctx.lineTo(x + dx, y - 5); }
          ctx.stroke();
        }
      }
    }
  }
}

// Weg als geglättete Linie durch die Stützpunkte
function roadPath(pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i][0] + pts[i + 1][0]) / 2, midY = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], midX, midY);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

function drawRoads({ x0, y0, x1, y1 }) {
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const road of world.roadBoxes) {
    if (road.x1 < x0 || road.x0 > x1 || road.y1 < y0 || road.y0 > y1) continue;
    roadPath(road.pts);
    ctx.strokeStyle = 'rgba(110,88,55,0.55)';
    ctx.lineWidth = 86;
    ctx.stroke();
    ctx.strokeStyle = '#a58c62';
    ctx.lineWidth = 66;
    ctx.stroke();
    ctx.setLineDash([26, 40]);
    ctx.strokeStyle = 'rgba(80,62,38,0.25)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.lineCap = ctx.lineJoin = 'butt';
}

function drawCities({ x0, y0, x1, y1 }) {
  const T = cfg.TILE, streetWidth = cfg.MAP.streetMargin * 1.5;
  for (const c of world.cities) {
    if (c.x + c.r < x0 || c.x - c.r > x1 || c.y + c.r < y0 || c.y - c.r > y1) continue;
    // Gepflasterte Straßen im Raster
    ctx.lineCap = 'square';
    for (const [w, color] of [[streetWidth + 10, 'rgba(70,64,52,0.5)'], [streetWidth, '#8f8775']]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      for (const [[ax, ay], [bx, by]] of c.streets) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
      ctx.stroke();
    }
    // Fahrbahnmarkierung
    ctx.strokeStyle = 'rgba(60,55,45,0.18)';
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    for (const [[ax, ay], [bx, by]] of c.streets) {
      const vertical = ax === bx;
      for (const off of [-streetWidth / 4, streetWidth / 4]) {
        ctx.moveTo(ax + (vertical ? off : 0), ay + (vertical ? 0 : off));
        ctx.lineTo(bx + (vertical ? off : 0), by + (vertical ? 0 : off));
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
    // Marktplatz
    circle(c.x, c.y, streetWidth * 1.1, '#968e7b', 'rgba(70,64,52,0.5)', 5);
    // Gebäudeböden mit Fliesen in der Farbe des Gebäudetyps, Sondergebäude mit Schild auf dem Boden
    for (const [bx, by, bw, bh, type] of c.buildings) {
      const def = cfg.MAP.buildings[type] || cfg.MAP.buildings.house;
      ctx.fillStyle = def.floor;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = 'rgba(50,45,38,0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = bx; x <= bx + bw; x += T / 2) { ctx.moveTo(x, by); ctx.lineTo(x, by + bh); }
      for (let y = by; y <= by + bh; y += T / 2) { ctx.moveTo(bx, y); ctx.lineTo(bx + bw, y); }
      ctx.stroke();
      if (!def.sign) continue;
      ctx.textAlign = 'center';
      ctx.font = 'bold 17px Segoe UI, sans-serif';
      ctx.fillStyle = 'rgba(30,26,20,0.6)';
      ctx.fillText(`${def.sign} ${def.name.toUpperCase()}`, bx + bw / 2, by + bh / 2 + 6);
    }
    // Ortsname auf dem Boden
    ctx.font = 'bold 54px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(40,34,25,0.22)';
    ctx.fillText(c.name.toUpperCase(), c.x, c.y - c.r + 70);
  }
}

// Seen: Sandufer, Wasser, hellere Mitte und langsam wandernde Wellen
function drawLakes({ x0, y0, x1, y1 }) {
  const visible = world.lakes.filter(([x, y, r]) => x + r + 40 > x0 && x - r - 40 < x1 && y + r + 40 > y0 && y - r - 40 < y1);
  if (!visible.length) return;
  const layer = (grow, color) => {
    ctx.beginPath();
    for (const [x, y, r] of visible) { ctx.moveTo(x + r + grow, y); ctx.arc(x, y, r + grow, 0, TAU); }
    ctx.fillStyle = color;
    ctx.fill();
  };
  layer(34, '#d2bf88');
  layer(6, '#2f6a9c');
  layer(0, '#3c7fb6');
  layer(-40, '#4a8fc6');
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  for (const [x, y, r] of visible) {
    for (let k = 0; k < 3; k++) {
      const a = hash2(x + k, y) * TAU + now * 0.15, d = r * (0.25 + 0.5 * hash2(y + k, x));
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 14, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
  }
}

// Ruinenmauern der Städte
export function drawRuins({ x0, y0, x1, y1 }) {
  const h = cfg.TILE / 2;
  const colors = ['#8a8378', '#817a6e', '#938b7e', '#7a7468'];
  for (const { x, y, variant: v } of ruinsIn(x0 - h, y0 - h, x1 + h, y1 + h)) {
    rrect(x - h + 1, y - h + 1, h * 2 - 2, h * 2 - 2, 4, colors[v], '#4f4a42', 3);
    ctx.strokeStyle = 'rgba(60,55,48,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - h + 4, y); ctx.lineTo(x + h - 4, y);
    ctx.moveTo(x + (v % 2 ? -6 : 6), y - h + 4); ctx.lineTo(x + (v % 2 ? -6 : 6), y);
    if (v === 3) { ctx.moveTo(x - 10, y + 4); ctx.lineTo(x - 2, y + 14); ctx.lineTo(x + 6, y + 9); }
    ctx.stroke();
  }
}

// Eigener Bauradius um den Kern
export function drawBaseZone() {
  if (!me.core) return;
  const [, x, y, , r] = me.core;
  const building = ui.selected > 0;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = building ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.035)';
  ctx.fill();
  ctx.setLineDash([18, 14]);
  ctx.strokeStyle = building ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.setLineDash([]);
}

// ---------- Ressourcen ----------

// Kurzes Wackeln nach einem Treffer
function shakeOffset(r) {
  const t = now - r.shake;
  return t > 0.18 ? 0 : Math.sin(t * 90) * 6 * (1 - t / 0.18);
}

// Plünderbares in Städten (Kisten, Regale, Autowracks …) – je Typ eine eigene Zeichnung
export function drawLoot(r) {
  ctx.save();
  ctx.translate(r.x + shakeOffset(r), r.y);
  if (r.angle) ctx.rotate(r.angle);
  (LOOT_SHAPES[r.type] || LOOT_SHAPES.crate)(r.r, r.frac);
  ctx.restore();
}

// Risse, je weniger Haltbarkeit übrig ist
function cracks(h, frac) {
  if (frac >= 0.9) return;
  ctx.strokeStyle = 'rgba(20,12,6,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-h * 0.6, -h * 0.8); ctx.lineTo(-h * 0.2, -h * 0.2); ctx.lineTo(-h * 0.5, h * 0.3);
  if (frac < 0.5) { ctx.moveTo(h * 0.7, -h * 0.5); ctx.lineTo(h * 0.2, h * 0.1); ctx.lineTo(h * 0.6, h * 0.8); }
  ctx.stroke();
}

const LOOT_SHAPES = {
  // Holzkiste
  crate(h, frac) {
    rrect(-h, -h, h * 2, h * 2, 4, '#a8743f', '#5a3a1c', 3);
    ctx.strokeStyle = '#6b4524';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-h + 3, -h + 3); ctx.lineTo(h - 3, h - 3);
    ctx.moveTo(-h, 0); ctx.lineTo(h, 0);
    ctx.stroke();
    cracks(h, frac);
  },
  // Supermarkt-Regal von oben: Metallrahmen mit bunten Waren (leert sich beim Plündern)
  shelf(h, frac) {
    rrect(-h, -h * 0.75, h * 2, h * 1.5, 3, '#9aa3ab', '#4b5258', 3);
    const goods = ['#d9534f', '#f0ad4e', '#5bc0de', '#5cb85c', '#e8e1c4', '#c77dff'];
    const n = Math.max(1, Math.round(6 * frac)), cw = (h * 2 - 10) / 3;
    for (let i = 0; i < n; i++) rrect(-h + 5 + (i % 3) * cw, i < 3 ? -h * 0.6 : h * 0.05, cw - 3, h * 0.5, 2, goods[i]);
  },
  // Olivgrüne Waffenkiste mit Stern
  weapon_crate(h, frac) {
    rrect(-h, -h * 0.7, h * 2, h * 1.4, 3, '#4f5e3a', '#252d1a', 3);
    for (const sx of [-h * 0.55, h * 0.55]) rrect(sx - 3, -h * 0.7, 6, h * 1.4, 1, '#30391f');
    ctx.fillStyle = '#e8c547';
    ctx.font = `bold ${Math.round(h * 0.7)}px Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', 0, 1);
    ctx.textBaseline = 'alphabetic';
    cracks(h * 0.8, frac);
  },
  // Weißer Medizinschrank mit rotem Kreuz
  med_cabinet(h, frac) {
    rrect(-h, -h, h * 2, h * 2, 4, '#eef2f0', '#8a9590', 3);
    rrect(-h * 0.18, -h * 0.6, h * 0.36, h * 1.2, 2, '#d63a3a');
    rrect(-h * 0.6, -h * 0.18, h * 1.2, h * 0.36, 2, '#d63a3a');
    cracks(h, frac);
  },
  // Rote Werkzeugkiste mit Griff
  toolbox(h, frac) {
    rrect(-h, -h * 0.65, h * 2, h * 1.3, 4, '#c0392b', '#6e1d15', 3);
    rrect(-h * 0.45, -h * 0.25, h * 0.9, h * 0.5, 3, '#2c2c2c');
    rrect(-h * 0.35, -h * 0.12, h * 0.7, h * 0.24, 2, '#6e1d15');
    cracks(h * 0.8, frac);
  },
  // Fass von oben: Deckel mit Ring, Rost nach Treffern
  barrel(h, frac) {
    circle(0, 0, h, '#2f6fa3', '#163650', 3);
    ctx.strokeStyle = 'rgba(15,40,60,0.8)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, h * 0.65, 0, TAU);
    ctx.stroke();
    circle(h * 0.3, -h * 0.3, h * 0.15, '#163650');
    if (frac < 1) circle(-h * 0.35, h * 0.25, h * 0.22 * (1.5 - frac), 'rgba(120,70,30,0.8)');
  },
  // Autowrack von oben (Front zeigt nach +x): verblichener Lack, Scheiben, Rost, Reifen
  car(h, frac) {
    const L = h * 1.15, B = h * 0.62;
    for (const sx of [-L * 0.6, L * 0.6]) for (const sy of [-B - 1, B + 1]) rrect(sx - 9, sy - 4, 18, 8, 2, '#1d1d1d');
    rrect(-L, -B, L * 2, B * 2, B * 0.55, '#7d5a4a', '#3a2820', 3);
    rrect(-L * 0.35, -B * 0.82, L * 0.95, B * 1.64, B * 0.35, '#6a4c3e'); // Dach
    rrect(L * 0.38, -B * 0.72, L * 0.3, B * 1.44, 4, 'rgba(120,150,165,0.75)', '#2a2a2a', 2); // Frontscheibe
    rrect(-L * 0.62, -B * 0.66, L * 0.22, B * 1.32, 4, 'rgba(120,150,165,0.6)', '#2a2a2a', 2); // Heckscheibe
    for (const [rx, ry, rr] of [[-L * 0.1, B * 0.4, 7], [L * 0.6, -B * 0.5, 5], [-L * 0.8, -B * 0.2, 6]]) {
      circle(rx, ry, rr * (1.6 - frac), 'rgba(140,70,30,0.7)');
    }
  },
};

// Fels, Gold, Eisen und Kohle: gleiche Form, unterschiedliche Farben und Einschlüsse
export function drawRock(r) {
  const [base, edge, top, vein, veinEdge] = ROCK_COLORS[r.type] || ROCK_COLORS.rock, k = resScale(r);
  ctx.save();
  ctx.translate(r.x + shakeOffset(r), r.y);
  ctx.scale(k, k);
  poly(r.pts);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 5;
  ctx.stroke();
  poly(r.pts, 0.55);
  ctx.fillStyle = top;
  ctx.fill();
  if (r.type === 'gold') {
    for (let i = 0; i < 4; i++) {
      const [px, py] = r.pts[i * 2];
      circle(px * 0.45, py * 0.45, r.r * 0.18, vein, veinEdge, 3);
    }
  } else if (vein) {
    // Eisen: rostige Adern, Kohle: schwarze Brocken
    for (let i = 0; i < 5; i++) {
      const [px, py] = r.pts[(i * 3) % 8];
      const s = r.r * (r.type === 'coal' ? 0.2 : 0.14);
      ctx.save();
      ctx.translate(px * 0.5, py * 0.5);
      ctx.rotate(i * 1.3);
      rrect(-s, -s * 0.6, s * 2, s * 1.2, s * 0.4, vein, veinEdge, 2);
      ctx.restore();
    }
  }
  ctx.restore();
}

export function drawTree(r) {
  const k = resScale(r), apple = r.type === 'apple_tree';
  ctx.save();
  ctx.translate(r.x + shakeOffset(r), r.y);
  ctx.scale(k, k);
  circle(0, 0, r.r, apple ? '#3c7a2e' : '#2e6b2b', '#21501f', 5);
  circle(-r.r * 0.12, -r.r * 0.12, r.r * 0.72, apple ? '#4a9038' : '#3b8535');
  circle(-r.r * 0.22, -r.r * 0.22, r.r * 0.42, apple ? '#5aa646' : '#4b9c41');
  if (apple) {
    // Äpfel in der Krone, Lage aus der ID abgeleitet
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4 + r.id, d = r.r * (0.35 + ((i * 37 + r.id) % 5) * 0.11);
      circle(Math.cos(a) * d, Math.sin(a) * d, r.r * 0.1, '#d8322c', '#7a1612', 2);
    }
  }
  ctx.restore();
}

// Beerenbusch & Gemüse: ernten mit jedem Schlag, je weniger übrig, desto weniger Früchte
export function drawPlant(r) {
  const k = resScale(r);
  ctx.save();
  ctx.translate(r.x + shakeOffset(r), r.y);
  ctx.scale(k, k);
  (PLANT_SHAPES[r.type] || (() => {}))(r.r, r.frac, r.id);
  ctx.restore();
}

const leaf = (x, y, len, w, a, color) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ellipse(len / 2, 0, len / 2, w, color, 'rgba(20,50,15,0.6)', 1.5);
  ctx.restore();
};

const PLANT_SHAPES = {
  berry_bush(h, frac, id) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + id;
      circle(Math.cos(a) * h * 0.45, Math.sin(a) * h * 0.45, h * 0.62, i % 2 ? '#3f7d33' : '#4a8c3b', '#2a5522', 2.5);
    }
    circle(0, 0, h * 0.55, '#559a43');
    const berries = Math.ceil(9 * frac);
    for (let i = 0; i < berries; i++) {
      const a = i * 2.1 + id, d = h * (0.25 + (i % 3) * 0.25);
      circle(Math.cos(a) * d, Math.sin(a) * d, h * 0.13, '#3b4bd6', '#1b2370', 1.5);
    }
  },
  carrot(h, frac) {
    for (let i = 0; i < 5; i++) leaf(0, 0, h * 1.1, h * 0.18, (i / 5) * TAU + 0.3, '#5fae3c');
    circle(0, 0, h * 0.32, '#f08a24', '#9a4f0c', 2);
    if (frac > 0.5) circle(h * 0.2, h * 0.15, h * 0.22, '#f39a3c', '#9a4f0c', 1.5);
  },
  potato(h, frac) {
    for (let i = 0; i < 7; i++) leaf(0, 0, h * (0.8 + (i % 2) * 0.3), h * 0.3, (i / 7) * TAU, i % 2 ? '#4f8a35' : '#5c9a3f');
    circle(0, 0, h * 0.3, '#6aa848');
    for (let i = 0; i < Math.ceil(3 * frac); i++) circle(-h * 0.5 + i * h * 0.45, h * 0.75, h * 0.2, '#b08850', '#6e5028', 1.5);
  },
  corn(h, frac) {
    for (const [ox, oy] of [[-h * 0.4, -h * 0.3], [h * 0.35, -h * 0.25], [0, h * 0.4]]) {
      for (let i = 0; i < 4; i++) leaf(ox, oy, h * 0.9, h * 0.14, i * 1.6 + ox, '#7fb447');
      circle(ox, oy, h * 0.16, '#6e9a3a', '#3f5d1f', 1.5);
    }
    for (let i = 0; i < Math.ceil(3 * frac); i++) {
      ctx.save();
      ctx.rotate(i * 2.1 + 0.4);
      ellipse(h * 0.45, 0, h * 0.3, h * 0.14, '#f2d24a', '#9a7a14', 1.5);
      ctx.restore();
    }
  },
  pumpkin(h, frac) {
    leaf(-h * 0.2, -h * 0.4, h * 1.1, h * 0.35, -2.4, '#4e8a34');
    leaf(h * 0.3, -h * 0.3, h, h * 0.3, -0.6, '#5a9a3c');
    const s = 0.6 + 0.4 * frac;
    for (const ox of [-0.45, 0.45]) ellipse(ox * h * s, 0, h * 0.5 * s, h * 0.75 * s, '#e07a22', '#8a4510', 2);
    ellipse(0, 0, h * 0.55 * s, h * 0.8 * s, '#ee8a2b', '#8a4510', 2.5);
    rrect(-h * 0.08, -h * 0.95 * s, h * 0.16, h * 0.3, 2, '#6a5020');
  },
};

// Kleine Vorratsleiste über kürzlich abgebauten Ressourcen
export function drawResourceBar(r) {
  const t = now - r.hitT;
  if (t > 2.5) return;
  ctx.globalAlpha = Math.min(1, (2.5 - t) * 2);
  const color = r.type === 'tree' ? '#7ed957' : r.type === 'rock' ? '#c5cbd1' : RESOURCE_COLORS[r.type] || '#d8b27a';
  hpBar(r.x, r.y - r.r * resScale(r) - 18, 54, r.frac, color);
  ctx.globalAlpha = 1;
}
