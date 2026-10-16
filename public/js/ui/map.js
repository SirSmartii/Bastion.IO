// Weltkarte [M]: ganze Welt mit Planquadraten, eigener Basis und Team. Fremde Spieler sind nicht zu sehen.

import { ctx, cfg, me, now, myAngle, minimap, mouse, W, H, dpr } from '../state.js';
import { TAU } from '../constants.js';
import { circle, rrect, text, inRect } from '../draw/primitives.js';
import { world, worldVersion, groundCanvas } from '../world.js';
import { teammates } from '../rules.js';

// Statischer Teil (Boden, Wege, Seen, Städte) wird nur bei neuer Größe oder neuer Welt neu gezeichnet
const cache = document.createElement('canvas');
let cacheKey = '';

function buildCache(size) {
  const px = Math.round(size * dpr);
  cache.width = cache.height = px;
  const g = cache.getContext('2d'), k = px / cfg.WORLD_SIZE;
  g.imageSmoothingEnabled = true;
  g.drawImage(groundCanvas, 0, 0, world.n, world.n, 0, 0, px, px);
  g.lineCap = g.lineJoin = 'round';
  for (const pts of world.roads) {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
    g.strokeStyle = 'rgba(110,88,55,0.7)';
    g.lineWidth = Math.max(3, 86 * k);
    g.stroke();
    g.strokeStyle = '#b39a6c';
    g.lineWidth = Math.max(2, 60 * k);
    g.stroke();
  }
  for (const [grow, color] of [[34, '#d2bf88'], [0, '#3c7fb6'], [-40, '#4a8fc6']]) {
    g.beginPath();
    for (const [x, y, r] of world.lakes) {
      if (r + grow <= 0) continue;
      g.moveTo((x + r + grow) * k, y * k);
      g.arc(x * k, y * k, (r + grow) * k, 0, TAU);
    }
    g.fillStyle = color;
    g.fill();
  }
  for (const c of world.cities) {
    for (const [bx, by, bw, bh, type] of c.buildings) {
      const def = cfg.MAP.buildings[type] || cfg.MAP.buildings.house;
      g.fillStyle = def.sign ? def.floor : 'rgba(70,62,50,0.75)';
      g.fillRect(bx * k, by * k, Math.max(2, bw * k), Math.max(2, bh * k));
      if (!def.sign) continue;
      g.font = `${Math.round(10 * dpr)}px Segoe UI, sans-serif`;
      g.textAlign = 'center';
      g.fillText(def.sign, (bx + bw / 2) * k, (by + bh / 2) * k + 4 * dpr);
    }
    g.font = `bold ${Math.round(13 * dpr)}px Segoe UI, sans-serif`;
    g.textAlign = 'center';
    g.lineWidth = 3 * dpr;
    g.strokeStyle = 'rgba(0,0,0,0.65)';
    g.strokeText(c.name, c.x * k, (c.y - c.r) * k - 4 * dpr);
    g.fillStyle = '#ffe9b0';
    g.fillText(c.name, c.x * k, (c.y - c.r) * k - 4 * dpr);
  }
}

// Auch im Tod offen lassen (hud.js)
export const whileDead = true;

