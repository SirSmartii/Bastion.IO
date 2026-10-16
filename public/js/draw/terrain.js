// Boden, Wege, Städte, Seen, Ruinen, Ressourcen und die Basis-Zone.

import { ctx, cfg, me, now, ui, mouse, screenToWorld, drawInto } from '../state.js';
import { TAU, BIOME, RESOURCE_COLORS } from '../constants.js';
import { world, worldVersion, groundCanvas, hash2, biomeAt, ruinsIn, resScale } from '../world.js';
import { circle, hpBar } from './primitives.js';
import { art } from '../assets.js';

// ---------- Boden ----------

// Der Boden ändert sich nie (bis auf Wellen und Baugitter). Er wird deshalb in Kacheln von CHUNK × CHUNK
// Bildschirm-Pixeln einmal gezeichnet und danach nur noch pixelgenau kopiert – das Hochskalieren des
// Biom-Bilds, die Deko, Wege und Städte kosteten sonst jedes Bild ~7 ms ohne Grafikbeschleunigung
// (Firefox). Bei anderem Zoom (Fenstergröße) oder neuer Welt werden die Kacheln neu gezeichnet.
const CHUNK = 256;
const chunks = new Map(); // "i|j" -> { canvas, used: Bildnummer }
let chunkKey = '', chunkFrame = 0;

// view = { x0, y0, x1, y1 }: sichtbarer Weltausschnitt. Die Zeichenfläche muss auf ganze Pixel verschoben sein (main.js).
export function drawGround(view) {
  const m = ctx.getTransform(), k = m.a, key = `${k}:${worldVersion}`;
  if (key !== chunkKey) { chunks.clear(); chunkKey = key; }
  chunkFrame++;
  // Kacheln im Bild, in Pixeln der Welt (Weltkoordinate × k)
  const px0 = -m.e, py0 = -m.f, px1 = px0 + ctx.canvas.width, py1 = py0 + ctx.canvas.height;
  const i0 = Math.floor(px0 / CHUNK), i1 = Math.floor(px1 / CHUNK), j0 = Math.floor(py0 / CHUNK), j1 = Math.floor(py1 / CHUNK);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) ctx.drawImage(groundChunk(i, j, k).canvas, i * CHUNK - px0, j * CHUNK - py0);
  ctx.restore();
  // Eine Kachel am Rand schon vorbereiten, damit beim Laufen keine ganze Reihe auf einmal fällig wird
  prepareOne(i0 - 1, i1 + 1, j0 - 1, j1 + 1, k);
  if (chunkFrame % 60 === 0) for (const [id, c] of chunks) if (chunkFrame - c.used > 120) chunks.delete(id);

  drawLakeWaves(view);
  if (ui.selected === 1 && ui.buildType && ui.panel !== 'build' && !me.dead) drawBuildGrid();
}

let built = 0; // Kacheln, die in diesem Bild neu gezeichnet wurden
function groundChunk(i, j, k) {
  const id = i + '|' + j;
  let c = chunks.get(id);
  if (!c) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CHUNK;
    const g = canvas.getContext('2d');
    g.setTransform(k, 0, 0, k, -i * CHUNK, -j * CHUNK);
    const x0 = (i * CHUNK) / k, y0 = (j * CHUNK) / k;
    drawInto(g, () => drawStaticGround({ x0, y0, x1: x0 + CHUNK / k, y1: y0 + CHUNK / k }));
    chunks.set(id, (c = { canvas }));
    built = chunkFrame;
  }
  c.used = chunkFrame;
  return c;
}

function prepareOne(i0, i1, j0, j1, k) {
  if (built === chunkFrame) return;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (j !== j0 && j !== j1 && i !== i0 && i !== i1) continue; // nur der Ring außen
    if (!chunks.has(i + '|' + j)) return void groundChunk(i, j, k);
  }
}

function drawStaticGround(view) {
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
  // Deko ragt ein paar Pixel über ihre Zelle hinaus: auch die Zellen gleich neben der Kachel zeichnen
  drawGroundDecor({ x0: x0 - 8, y0: y0 - 8, x1: x1 + 8, y1: y1 + 8 });
  drawRoads(view);
  drawCities(view);
  drawLakes(view);
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

// Seen: Sandufer, Wasser, hellere Mitte
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
}

