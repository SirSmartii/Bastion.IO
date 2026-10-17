// Gebäude, Gegner & Tiere, Spielfiguren, Items am Boden und Geschosse.

import { ctx, cfg, me, myId, now, players, clock, myAngle, ui, mouse, screenToWorld, drawInto } from '../state.js';
import { TAU, LEVEL_COLORS, LEVEL_DARK, ZOMBIE_COLORS, ARROW_TIPS } from '../constants.js';
import { circle, rrect, hpBar, outlinedText, wrapText } from './primitives.js';
import { drawItemIcon, drawWeapon, drawGun, gearColors } from './items.js';
import { art, artMisses } from '../assets.js';
import { isAllied, snap, placementError, structSize } from '../rules.js';
import { bubbles } from '../chat.js';
import { t } from '../i18n.js';

const SKIN = '#f0c8a0', SKIN_OTHER = '#e8bc92';

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

// Ein Zeichner pro Gebäudetyp: (Gebäude, halbe Kantenlänge, Levelfarbe, dunkle Levelfarbe, Vorschau?).
// Grafiken unter assets/structures/ (Feld 50 × 50); bewegte Teile (Geschütz, Rotor, Tür, Glut) extra.
const STRUCTURE_SHAPES = {
  wall(s, h, C, D) { art('structures/wall', { C, D }); },
  spike(s, h, C, D) { art('structures/spike', { C, D }); },
  window(s, h, C, D) { art('structures/window', { C, D }); },
  storage(s, h, C, D) { art('structures/storage', { C, D }); },
  tanner() { art('structures/tanner'); },
  sleeping_bag() { art('structures/sleeping_bag'); },

  turret(s, h, C, D) {
    art('structures/turret_base', { C, D });
    ctx.rotate((s.angle || 0) - ((s.rot || 0) * Math.PI) / 2); // Zielwinkel ist in Weltkoordinaten
    art('structures/turret_gun', { C, D });
  },

  mine(s, h, C, D, ghost) {
    art('structures/mine_base', { C, D });
    ctx.rotate(ghost ? 0 : now * 1.5);
    art('structures/mine_rotor');
  },

  // Schwelle + zwei Pfosten; das Türblatt schwingt auf, wenn jemand aus dem Team davorsteht
  door(s, h, C, D, ghost) {
    art('structures/door_frame', { C, D });
    const self = players.get(myId);
    const open = !ghost && isAllied(s.owner) && self && Math.hypot(self.dx - s.x, self.dy - s.y) < h + 45;
    s.openAnim = (s.openAnim || 0) + ((open ? 1 : 0) - (s.openAnim || 0)) * 0.2;
    ctx.save();
    ctx.translate(-h + 11, 0);
    ctx.rotate(-s.openAnim * Math.PI * 0.5);
    art('structures/door_leaf', { C, D });
    ctx.restore();
  },

  // Esse glüht flackernd
  forge(s, h, C, D, ghost) {
    art('structures/forge', { C, D });
    const glow = ghost ? 0.8 : 0.65 + Math.sin(now * 7) * 0.2 + Math.sin(now * 13) * 0.1;
    circle(-h * 0.45, -h * 0.45, h * 0.26, `rgba(255,${120 + glow * 60},40,${glow})`);
  },

  // Brennt er, glüht die Öffnung und es steigt Rauch auf
  furnace(s, h, C, D, ghost) {
    art('structures/furnace', { C, D });
    if (!s.active && !ghost) return;
    ctx.globalAlpha *= ghost ? 1 : 0.8 + Math.sin(now * 9) * 0.12 + Math.sin(now * 17) * 0.08;
    art('structures/furnace_glow');
    ctx.globalAlpha = 1;
    if (ghost) return;
    for (let i = 0; i < 3; i++) {
      const t = (now * 0.6 + i / 3) % 1;
      circle(h * 0.58 + Math.sin(t * 6 + i) * 4, -h * 0.65 - t * 30, 4 + t * 7, `rgba(90,90,90,${0.45 * (1 - t)})`);
    }
  },

  // Brennt es, flackern Flammen und Funken steigen auf
  campfire(s, h, C, D, ghost) {
    art('structures/campfire');
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
  core(s, h, C, D, ghost, hw, hh) {
    art('structures/core_base', { C, D });
    const pulse = 1 + Math.sin(now * 3) * 0.06;
    ctx.save();
    ctx.translate(-hw * 0.3, 0);
    ctx.rotate(Math.PI / 4);
    ctx.scale(pulse, pulse);
    art('structures/core_crystal');
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
  ctx.fillText(t('[R] drehen'), g.x, g.y + g.hh + 18);
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
    const misses = artMisses;
    drawInto(g, draw);
    // Grafik noch nicht geladen: nicht merken, sonst bliebe die Figur dauerhaft unsichtbar
    if (artMisses === misses) sprites.set(key, c);
  }
  const s = c.width / k;
  ctx.drawImage(c, -s / 2, -s / 2, s, s);
}

// Untote: Körper und Arme aus assets/creatures/undead (gezeichnet für Radius 22), Augen nachts rot
function drawZombieBody(type, r, lunge) {
  const C = ZOMBIE_COLORS[type], k = r / 22;
  ctx.save();
  ctx.scale(k, k);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(16.5 + lunge / k, side * 13.6);
    art('creatures/undead/zombie_arm', { C });
    ctx.restore();
  }
  art('creatures/undead/zombie_body', { C });
  ctx.restore();
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
  drawEnemyLevel(z, r);
}