export function draw() {
  const S = Math.floor(Math.min(W - 80, H - 130)), x = Math.round((W - S) / 2), y = Math.round((H - S) / 2 + 12);
  const WS = cfg.WORLD_SIZE, k = S / WS;
  const key = `${S}:${dpr}:${worldVersion}`;
  if (key !== cacheKey) { buildCache(S); cacheKey = key; }
  const mx = (wx) => x + wx * k, my = (wy) => y + wy * k;

  ctx.fillStyle = 'rgba(5,8,4,0.6)';
  ctx.fillRect(0, 0, W, H);
  rrect(x - 14, y - 46, S + 28, S + 60, 14, 'rgba(18,24,14,0.96)', '#4b5d38', 3);
  text('🗺️ Weltkarte', x, y - 18, { size: 18, bold: true, color: '#f2d27a' });
  text('[M] schließen', x + S, y - 18, { size: 12, color: '#a8b597', align: 'right' });
  ctx.drawImage(cache, x, y, S, S);
  drawSectors(x, y, S);

  // Eigene Basis & Schmiede
  if (me.core) {
    ctx.beginPath();
    ctx.arc(mx(me.core[1]), my(me.core[2]), Math.max(5, me.core[4] * k), 0, TAU);
    ctx.fillStyle = 'rgba(120,200,255,0.3)';
    ctx.fill();
    rrect(mx(me.core[1]) - 5, my(me.core[2]) - 5, 10, 10, 2, '#86e6ff', '#0b3a4a', 2);
  }
  if (me.forge) rrect(mx(me.forge[1]) - 3.5, my(me.forge[2]) - 3.5, 7, 7, 1.5, '#ff9a3c', '#3a1a00', 1.5);
  // Gegner aus dem Radar-Umkreis
  const e = minimap.e;
  for (let i = 0; i < e.length; i += 3) circle(mx(e[i] * 10), my(e[i + 1] * 10), e[i + 2] ? 2.5 : 2, e[i + 2] ? '#ff3b3b' : 'rgba(240,170,165,0.8)');
  // Team mit Namen und Basen
  for (const [, name, tx, ty, , dead, cx, cy] of teammates()) {
    if (cx || cy) rrect(mx(cx) - 4.5, my(cy) - 4.5, 9, 9, 2, '#7fe0a0', '#0b3a1a', 2);
    if (dead) continue;
    circle(mx(tx), my(ty), 5, '#7fe0a0', '#06200e', 2);
    text(name, mx(tx), my(ty) - 9, { size: 11, bold: true, align: 'center', color: '#c8ffd8' });
  }
  drawSelf(mx(me.x), my(me.y));

  // Kopfzeile: eigenes Planquadrat + Planquadrat unter der Maus
  const sector = (wx, wy) => 'ABCDEFGHIJ'[Math.min(9, Math.floor(wx / (WS / 10)))] + (Math.min(9, Math.floor(wy / (WS / 10))) + 1);
  let info = `Du: ${sector(me.x, me.y)}`;
  if (inRect(mouse.x, mouse.y, { x, y, w: S, h: S })) {
    const wx = (mouse.x - x) / k, wy = (mouse.y - y) / k;
    info += `  ·  Maus: ${sector(wx, wy)} (${Math.round(Math.hypot(wx - me.x, wy - me.y))} entfernt)`;
  }
  text(info, x + S / 2, y - 18, { size: 12, align: 'center', color: '#cfd8c0' });
}

// Planquadrate A–J / 1–10
function drawSectors(x, y, S) {
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 10; i++) {
    ctx.moveTo(x + (S * i) / 10, y); ctx.lineTo(x + (S * i) / 10, y + S);
    ctx.moveTo(x, y + (S * i) / 10); ctx.lineTo(x + S, y + (S * i) / 10);
  }
  ctx.stroke();
  for (let i = 0; i < 10; i++) {
    text('ABCDEFGHIJ'[i], x + (S * (i + 0.5)) / 10, y + 13, { size: 10, bold: true, align: 'center', color: 'rgba(255,255,255,0.45)' });
    text(String(i + 1), x + 5, y + (S * (i + 0.5)) / 10 + 4, { size: 10, bold: true, color: 'rgba(255,255,255,0.45)' });
  }
}

// Eigene Position als Pfeil in Blickrichtung mit pulsierendem Ring
function drawSelf(sx, sy) {
  ctx.beginPath();
  ctx.arc(sx, sy, 9 + Math.sin(now * 4) * 3, 0, TAU);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(myAngle);
  ctx.beginPath();
  ctx.moveTo(9, 0); ctx.lineTo(-6, -6); ctx.lineTo(-3, 0); ctx.lineTo(-6, 6);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

// Klicks auf der Karte gehen nicht ins Spiel
export function onClick() {}

// Die Karte überdeckt den ganzen Bildschirm
export function layout() {
  return { panel: { x: 0, y: 0, w: W, h: H } };
}
