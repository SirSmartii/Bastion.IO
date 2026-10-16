// Gebäude, Gegner & Tiere, Spielfiguren, Items am Boden und Geschosse.

import { ctx, cfg, me, myId, now, players, clock, myAngle, ui, mouse, screenToWorld, drawInto } from '../state.js';
import { TAU, LEVEL_COLORS, LEVEL_DARK, ZOMBIE_COLORS, ARMOR_COLORS, ARROW_TIPS } from '../constants.js';
import { circle, ellipse, rrect, hpBar, outlinedText, wrapText } from './primitives.js';
import { drawItemIcon, drawWeapon, drawGun } from './items.js';
import { isAllied, snap, placementError, structSize } from '../rules.js';
import { bubbles } from '../chat.js';

const SKIN = '#f0c8a0', SKIN_OTHER = '#e8bc92', SKIN_LINE = '#8a6a4a';

// ---------- Gebäude ----------

// ghost = Vorschau (Baumenü, Bau-Button, Platzieren): ohne Animation, Lebensbalken und Rahmen.
// Die Form wird ungedreht gezeichnet (Breite hw, Höhe hh, h = kürzere halbe Kante) und dann um rot × 90° gedreht.
export function drawStruct(s, ghost = false) {
  const rot = s.rot || 0, { hw, hh } = structSize(s.type, 0), h = Math.min(hw, hh);
  const c = LEVEL_COLORS[s.level], d = LEVEL_DARK[s.level];
  ctx.save();
  ctx.translate(s.x, s.y);
  if (rot) ctx.rotate((rot * Math.PI) / 2);
  (STRUCTURE_SHAPES[s.type] || (() => {}))(s, h, c, d, ghost, hw, hh);
  ctx.restore();
  if (ghost) return;
  const mine = s.owner === myId, allied = isAllied(s.owner), size = structSize(s.type, rot);
  // Fremde Gebäude rot umrandet, Team-Gebäude grün
  if (!mine) {
    ctx.strokeStyle = allied ? 'rgba(110,220,140,0.55)' : 'rgba(220,60,60,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(s.x - size.hw, s.y - size.hh, size.hw * 2, size.hh * 2);
  }
  if (s.hp < s.maxHp) hpBar(s.x, s.y - size.hh - 14, Math.max(44, size.hw * 1.6), s.hp / s.maxHp, allied ? '#7ed957' : '#e05555');
}