// Stufe neben dem Lebensbalken (gefährliche Arten ab Lv 3 immer). Farbe im Vergleich zur eigenen Waffe:
// weiß = passt, orange = etwas zu schwach, rot = deutlich zu schwach (Stufe ≈ empfohlenes Material, siehe ENEMIES.level)
const LEVEL_TIER = [0, 1, 1, 2, 3, 4, 4, 5, 5, 6];
function drawEnemyLevel(z, r) {
  const def = cfg.ENEMIES[z.type], level = (def.level || 1) + (z.alpha ? 1 : 0);
  if (z.hp >= z.maxHp && level < 3) return;
  const weapon = cfg.EQUIPMENT[me.eq.weapon], mine = (weapon && weapon.tier) || 0, need = LEVEL_TIER[Math.min(level, 9)];
  const color = need > mine + 1 ? '#ff6a5a' : need > mine ? '#ffb347' : '#f2efe6';
  outlinedText(`Lv ${level}`, z.dx - r - 6, z.dy - r - 6, { size: 11, color, align: 'right', width: 3 });
}

// Alpha: dunkles Fell mit heller Halskrause. Fell [Körper, Schwanz, Ohren, Kopf] und Schnauze
const WOLF_FUR = {
  normal: { C: '#80868c', F: '#8d9399', E: '#b8bdc1' },
  alpha: { C: '#3f4347', F: '#4a4f53', E: '#8d9399' },
};

// Tiere aus assets/creatures/animals, jeweils für einen Bezugsradius gezeichnet und auf r skaliert
function drawWolf(r, lunge, alpha, eyes) {
  const fur = WOLF_FUR[alpha ? 'alpha' : 'normal'], k = r / 20;
  ctx.save();
  ctx.scale(k, k);
  ctx.save();
  ctx.translate(-22, 0);
  ctx.rotate(Math.sin(now * 10) * 0.3); // Schwanzwedeln
  art('creatures/animals/wolf_tail', fur);
  ctx.restore();
  ctx.translate(lunge / k, 0);
  art('creatures/animals/wolf_body', fur);
  if (alpha) art('creatures/animals/wolf_ruff');
  ctx.restore();
  drawEyes(r * 0.95 + lunge + r * 0.15, r * 0.2, r * 0.09, eyes);
}

function drawPig(r, lunge, angry) {
  ctx.save();
  ctx.scale(r / 24, r / 24);
  art('creatures/animals/pig');
  ctx.restore();
  const eye = angry ? '#d81f1f' : '#2a1a18';
  circle(r * 0.45, -r * 0.35, r * 0.1, eye);
  circle(r * 0.45, r * 0.35, r * 0.1, eye);
}

function drawBear(r, lunge, eyes) {
  const k = r / 36;
  ctx.save();
  ctx.scale(k, k);
  for (const side of [-1, 1]) { // Pranken
    ctx.save();
    ctx.translate(25.2 + lunge / k, side * 27);
    art('creatures/animals/bear_paw');
    ctx.restore();
  }
  art('creatures/animals/bear_body');
  ctx.translate((lunge * 0.5) / k, 0);
  art('creatures/animals/bear_head');
  ctx.restore();
  drawEyes(r * 0.55 + lunge * 0.5 + r * 0.12, r * 0.2, r * 0.07, eyes);
}

// ---------- Spielfiguren ----------

export function drawPlayer(p) {
  const r = cfg.PLAYER.radius, isMe = p.id === myId;
  ctx.save();
  ctx.translate(p.dx, p.dy);
  ctx.rotate(isMe ? myAngle : p.da);
  const [weapon, head, chest, back] = p.look || [];
  drawHandsAndWeapon(cfg.EQUIPMENT[weapon], r, now - p.swingT);
  ctx.save();
  ctx.scale(r / 24, r / 24); // assets/player ist für Radius 24 gezeichnet
  if (cfg.EQUIPMENT[back]) art('player/worn/backpack', gearColors(cfg.EQUIPMENT[back])); // Rucksack hinter dem Körper
  art('player/body', { C: isMe ? SKIN : SKIN_OTHER });
  drawClothes(cfg.EQUIPMENT[chest], cfg.EQUIPMENT[head]);
  ctx.restore();
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
  const hand = (x, y, size = 0.3) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale((r * size) / 7.2, (r * size) / 7.2);
    art('player/hand', { C: SKIN });
    ctx.restore();
  };
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

// Getragene Kleidung von oben (assets/player/worn, Radius 24): Ring um den Körper, Helm auf dem Kopf
function drawClothes(chestDef, headDef) {
  if (chestDef) art(`player/worn/${chestDef.style}_chest`, gearColors(chestDef));
  if (headDef) art(`player/worn/${headDef.style}_head`, gearColors(headDef));
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