// Langsam wandernde Wellen (bewegt, deshalb nicht in den Boden-Kacheln)
function drawLakeWaves({ x0, y0, x1, y1 }) {
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  for (const [x, y, r] of world.lakes) {
    if (x + r < x0 || x - r > x1 || y + r < y0 || y - r > y1) continue;
    for (let k = 0; k < 3; k++) {
      const a = hash2(x + k, y) * TAU + now * 0.15, d = r * (0.25 + 0.5 * hash2(y + k, x));
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 14, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
  }
}

// Ruinenmauern der Städte. In Städten sind es hunderte – deshalb gebündelt: ein Pfad pro Farbe,
// einer für alle Umrisse und einer für alle Fugen (statt vier Zeichenaufrufen pro Mauerstück).
const RUIN_COLORS = ['#8a8378', '#817a6e', '#938b7e', '#7a7468'];
export function drawRuins({ x0, y0, x1, y1 }) {
  const h = cfg.TILE / 2, ruins = ruinsIn(x0 - h, y0 - h, x1 + h, y1 + h);
  if (!ruins.length) return;
  const outline = (x, y) => ctx.roundRect(x - h + 1, y - h + 1, h * 2 - 2, h * 2 - 2, 4);
  RUIN_COLORS.forEach((color, variant) => {
    ctx.beginPath();
    for (const r of ruins) if (r.variant === variant) outline(r.x, r.y);
    ctx.fillStyle = color;
    ctx.fill();
  });
  ctx.beginPath();
  for (const r of ruins) outline(r.x, r.y);
  ctx.strokeStyle = '#4f4a42';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  for (const { x, y, variant: v } of ruins) {
    ctx.moveTo(x - h + 4, y); ctx.lineTo(x + h - 4, y);
    ctx.moveTo(x + (v % 2 ? -6 : 6), y - h + 4); ctx.lineTo(x + (v % 2 ? -6 : 6), y);
    if (v === 3) { ctx.moveTo(x - 10, y + 4); ctx.lineTo(x - 2, y + 14); ctx.lineTo(x + 6, y + 9); }
  }
  ctx.strokeStyle = 'rgba(60,55,48,0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();
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

// Plünderbares in Städten (Kisten, Regale, Autowracks …): Grafiken unter assets/world/loot,
// gezeichnet in Originalgröße; Risse zeigen, wie viel noch übrig ist
export function drawLoot(r) {
  ctx.save();
  ctx.translate(r.x + shakeOffset(r), r.y);
  if (r.angle) ctx.rotate(r.angle);
  const ref = LOOT_SIZE[r.type] || 20;
  ctx.scale(r.r / ref, r.r / ref);
  art(`world/loot/${LOOT_SIZE[r.type] ? r.type : 'crate'}`);
  if (r.type !== 'barrel' && r.type !== 'car' && r.type !== 'shelf') cracks(ref * 0.85, r.frac);
  ctx.restore();
}

// Bezugsgröße der Grafiken (Radius in der config)
const LOOT_SIZE = { crate: 20, shelf: 22, weapon_crate: 22, med_cabinet: 18, toolbox: 17, barrel: 16, car: 36 };

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

// Fels, Gold, Eisen und Kohle (assets/world/rocks, Radius 40) – je nach ID gedreht, damit nicht alle gleich aussehen
export function drawRock(r) {
  const k = (resScale(r) * r.r) / 40;
  ctx.save();
  ctx.translate(r.x + shakeOffset(r), r.y);
  ctx.rotate((r.id * 2.399) % TAU);
  ctx.scale(k, k);
  art(`world/rocks/${r.type}`);
  ctx.restore();
}

// Baumkrone (assets/world/trees, Radius 50)
export function drawTree(r) {
  const k = (resScale(r) * r.r) / 50;
  ctx.save();
  ctx.translate(r.x + shakeOffset(r), r.y);
  ctx.rotate((r.id * 1.7) % TAU);
  ctx.scale(k, k);
  art(`world/trees/${r.type}`);
  ctx.restore();
}

// Beerenbusch & Gemüse (assets/world/plants): ernten mit jedem Schlag – je weniger übrig, desto weniger Beeren
const PLANT_SIZE = { berry_bush: 25, carrot: 16, potato: 16, corn: 19, pumpkin: 21 };
export function drawPlant(r) {
  const k = (resScale(r) * r.r) / PLANT_SIZE[r.type];
  ctx.save();
  ctx.translate(r.x + shakeOffset(r), r.y);
  ctx.scale(k, k);
  if (r.type !== 'berry_bush') ctx.rotate((r.id * 2.1) % TAU);
  art(`world/plants/${r.type}`);
  if (r.type === 'berry_bush') {
    const berries = Math.ceil(9 * r.frac);
    for (let i = 0; i < berries; i++) {
      const a = i * 2.1 + r.id, d = 25 * (0.25 + (i % 3) * 0.25);
      ctx.save();
      ctx.translate(Math.cos(a) * d, Math.sin(a) * d);
      art('world/plants/berry');
      ctx.restore();
    }
  }
  ctx.restore();
}

// Kleine Vorratsleiste über kürzlich abgebauten Ressourcen
export function drawResourceBar(r) {
  const t = now - r.hitT;
  if (t > 2.5) return;
  ctx.globalAlpha = Math.min(1, (2.5 - t) * 2);
  const color = r.type === 'tree' ? '#7ed957' : r.type === 'rock' ? '#c5cbd1' : RESOURCE_COLORS[r.type] || '#d8b27a';
  hpBar(r.x, r.y - r.r * resScale(r) - 18, 54, r.frac, color);
  ctx.globalAlpha = 1;
}