// Ein Zeichner pro Gebäudetyp: (Gebäude, halbe Kantenlänge, Levelfarbe, dunkle Levelfarbe, Vorschau?)
const STRUCTURE_SHAPES = {
  wall(s, h, c, d) {
    rrect(-h + 2, -h + 2, h * 2 - 4, h * 2 - 4, 6, c, d, 4);
    ctx.strokeStyle = d;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-h + 4, 0); ctx.lineTo(h - 4, 0);
    ctx.moveTo(0, -h + 4); ctx.lineTo(0, 0);
    ctx.moveTo(-h / 2, 0); ctx.lineTo(-h / 2, h - 4);
    ctx.moveTo(h / 2, 0); ctx.lineTo(h / 2, h - 4);
    ctx.stroke();
  },

  spike(s, h, c, d) {
    rrect(-h + 8, -h + 8, h * 2 - 16, h * 2 - 16, 4, d);
    ctx.beginPath();
    const points = 16;
    for (let i = 0; i < points; i++) {
      const a = (i / points) * TAU, r = i % 2 ? h * 0.45 : h * 1.02;
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
    ctx.strokeStyle = d;
    ctx.lineWidth = 3;
    ctx.stroke();
    circle(0, 0, h * 0.25, d);
  },

  turret(s, h, c, d) {
    rrect(-h + 3, -h + 3, h * 2 - 6, h * 2 - 6, 8, d, '#2a2a2a', 3);
    ctx.rotate((s.angle || 0) - ((s.rot || 0) * Math.PI) / 2); // Zielwinkel ist in Weltkoordinaten
    rrect(0, -6, h + 8, 12, 3, '#3a3a3a', '#1f1f1f', 3);
    circle(0, 0, h * 0.62, c, d, 4);
    circle(0, 0, h * 0.25, d);
  },

  mine(s, h, c, d, ghost) {
    rrect(-h + 2, -h + 2, h * 2 - 4, h * 2 - 4, 6, c, d, 4);
    circle(0, 0, h * 0.55, '#2b2118');
    ctx.rotate(ghost ? 0 : now * 1.5);
    ctx.strokeStyle = '#f4c63d';
    ctx.lineWidth = 4;
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(-h * 0.45, 0);
      ctx.lineTo(h * 0.45, 0);
      ctx.stroke();
    }
  },

  // Schwelle + zwei Pfosten; das Türblatt schwingt auf, wenn jemand aus dem Team davorsteht
  door(s, h, c, d, ghost) {
    rrect(-h + 2, -h + 10, h * 2 - 4, h * 2 - 20, 4, 'rgba(60,44,30,0.55)');
    rrect(-h + 2, -9, 9, 18, 3, d, '#1f1f1f', 2);
    rrect(h - 11, -9, 9, 18, 3, d, '#1f1f1f', 2);
    const self = players.get(myId);
    const open = !ghost && isAllied(s.owner) && self && Math.hypot(self.dx - s.x, self.dy - s.y) < h + 45;
    s.openAnim = (s.openAnim || 0) + ((open ? 1 : 0) - (s.openAnim || 0)) * 0.2;
    ctx.save();
    ctx.translate(-h + 11, 0);
    ctx.rotate(-s.openAnim * Math.PI * 0.5);
    rrect(0, -6, h * 2 - 22, 12, 3, c, d, 3);
    ctx.strokeStyle = d;
    ctx.lineWidth = 1.5;
    for (const px of [h * 0.5, h]) {
      ctx.beginPath();
      ctx.moveTo(px, -5); ctx.lineTo(px, 5);
      ctx.stroke();
    }
    circle(h * 2 - 30, 0, 2.5, '#2a2a2a');
    ctx.restore();
  },

  // Rahmen in Level-Farbe, Glas mit Sprossen
  window(s, h, c, d) {
    rrect(-h + 2, -h + 2, h * 2 - 4, h * 2 - 4, 6, c, d, 4);
    rrect(-h + 10, -h + 10, h * 2 - 20, h * 2 - 20, 3, 'rgba(160,215,255,0.55)', d, 2);
    ctx.strokeStyle = d;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -h + 10); ctx.lineTo(0, h - 10);
    ctx.moveTo(-h + 10, 0); ctx.lineTo(h - 10, 0);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-h + 14, -6); ctx.lineTo(-6, -h + 14);
    ctx.stroke();
  },

  // Glühende Esse und ein Amboss in Level-Farbe
  forge(s, h, c, d, ghost) {
    rrect(-h + 2, -h + 2, h * 2 - 4, h * 2 - 4, 6, '#4a4440', d, 4);
    const glow = ghost ? 0.8 : 0.65 + Math.sin(now * 7) * 0.2 + Math.sin(now * 13) * 0.1;
    circle(-h * 0.45, -h * 0.45, h * 0.32, `rgba(255,${120 + glow * 60},40,${glow})`, '#2a1d14', 2);
    ctx.beginPath();
    for (const [i, [x, y]] of [[-0.55, -0.05], [0.7, -0.05], [0.45, 0.2], [0.2, 0.2], [0.3, 0.55], [-0.35, 0.55], [-0.2, 0.2], [-0.4, 0.2]].entries()) {
      ctx[i ? 'lineTo' : 'moveTo'](x * h, y * h);
    }
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
    ctx.strokeStyle = '#1f1f1f';
    ctx.lineWidth = 3;
    ctx.stroke();
  },

  // Holztruhe mit Deckelkante und Beschlägen in Level-Farbe
  storage(s, h, c, d) {
    rrect(-h + 5, -h + 9, h * 2 - 10, h * 2 - 16, 5, '#8a5a2b', '#3d2510', 3);
    rrect(-h + 5, -h + 9, h * 2 - 10, h * 0.62, 5, '#a46c35', '#3d2510', 3);
    for (const bx of [-h * 0.5, h * 0.5]) rrect(bx - 3, -h + 9, 6, h * 2 - 16, 1.5, c, d, 1.5);
    rrect(-5, -h * 0.25, 10, 10, 2, c, '#1f1f1f', 2);
  },

  // Steinofen mit Schornstein; brennt er, glüht die Öffnung und es steigt Rauch auf
  furnace(s, h, c, d, ghost) {
    rrect(-h + 3, -h + 3, h * 2 - 6, h * 2 - 6, 10, '#6e6862', '#2e2a27', 4);
    for (const [bx, by] of [[-0.55, -0.5], [0.1, -0.5], [-0.25, 0.05], [0.4, 0.05]]) rrect(bx * h, by * h, h * 0.45, h * 0.32, 3, '#857e77');
    const burning = !!s.active || ghost;
    const glow = burning ? 0.7 + Math.sin(now * 9) * 0.15 + Math.sin(now * 17) * 0.1 : 0;
    rrect(-h * 0.45, h * 0.12, h * 0.9, h * 0.6, 6, burning ? `rgba(255,${110 + glow * 70},30,${0.55 + glow * 0.4})` : '#1d1b1a', '#1f1f1f', 3);
    rrect(h * 0.38, -h * 0.85, h * 0.4, h * 0.4, 3, c, d, 2.5); // Schornstein in Level-Farbe
    if (burning && !ghost) {
      for (let i = 0; i < 3; i++) {
        const t = (now * 0.6 + i / 3) % 1;
        circle(h * 0.58 + Math.sin(t * 6 + i) * 4, -h * 0.65 - t * 30, 4 + t * 7, `rgba(90,90,90,${0.45 * (1 - t)})`);
      }
    }
  },

  // Steinring mit Holzscheiten; brennt es, flackern Flammen und Funken steigen auf
  campfire(s, h, c, d, ghost) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      circle(Math.cos(a) * h * 0.72, Math.sin(a) * h * 0.72, h * 0.22, i % 2 ? '#8b9196' : '#7a8086', '#4a4f53', 2);
    }
    circle(0, 0, h * 0.52, '#2b211a');
    for (const a of [0.3, 1.9, 3.5]) {
      ctx.save();
      ctx.rotate(a);
      rrect(-h * 0.5, -h * 0.09, h, h * 0.18, 3, '#7a5228', '#3d2510', 2);
      ctx.restore();
    }
    if (!s.active && !ghost) return;
    const f = ghost ? 0.8 : 0.75 + Math.sin(now * 11 + s.id) * 0.15 + Math.sin(now * 23) * 0.1;
    circle(0, 0, h * 0.5 * f, 'rgba(255,120,30,0.55)');
    circle(0, 0, h * 0.34 * f, 'rgba(255,190,60,0.9)');
    circle(0, 0, h * 0.16 * f, '#fff3b0');
    if (ghost) return;
    for (let i = 0; i < 3; i++) {
      const t = (now * 0.9 + i / 3) % 1;
      circle(Math.sin(t * 9 + i * 2) * 6, -t * 34, 2.4 * (1 - t), `rgba(255,170,60,${1 - t})`);
    }
  },

  // Liegender Block mit pulsierendem Kristall; die Punkte rechts zeigen das Level
  core(s, h, c, d, ghost, hw, hh) {
    rrect(-hw + 3, -hh + 3, hw * 2 - 6, hh * 2 - 6, 10, d, '#1f1f1f', 4);
    rrect(-hw + 10, -hh + 10, hw * 2 - 20, hh * 2 - 20, 6, c);
    const pulse = 1 + Math.sin(now * 3) * 0.06, k = hh * 0.42;
    ctx.save();
    ctx.translate(-hw * 0.3, 0);
    ctx.rotate(Math.PI / 4);
    ctx.scale(pulse, pulse);
    rrect(-k, -k, k * 2, k * 2, 5, '#86e6ff', '#2a8fb0', 3);
    ctx.restore();
    for (let i = 0; i <= s.level; i++) circle(hw * 0.15 + (i % 3) * 10, i < 3 ? -5 : 6, 3.5, '#fff', '#222', 1.5);
  },
};

// Halbtransparente Vorschau des gewählten Gebäudes an der Mausposition
export function drawBuildGhost() {
  if (ui.inv || ui.char || ui.panel) return;
  if (ui.selected === 0 || !ui.buildType || me.dead) return;
  const type = ui.buildType, wm = screenToWorld(mouse.x, mouse.y), g = snap(type, wm.x, wm.y, ui.buildRot);
  const err = placementError(type, g);
  ctx.globalAlpha = 0.55;
  drawStruct({ type, x: g.x, y: g.y, level: 0, hp: 1, maxHp: 1, owner: myId, angle: -Math.PI / 2, rot: ui.buildRot }, true);
  ctx.globalAlpha = 1;
  ctx.fillStyle = err ? 'rgba(255,60,60,0.35)' : 'rgba(90,255,90,0.25)';
  ctx.fillRect(g.x - g.hw, g.y - g.hh, g.hw * 2, g.hh * 2);
  ctx.font = 'bold 13px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText('[R] drehen', g.x, g.y + g.hh + 18);
  if (type === 'turret') {
    ctx.beginPath();
    ctx.arc(g.x, g.y, cfg.STRUCTURES.turret.levels[0].range, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// ---------- Gegner & Tiere (schauen in +x-Richtung) ----------

// Augenfarbe eines Raubtiers: je hungriger, desto röter; rasend (Hunger 0) glühen sie
function predatorEyes(z, calm) {
  if (!(z.hunger >= 0)) return { color: calm, glow: 0 };
  const h = 1 - z.hunger / 10;
  return { color: mixColor(calm, '#ff2418', h), glow: h > 0.85 ? (h - 0.85) / 0.15 : 0 };
}

function mixColor(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (shift) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function drawEyes(x, y, r, eyes) {
  for (const side of [-1, 1]) {
    if (eyes.glow) circle(x, side * y, r * 2.6, `rgba(255,40,20,${0.35 * eyes.glow})`);
    circle(x, side * y, r, eyes.color);
  }
}

// Fertig gezeichnete Figuren als Bild: Zombies und Schweine sehen ohne Angriff immer gleich aus. In Städten
// sind es dutzende – ein drawImage statt ~10 Füllungen und Konturen pro Figur entlastet vor allem Firefox.
// Schlüssel enthält den Maßstab (Pixel pro Welteinheit), damit die Bilder scharf bleiben.
const sprites = new Map();
let spriteScale = 0;
function drawSprite(key, extent, draw) {
  const m = ctx.getTransform(), k = Math.round(Math.hypot(m.a, m.b) * 100) / 100;
  if (k !== spriteScale) { sprites.clear(); spriteScale = k; }
  let c = sprites.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = Math.ceil(extent * 2 * k) + 2;
    const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, c.width / 2, c.height / 2);
    drawInto(g, draw);
    sprites.set(key, c);
  }
  const s = c.width / k;
  ctx.drawImage(c, -s / 2, -s / 2, s, s);
}

function drawZombieBody(type, r, lunge) {
  const color = ZOMBIE_COLORS[type];
  for (const side of [-1, 1]) circle(r * 0.75 + lunge, side * r * 0.62, r * 0.32, color, '#253a19', 3);
  circle(0, 0, r, color, '#253a19', 4);
  const eye = clock[1] ? '#ff3b3b' : '#1d1d1d'; // nachts rote Augen
  circle(r * 0.45, -r * 0.3, r * 0.14, eye);
  circle(r * 0.45, r * 0.3, r * 0.14, eye);
}

export function drawZombie(z) {
  const r = z.r || cfg.ENEMIES[z.type].r, t = now - z.swingT;
  const lunge = t < 0.25 ? Math.sin((t / 0.25) * Math.PI) * r * 0.45 : 0; // Vorstoß beim Angriff
  ctx.save();
  ctx.translate(z.dx, z.dy);
  ctx.rotate(z.da);
  if (z.type === 'wolf') drawWolf(r, lunge, z.alpha, predatorEyes(z, '#ffd23f'));
  else if (z.type === 'pig') {
    if (lunge) drawPig(r, lunge, z.aggro);
    else drawSprite(`pig:${r}:${!!z.aggro}`, r * 1.3 + 3, () => drawPig(r, 0, z.aggro));
  } else if (z.type === 'bear') drawBear(r, lunge, predatorEyes(z, '#1d1d1d'));
  else if (lunge) drawZombieBody(z.type, r, lunge);
  else drawSprite(`${z.type}:${r}:${clock[1] ? 1 : 0}`, r * 1.1 + 3, () => drawZombieBody(z.type, r, 0));
  ctx.restore();
  if (z.hp < z.maxHp) hpBar(z.dx, z.dy - r - 14, r * 2, z.hp / z.maxHp, '#e05555');
}

// Alpha: dunkles Fell mit heller Halskrause
const WOLF_FUR = { normal: ['#80868c', '#6e7378', '#5d6267', '#8d9399'], alpha: ['#3f4347', '#34383b', '#2a2d30', '#4a4f53'] };

function drawWolf(r, lunge, alpha, eyes) {
  const [body, tail, ear, head] = WOLF_FUR[alpha ? 'alpha' : 'normal'];
  ctx.save();
  ctx.translate(-r * 1.1, 0);
  ctx.rotate(Math.sin(now * 10) * 0.3); // Schwanzwedeln
  ellipse(-r * 0.4, 0, r * 0.55, r * 0.22, tail, '#1f2123', 3);
  ctx.restore();
  ellipse(0, 0, r * 1.15, r * 0.7, body, '#1f2123', 4);
  if (alpha) ellipse(r * 0.55, 0, r * 0.35, r * 0.62, '#c9ccd0', '#1f2123', 2); // Halskrause
  const hx = r * 0.95 + lunge;
  for (const side of [-1, 1]) { // Ohren
    ctx.beginPath();
    ctx.moveTo(hx - r * 0.1, side * r * 0.25);
    ctx.lineTo(hx - r * 0.35, side * r * 0.75);
    ctx.lineTo(hx + r * 0.15, side * r * 0.4);
    ctx.closePath();
    ctx.fillStyle = ear;
    ctx.fill();
  }
  circle(hx, 0, r * 0.5, head, '#1f2123', 3);
  ellipse(hx + r * 0.45, 0, r * 0.3, r * 0.22, alpha ? '#8d9399' : '#b8bdc1', '#1f2123', 2);
  circle(hx + r * 0.72, 0, r * 0.1, '#1d1d1d');
  drawEyes(hx + r * 0.15, r * 0.2, r * 0.09, eyes);
}

function drawPig(r, lunge, angry) {
  ellipse(0, 0, r * 1.1, r * 0.85, '#d98f8a', '#8a4e4a', 4);
  for (const side of [-1, 1]) { // Ohren
    ctx.beginPath();
    ctx.moveTo(r * 0.3, side * r * 0.45);
    ctx.lineTo(r * 0.05, side * r * 0.95);
    ctx.lineTo(r * 0.6, side * r * 0.7);
    ctx.closePath();
    ctx.fillStyle = '#c47a75';
    ctx.fill();
    ctx.strokeStyle = '#8a4e4a';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  const sx = r * 0.95 + lunge;
  ellipse(sx, 0, r * 0.32, r * 0.4, '#f2b3ae', '#8a4e4a', 3); // Rüssel
  circle(sx + r * 0.05, -r * 0.14, r * 0.08, '#8a4e4a');
  circle(sx + r * 0.05, r * 0.14, r * 0.08, '#8a4e4a');
  for (const side of [-1, 1]) circle(sx - r * 0.15, side * r * 0.42, r * 0.09, '#fff5e0', '#8a4e4a', 1.5); // Hauer
  const eye = angry ? '#d81f1f' : '#2a1a18';
  circle(r * 0.45, -r * 0.35, r * 0.1, eye);
  circle(r * 0.45, r * 0.35, r * 0.1, eye);
}

function drawBear(r, lunge, eyes) {
  for (const side of [-1, 1]) circle(r * 0.7 + lunge, side * r * 0.75, r * 0.3, '#6b4423', '#3a2412', 3); // Pranken
  circle(0, 0, r, '#7a4e2a', '#3a2412', 5);
  circle(-r * 0.15, 0, r * 0.65, '#86582f');
  const hx = r * 0.55 + lunge * 0.5;
  for (const side of [-1, 1]) circle(hx - r * 0.1, side * r * 0.5, r * 0.2, '#6b4423', '#3a2412', 3); // Ohren
  circle(hx, 0, r * 0.5, '#7a4e2a', '#3a2412', 3);
  ellipse(hx + r * 0.38, 0, r * 0.24, r * 0.2, '#c9a27a', '#3a2412', 2);
  circle(hx + r * 0.55, 0, r * 0.09, '#1d1d1d');
  drawEyes(hx + r * 0.12, r * 0.2, r * 0.07, eyes);
}

// ---------- Spielfiguren ----------

export function drawPlayer(p) {
  const r = cfg.PLAYER.radius, isMe = p.id === myId;
  ctx.save();
  ctx.translate(p.dx, p.dy);
  ctx.rotate(isMe ? myAngle : p.da);
  const [weapon, head, chest] = p.look || [];
  drawHandsAndWeapon(cfg.EQUIPMENT[weapon], r, now - p.swingT);
  circle(0, 0, r, isMe ? SKIN : SKIN_OTHER, SKIN_LINE, 4);
  drawClothes(cfg.EQUIPMENT[chest], cfg.EQUIPMENT[head], r);
  ctx.restore();

  // Name (Teammitglieder grün), Sprechblase, Schutzblase, Leben
  const mate = !isMe && me.team && p.team === me.team.id;
  outlinedText(mate ? `👥 ${p.name}` : p.name, p.dx, p.dy - r - 12, { color: isMe ? '#fff' : mate ? '#7fe0a0' : '#ffe9b0' });
  const bubble = bubbles.get(p.id);
  if (bubble && now - bubble.t < 6) drawBubble(bubble.text, p.dx, p.dy - r - 34, Math.min(1, (6 - (now - bubble.t)) * 2));
  else if (bubble) bubbles.delete(p.id);
  if (p.prot) drawProtectionBubble(p, r);
  if (p.hp < p.maxHp) hpBar(p.dx, p.dy + r + 10, 52, p.hp / p.maxHp, '#7ed957');
}

// Hände und Waffe je nach Waffenart; t = Sekunden seit dem letzten Angriff
function drawHandsAndWeapon(def, r, t) {
  const hand = (x, y, size = 0.3) => circle(x, y, r * size, SKIN, SKIN_LINE, 3);
  const swing = t < 0.28 ? Math.sin((t / 0.28) * Math.PI) : 0;
  const kind = def ? def.kind : 'fist';

  if (kind === 'gun') {
    const recoil = t < 0.12 ? (1 - t / 0.12) * 7 : 0;
    ctx.save();
    ctx.translate(r * 0.55 - recoil, r * 0.18);
    drawGun(def.model);
    ctx.restore();
    hand(r * 0.62 - recoil, r * 0.28, 0.28);
    if (def.model === 'pistol') hand(r * 0.45 - recoil, -r * 0.2, 0.26);
    else hand(r * 1.35 - recoil, r * 0.42, 0.26);
  } else if (kind === 'bow') {
    // Bogen vorne mit beiden Händen; nach dem Schuss schnellt die Sehne zurück
    const pull = t < 0.3 ? 1 - t / 0.3 : 0;
    ctx.save();
    ctx.translate(r * 0.95, 0);
    drawWeapon(def, pull);
    ctx.restore();
    hand(r * 0.95, -r * 0.3, 0.28);
    hand(r * 0.5 - pull * 8, r * 0.25, 0.28);
  } else if (kind === 'spear') {
    // Speer: Stoß nach vorne statt Schwung
    const thrust = swing * 26;
    ctx.save();
    ctx.translate(r * 0.2 + thrust, r * 0.7);
    ctx.rotate(-0.08);
    drawWeapon(def);
    ctx.restore();
    hand(r * 0.72 + thrust, r * 0.75);
    hand(r * 0.72, -r * 0.72);
  } else {
    // Axt, Schwert, Dolch in der rechten Hand, schwingen nach vorne (ohne Waffe: Faustschlag)
    const arc = kind === 'dagger' ? 1.0 : kind === 'sword' ? 1.9 : 1.5;
    ctx.save();
    ctx.rotate(0.35 - swing * arc);
    if (def) {
      ctx.save();
      ctx.translate(r * 0.55, r * 0.75);
      drawWeapon(def);
      ctx.restore();
    }
    hand(r * 0.72 + (def ? 0 : swing * 12), r * 0.75);
    ctx.restore();
    hand(r * 0.72, -r * 0.72);
  }
}

function drawClothes(chestDef, headDef, r) {
  if (chestDef) {
    // Shirt/Rüstung als Ring um den Körper
    const [c, d] = ARMOR_COLORS[chestDef.tier];
    ctx.beginPath();
    ctx.arc(0, 0, r - 3, 0, TAU);
    ctx.strokeStyle = c;
    ctx.lineWidth = 7;
    ctx.stroke();
    circle(0, 0, r + 1, null, d, 2.5);
  }
  if (headDef) {
    const [c, d] = ARMOR_COLORS[headDef.tier];
    circle(-r * 0.12, 0, r * 0.62, c, d, 3);
    if (headDef.tier === 1) rrect(-r * 0.12 - 3, -r * 0.62, 6, r * 1.24, 2, d); // Helmkamm
  }
}

function drawProtectionBubble(p, r) {
  const pulse = 0.5 + Math.sin(now * 3 + p.id) * 0.5;
  const g = ctx.createRadialGradient(p.dx, p.dy, r * 0.8, p.dx, p.dy, r + 16);
  g.addColorStop(0, 'rgba(130,210,255,0)');
  g.addColorStop(1, `rgba(130,210,255,${0.18 + pulse * 0.12})`);
  circle(p.dx, p.dy, r + 16, g, `rgba(170,230,255,${0.45 + pulse * 0.35})`, 2);
}

// Sprechblase (Weltkoordinaten), Spitze unten mittig bei (x, y)
function drawBubble(str, x, y, alpha) {
  ctx.font = '14px Segoe UI, sans-serif';
  const lines = wrapText(str, 220).slice(0, 4);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18, h = lines.length * 17 + 10;
  ctx.globalAlpha = alpha;
  rrect(x - w / 2, y - h, w, h, 8, 'rgba(255,255,255,0.92)', 'rgba(0,0,0,0.35)', 1.5);
  ctx.beginPath();
  ctx.moveTo(x - 6, y); ctx.lineTo(x, y + 7); ctx.lineTo(x + 6, y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();
  ctx.fillStyle = '#1b1b1b';
  ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, x, y - h + 19 + i * 17));
  ctx.globalAlpha = 1;
}

// Ring um die eigene Figur: sichtbar, solange Ausdauer fehlt oder gesprintet wird
let staminaFade = 0;
export function drawStaminaRing() {
  const self = players.get(myId);
  if (!self || me.dead) return;
  const frac = me.st / me.stats.stamina;
  staminaFade = frac >= 1 && !self.sprint ? Math.max(0, staminaFade - 0.04) : 1;
  if (staminaFade <= 0) return;
  const r = cfg.PLAYER.radius + 11;
  ctx.globalAlpha = staminaFade;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(self.dx, self.dy, r, 0, TAU);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 6;
  ctx.stroke();
  const color = me.ex ? (Math.sin(now * 14) > 0 ? '#ff4040' : '#a01818') : frac > 0.5 ? '#8fe36a' : frac > 0.25 ? '#f5c84a' : '#ff7a4a';
  ctx.beginPath();
  ctx.arc(self.dx, self.dy, r, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.globalAlpha = 1;
}

// Gestrichelte Ziellinie bis zur Schussweite, wenn eine Fernwaffe ausgerüstet ist
export function drawAimLine() {
  const self = players.get(myId);
  if (!self || me.dead || !me.stats.ranged || ui.selected !== 0 || ui.inv || ui.char || ui.panel) return;
  const r = cfg.PLAYER.radius + 14, len = me.stats.range;
  const proj = cfg.EQUIPMENT[me.eq.weapon].projectile, spread = proj.pellets > 1 ? proj.spread : 0;
  ctx.setLineDash([10, 12]);
  ctx.strokeStyle = (me.res[me.ammo] || 0) > 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,90,90,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const da of spread ? [-spread, spread] : [0]) {
    const a = myAngle + da;
    ctx.moveTo(self.dx + Math.cos(a) * r, self.dy + Math.sin(a) * r);
    ctx.lineTo(self.dx + Math.cos(a) * len, self.dy + Math.sin(a) * len);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

// ---------- Items & Geschosse ----------

export function drawGroundItem(it) {
  const bob = Math.sin(now * 3 + it.id) * 3;
  circle(it.x, it.y + 12, 14, 'rgba(0,0,0,0.18)');
  // Seltene Ausrüstung leuchtet in ihrer Farbe
  if (it.r) circle(it.x, it.y + bob, 22 + Math.sin(now * 4 + it.id) * 2, cfg.GEAR.rarities[it.r].color + '55', cfg.GEAR.rarities[it.r].color, 2);
  drawItemIcon(it.item, it.x, it.y + bob, 34);
  if (it.n > 1 || !cfg.EQUIPMENT[it.item]) outlinedText(String(it.n), it.x + 14, it.y + 18 + bob, { size: 13, outline: 'rgba(0,0,0,0.65)', width: 3 });
}

// Geschoss [x, y, Winkel, Aussehen]: 1 = Kugel mit Leuchtspur, sonst Pfeil mit Spitze nach Typ
export function drawProjectile([x, y, angle, look]) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (look === 1) {
    const trail = ctx.createLinearGradient(-26, 0, 4, 0);
    trail.addColorStop(0, 'rgba(255,220,120,0)');
    trail.addColorStop(1, 'rgba(255,240,180,0.95)');
    ctx.fillStyle = trail;
    ctx.fillRect(-26, -1.5, 30, 3);
    circle(3, 0, 2.5, '#fff6d0');
  } else {
    const [tip, tipDark] = ARROW_TIPS[look] || ARROW_TIPS[0];
    rrect(-12, -1.5, 20, 3, 1.5, '#8a6236');
    ctx.beginPath();
    ctx.moveTo(6, -4); ctx.lineTo(13, 0); ctx.lineTo(6, 4);
    ctx.closePath();
    ctx.fillStyle = tip; ctx.fill();
    ctx.strokeStyle = tipDark; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#e8e2d0';
    ctx.fillRect(-13, -3.5, 5, 2.5);
    ctx.fillRect(-13, 1, 5, 2.5);
  }
  ctx.restore();
}

// Schwebender Hinweis wie "[F] Truhe" über einem Objekt
export function drawPrompt(label, x, y) {
  outlinedText(label, x, y + Math.sin(now * 4) * 3, { color: '#ffd76a', outline: 'rgba(0,0,0,0.7)' });
}
