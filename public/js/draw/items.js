// Item-Symbole (Inventar, Boden, Hotbar) und Waffen (auch in der Hand der Spielfiguren).

import { ctx, cfg } from '../state.js';
import { TAU, LEVEL_COLORS, LEVEL_DARK, ARROW_TIPS, ARMOR_COLORS } from '../constants.js';
import { circle, ellipse, rrect, poly } from './primitives.js';

export const itemName = (item) => (cfg.EQUIPMENT[item] ? cfg.EQUIPMENT[item].name : cfg.ITEMS.names[item] || item);
export const stackMax = (item) => (cfg.EQUIPMENT[item] ? 1 : cfg.INVENTORY.stack[item]);

const STAT_LABELS = {
  damage: 'Schaden', gather: 'Abbau', armor: 'Rüstung', maxHp: 'Leben', speed: 'Tempo', regen: 'Regeneration', stamina: 'Ausdauer',
};

// ---------- Einzelstücke: Seltenheit, Stufe, Boni (d, siehe server/game/gear.js) ----------

export const rarityOf = (d) => cfg.GEAR.rarities[(d && d.r) || 0];
export const gearName = (item, d) => itemName(item) + (d && d.u ? ` +${d.u}` : '');

// "+12 % Schaden", "−3 Rüstung"
export function fmtMod(mod, v) {
  return `${v > 0 ? '+' : '−'}${String(Math.abs(v)).replace('.', ',')}${mod.pct ? ' %' : ''} ${mod.name}`;
}

// Tooltip-Zeilen: Seltenheit, Boni (grün), Fluch (rot)
export function gearLines(d) {
  const R = rarityOf(d), lines = [[`${R.name}${d && d.c ? ' · verflucht' : ''}`, R.color, true]];
  for (const [id, v] of (d && d.m) || []) lines.push([`  ${fmtMod(cfg.MODS[id], v)}`, '#9fe870']);
  if (d && d.c) lines.push([`  ${fmtMod(cfg.CURSES[d.c[0]], d.c[1])}`, '#ff7a6a']);
  return lines;
}

// Rahmen in Seltenheitsfarbe und "+2" in der Ecke eines Slots r
export function gearBadge(r, d) {
  if (!d) return;
  const R = rarityOf(d);
  if (d.r) rrect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 7, null, R.color, 2.5);
  if (d.c) circle(r.x + r.w - 8, r.y + 8, 4, '#c0392b', '#3a0d08', 1.5);
  if (d.u) {
    ctx.font = 'bold 13px Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(`+${d.u}`, r.x + 5, r.y + 15);
    ctx.fillStyle = '#ffd76a';
    ctx.fillText(`+${d.u}`, r.x + 5, r.y + 15);
  }
}

// Werte eines Ausrüstungsteils als Text. Waffen: absolute Werte; Kleidung: Boni mit Vorzeichen.
// d: Verbesserungsstufe erhöht den Hauptwert (Waffen: Schaden, Kleidung: Rüstung & Leben)
export function fmtStats(def, d) {
  const up = 1 + cfg.GEAR.upgradeBonus * ((d && d.u) || 0), main = def.slot === 'weapon' ? ['damage'] : ['armor', 'maxHp'];
  const st = Object.fromEntries(Object.entries(def.stats).map(([k, v]) => [k, main.includes(k) ? +(v * up).toFixed(1) : v]));
  if (def.slot !== 'weapon') return Object.entries(st).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${STAT_LABELS[k] || k}`).join(' · ');
  const pellets = def.projectile && def.projectile.pellets;
  const parts = [pellets ? `${pellets}×${st.damage} Schaden` : `${st.damage} Schaden`, `${st.attackSpeed || +(1 / cfg.PLAYER.attackCooldown).toFixed(1)}/s`];
  parts.push(st.range ? `Weite ${st.range}` : `Reichw. ${st.reach || cfg.PLAYER.reach}`);
  if (def.ammo) parts.push(cfg.AMMO[def.ammo].label);
  else if (st.mine) parts.push(`×${st.mine} Gestein`, `×${st.gather} Holz`);
  else parts.push(st.gather ? `×${st.gather} Abbau` : 'kein Abbau');
  return parts.join(' · ');
}

// Item-Symbol, zentriert auf (x, y) mit Größe s
export function drawItemIcon(item, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 40, s / 40);
  if (cfg.EQUIPMENT[item]) drawEquipShape(cfg.EQUIPMENT[item]);
  else if (item.startsWith('arrow')) drawArrowsIcon(item);
  else (ICONS[item] || (() => {}))();
  ctx.restore();
}

function drawArrowsIcon(item) {
  const [tip, tipDark] = ARROW_TIPS[cfg.AMMO.arrow.types.find((t) => t.item === item).look];
  ctx.rotate(-0.75);
  for (const oy of [-5, 5]) {
    rrect(-17, oy - 1.5, 30, 3, 1.5, '#a0784a', '#5a3d1e', 1);
    ctx.beginPath();
    ctx.moveTo(12, oy - 5); ctx.lineTo(21, oy); ctx.lineTo(12, oy + 5);
    ctx.closePath();
    ctx.fillStyle = tip; ctx.fill();
    ctx.strokeStyle = tipDark; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = '#e8e2d0';
    ctx.fillRect(-18, oy - 4, 6, 3);
    ctx.fillRect(-18, oy + 1, 6, 3);
  }
}

const leaf = (x, y, len, w, a, color) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ellipse(len / 2, 0, len / 2, w, color, 'rgba(20,50,15,0.6)', 1.2);
  ctx.restore();
};

function canteen(full) {
  rrect(-4, -17, 8, 6, 2, '#5a3d1e');
  ellipse(0, 3, 13, 14, '#8a6236', '#4a3019', 3);
  ellipse(0, 3, 8, 9, full ? '#5bb8f0' : '#6b4a28', full ? '#2a6f9a' : '#4a3019', 2);
  if (full) circle(-3, 0, 2.2, '#d6f0ff');
  rrect(-13, -2, 26, 3, 1, 'rgba(60,40,20,0.8)'); // Riemen
}

// Symbole der stapelbaren Items, jeweils um 0/0 mit etwa 40 px Größe
const ICONS = {
  bullet() {
    ctx.rotate(-0.6);
    for (const oy of [-7, 0, 7]) {
      rrect(-12, oy - 3, 16, 6, 1.5, '#c9a13a', '#7a5d14', 1.5);
      ctx.beginPath();
      ctx.moveTo(4, oy - 3); ctx.quadraticCurveTo(13, oy, 4, oy + 3);
      ctx.closePath();
      ctx.fillStyle = '#a8a8a8';
      ctx.fill();
    }
  },
  shell() {
    ctx.rotate(-0.6);
    for (const oy of [-6, 6]) {
      rrect(-14, oy - 5, 22, 10, 2, '#c8352c', '#7a1a14', 2);
      rrect(6, oy - 5, 8, 10, 2, '#d4b04a', '#7a5d14', 2);
    }
  },
  wood() {
    ctx.rotate(-0.5);
    for (const [ox, oy] of [[-3, 7], [3, -7]]) {
      rrect(-17 + ox, -6 + oy, 34, 12, 6, '#a8743f', '#5e3b1c', 2.5);
      circle(17 + ox, oy, 5.5, '#e2bb84', '#5e3b1c', 2.5);
      circle(17 + ox, oy, 2, '#a8743f');
    }
  },
  stone() {
    poly([[-16, 4], [-10, -12], [4, -15], [16, -6], [15, 9], [2, 15], [-12, 12]]);
    ctx.fillStyle = '#9aa1a8';
    ctx.fill();
    ctx.strokeStyle = '#5a6065';
    ctx.lineWidth = 3;
    ctx.stroke();
    poly([[-7, -2], [-3, -8], [5, -8], [6, 0], [-1, 3]]);
    ctx.fillStyle = '#b9bfc4';
    ctx.fill();
  },
  bone() {
    ctx.rotate(-0.6);
    rrect(-12, -4, 24, 8, 3, '#efe8d6', '#8f8670', 2.5);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) circle(sx * 13, sy * 5, 6, '#efe8d6', '#8f8670', 2.5);
    rrect(-12, -2.5, 24, 5, 2, '#efe8d6');
  },
  scrap() {
    ctx.rotate(0.3);
    circle(-4, 2, 12, '#7b8189', '#3f444a', 3);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      rrect(-4 + Math.cos(a) * 12 - 3, 2 + Math.sin(a) * 12 - 3, 6, 6, 1, '#7b8189', '#3f444a', 2);
    }
    circle(-4, 2, 4.5, '#2a2d31');
    rrect(4, -15, 14, 6, 2, '#a0662d', '#5a3510', 2);
  },
  fur() {
    poly([[-15, -10], [-4, -15], [12, -12], [17, 0], [13, 13], [-2, 15], [-16, 9], [-12, 0]]);
    ctx.fillStyle = '#9a7650';
    ctx.fill();
    ctx.strokeStyle = '#5a4128';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = '#7d5d3c';
    ctx.lineWidth = 2;
    for (const [x1, y1] of [[-8, -6], [0, -2], [-4, 5], [6, 4]]) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + 6, y1 + 3);
      ctx.stroke();
    }
  },
  meat() {
    ctx.rotate(-0.5);
    rrect(8, -3, 14, 6, 3, '#f3ead8', '#8f8670', 2);
    circle(22, -3, 4, '#f3ead8', '#8f8670', 2);
    circle(22, 3, 4, '#f3ead8', '#8f8670', 2);
    ellipse(-3, 0, 15, 12, '#c8463c', '#7a2620', 3);
    ellipse(-6, -3, 6, 4, '#e07a6e');
  },
  gold() {
    for (const [ox, oy, r] of [[-7, 5, 9], [7, 6, 8], [0, -6, 9]]) circle(ox, oy, r, '#f4c63d', '#a67c12', 3);
    circle(-2, -9, 3, '#fff3b8');
  },
  iron_ore() {
    poly([[-15, 6], [-11, -10], [3, -15], [15, -5], [14, 9], [1, 15], [-11, 13]]);
    ctx.fillStyle = '#7d736c';
    ctx.fill();
    ctx.strokeStyle = '#4a413b';
    ctx.lineWidth = 3;
    ctx.stroke();
    for (const [ox, oy, r] of [[-5, -3, 4.5], [5, 4, 4], [3, -8, 3]]) circle(ox, oy, r, '#c0703e', '#6e3a1c', 2);
  },
  coal() {
    for (const [ox, oy, r] of [[-7, 5, 9], [8, 4, 8], [1, -7, 8]]) {
      poly([[ox - r, oy], [ox - r * 0.4, oy - r], [ox + r * 0.7, oy - r * 0.6], [ox + r, oy + r * 0.3], [ox + r * 0.1, oy + r], [ox - r * 0.8, oy + r * 0.7]]);
      ctx.fillStyle = '#2e2e31';
      ctx.fill();
      ctx.strokeStyle = '#0b0b0c';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    circle(-1, -9, 2.5, '#7a7a80');
    circle(-9, 3, 2, '#7a7a80');
  },
  cooked_meat() {
    ctx.rotate(-0.5);
    rrect(8, -3, 14, 6, 3, '#f3ead8', '#8f8670', 2);
    circle(22, -3, 4, '#f3ead8', '#8f8670', 2);
    circle(22, 3, 4, '#f3ead8', '#8f8670', 2);
    ellipse(-3, 0, 15, 12, '#9a5a2a', '#4e2a10', 3);
    ellipse(-6, -3, 6, 4, '#c47a3a');
    for (const x of [-9, -2, 5]) rrect(x, -8, 2, 16, 1, 'rgba(50,25,8,0.6)'); // Grillstreifen
  },
  berries() {
    for (const [ox, oy] of [[-7, 4], [5, 6], [0, -5], [9, -4], [-9, -6]]) circle(ox, oy, 6.5, '#3b4bd6', '#1b2370', 2);
    circle(-1, -6, 1.8, '#c8d0ff');
    leaf(2, -10, 12, 3.5, -0.6, '#5fae3c');
  },
  apple() {
    circle(0, 2, 14, '#d8322c', '#7a1612', 3);
    circle(-5, -3, 4, '#f0756c');
    rrect(-1, -16, 2.5, 7, 1, '#5a3d1e');
    leaf(1, -12, 11, 3.5, -0.5, '#5fae3c');
  },
  carrot() {
    ctx.rotate(-0.7);
    poly([[-16, -6], [14, -1], [14, 1], [-16, 6]]);
    ctx.fillStyle = '#f08a24'; ctx.fill();
    ctx.strokeStyle = '#9a4f0c'; ctx.lineWidth = 2.5; ctx.stroke();
    for (const a of [-0.5, 0, 0.5]) leaf(-16, 0, 11, 3, Math.PI + a, '#5fae3c');
  },
  potato() {
    ellipse(-3, 3, 13, 10, '#b08850', '#6e5028', 2.5);
    ellipse(8, -6, 8, 6, '#c09860', '#6e5028', 2);
    for (const [x, y] of [[-7, 1], [0, 6], [-2, -2], [9, -7]]) circle(x, y, 1.3, '#6e5028');
  },
  baked_potato() {
    ellipse(0, 2, 16, 11, '#8a6032', '#4a3018', 2.5);
    ellipse(0, 0, 9, 5, '#f4e2a0');
    circle(2, -1, 3, '#fff6c8');
  },
  corn() {
    ctx.rotate(-0.7);
    leaf(-10, 0, 22, 5, 0.25, '#7fb447');
    ellipse(2, 0, 15, 7, '#f2d24a', '#9a7a14', 2.5);
    for (let x = -9; x <= 11; x += 5) for (const y of [-3, 1]) circle(x, y + 1, 1.6, '#d8b22a');
    leaf(-10, 0, 22, 5, -0.25, '#6aa03a');
  },
  roasted_corn() {
    ctx.rotate(-0.7);
    ellipse(2, 0, 15, 7, '#d89a2a', '#6a4a10', 2.5);
    for (let x = -9; x <= 11; x += 5) for (const y of [-3, 1]) circle(x, y + 1, 1.8, x % 2 ? '#6a3a10' : '#b87818');
    rrect(-18, -2, 8, 4, 2, '#8a6236', '#4a3019', 1.5);
  },
  pumpkin() {
    for (const ox of [-6, 6]) ellipse(ox, 3, 9, 12, '#e07a22', '#8a4510', 2);
    ellipse(0, 3, 10, 13, '#ee8a2b', '#8a4510', 2.5);
    rrect(-2, -14, 4, 7, 1.5, '#6a5020');
    leaf(2, -11, 11, 3.5, -0.4, '#5a9a3c');
  },
  whetstone() {
    ctx.rotate(-0.4);
    rrect(-16, -6, 32, 12, 4, '#8b9196', '#4a4f53', 2.5);
    rrect(-14, -5, 28, 4, 2, '#b4bac0');
  },
  essence() {
    poly([[0, -17], [11, -3], [6, 15], [-6, 15], [-11, -3]]);
    ctx.fillStyle = '#5a2a8a'; ctx.fill();
    ctx.strokeStyle = '#2a0f45'; ctx.lineWidth = 2.5; ctx.stroke();
    poly([[0, -12], [6, -2], [0, 8], [-6, -2]]);
    ctx.fillStyle = '#c77dff'; ctx.fill();
    circle(-2, -5, 2, '#f0d8ff');
  },
  ward() {
    poly([[0, -17], [14, -11], [12, 5], [0, 16], [-12, 5], [-14, -11]]);
    ctx.fillStyle = '#d4a93a'; ctx.fill();
    ctx.strokeStyle = '#6e5014'; ctx.lineWidth = 2.5; ctx.stroke();
    poly([[0, -10], [8, -6], [7, 3], [0, 10], [-7, 3], [-8, -6]]);
    ctx.fillStyle = '#7a1f1f'; ctx.fill();
    rrect(-1.5, -6, 3, 12, 1, '#f2d27a');
    rrect(-5, -1.5, 10, 3, 1, '#f2d27a');
  },
  // Feldflasche aus Leder, leer bzw. gefüllt (blaue Welle)
  bottle() { canteen(false); },
  water() { canteen(true); },
  // Konservendose mit Etikett
  can() {
    rrect(-11, -15, 22, 30, 4, '#b8bec4', '#5d6670', 2.5);
    rrect(-11, -7, 22, 15, 1, '#d9534f');
    circle(0, 0, 4, '#f0ad4e');
    ctx.strokeStyle = 'rgba(80,90,100,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-9, -12); ctx.lineTo(9, -12);
    ctx.stroke();
  },
  // Verbandsrolle mit rotem Kreuz
  bandage() {
    ctx.rotate(-0.4);
    rrect(-15, -9, 30, 18, 8, '#f4efe2', '#9c9482', 2.5);
    for (const x of [-7, 0, 7]) rrect(x - 0.75, -9, 1.5, 18, 0.5, 'rgba(160,150,130,0.6)');
    rrect(-2.5, -6, 5, 12, 1, '#d63a3a');
    rrect(-6, -2.5, 12, 5, 1, '#d63a3a');
  },
  // Zwei gestapelte Barren
  iron() {
    for (const [oy, light] of [[6, '#aab3bc'], [-4, '#c9d1d9']]) {
      poly([[-16, oy + 5], [-11, oy - 5], [11, oy - 5], [16, oy + 5]]);
      ctx.fillStyle = light;
      ctx.fill();
      ctx.strokeStyle = '#5d6670';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    rrect(-8, -8, 12, 2.5, 1, 'rgba(255,255,255,0.7)');
  },
};

// Waffe entlang der +x-Achse ab dem Griff (Ursprung). Für Symbole und in der Hand.
// pull: wie weit die Bogensehne gespannt ist (0..1)
export function drawWeapon(def, pull = 0) {
  if (def.kind === 'gun') return drawGun(def.model);
  const [c, d] = def.color || [LEVEL_COLORS[def.tier], LEVEL_DARK[def.tier]];
  const blade = (points) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = c; ctx.fill();
    ctx.strokeStyle = d; ctx.lineWidth = 2; ctx.stroke();
  };
  switch (def.kind) {
    case 'sword':
      rrect(-6, -3, 16, 6, 2, '#6b4524', '#3a2412', 2);
      rrect(9, -9, 5, 18, 2, d);
      blade([[14, -4.5], [54, -4.5], [62, 0], [54, 4.5], [14, 4.5]]);
      break;
    case 'dagger':
      rrect(-4, -2.5, 12, 5, 2, '#6b4524', '#3a2412', 2);
      rrect(7, -6, 4, 12, 2, d);
      blade([[11, -3.5], [28, -3], [34, 0], [28, 3], [11, 3.5]]);
      break;
    case 'spear':
      rrect(-30, -2.5, 92, 5, 2, '#8a6236', '#4a3019', 2);
      blade([[60, -7], [80, 0], [60, 7]]);
      break;
    case 'bow': {
      // Bogen quer zur Blickrichtung, Sehne wird beim Spannen zurückgezogen
      const back = -6 - pull * 14;
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.quadraticCurveTo(22, 0, 0, 30);
      ctx.strokeStyle = d; ctx.lineWidth = 7; ctx.stroke();
      ctx.strokeStyle = c; ctx.lineWidth = 4; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -30); ctx.lineTo(back, 0); ctx.lineTo(0, 30);
      ctx.strokeStyle = 'rgba(240,240,230,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
      break;
    }
    case 'pick': // Stiel mit gebogenem Doppelkopf
      rrect(0, -3.5, 50, 7, 3, '#7a5230', '#4a3019', 2);
      ctx.beginPath();
      ctx.moveTo(40, -24);
      ctx.quadraticCurveTo(52, -6, 54, 0);
      ctx.quadraticCurveTo(52, 6, 40, 24);
      ctx.quadraticCurveTo(47, 0, 40, -24);
      ctx.closePath();
      ctx.fillStyle = c; ctx.fill();
      ctx.strokeStyle = d; ctx.lineWidth = 2.5; ctx.stroke();
      rrect(42, -5, 10, 10, 2, d);
      break;
    default: // Axt
      rrect(0, -3.5, 46, 7, 3, '#7a5230', '#4a3019', 2);
      rrect(34, -16, 14, 22, 3, c, d, 3);
  }
}

// Feuerwaffen von oben, Lauf zeigt in +x, Griff bei 0
export function drawGun(model) {
  const metal = '#3c4046', dark = '#1e2125', wood = '#7a4f2a';
  if (model === 'pistol') {
    rrect(-4, -4, 12, 8, 2, dark);
    rrect(4, -3.5, 26, 7, 2, metal, dark, 2);
    rrect(26, -2, 6, 4, 1, dark);
  } else if (model === 'shotgun') {
    rrect(-22, -5, 26, 10, 4, wood, '#4a2f17', 2);
    rrect(2, -5, 18, 10, 2, metal, dark, 2);
    rrect(18, -4.5, 46, 4, 1.5, '#55595f', dark, 1.5);
    rrect(18, 0.5, 46, 4, 1.5, '#55595f', dark, 1.5);
    rrect(26, 4, 16, 4, 1.5, wood);
  } else {
    rrect(-26, -4.5, 28, 9, 3, wood, '#4a2f17', 2);
    rrect(0, -4, 30, 8, 2, metal, dark, 2);
    rrect(28, -2, 46, 4, 1.5, '#55595f', dark, 1.5);
    rrect(8, -8, 16, 4, 1.5, dark); // Zielfernrohr
  }
}

// Symbol für ein Ausrüstungsteil (Mitte 0/0, Größe 40)
function drawEquipShape(def) {
  if (def.slot === 'weapon') {
    ctx.save();
    if (def.kind === 'bow') ctx.translate(-6, 0);
    else {
      // Lange Waffen schräg und verkleinert, damit sie in den Slot passen
      ctx.rotate(-0.75);
      const len = def.kind === 'gun' ? { pistol: 36, shotgun: 86, rifle: 100 }[def.model] : { sword: 62, dagger: 34, spear: 110, pick: 54 }[def.kind] || 48;
      const k = Math.min(1, 46 / len);
      ctx.scale(k, k);
      ctx.translate(def.kind === 'gun' && def.model !== 'pistol' ? -len / 2 + 22 : -len / 2, 0);
    }
    drawWeapon(def);
    ctx.restore();
    return;
  }
  const [c, d] = ARMOR_COLORS[def.tier] || ARMOR_COLORS[0];
  ctx.fillStyle = c;
  ctx.strokeStyle = d;
  ctx.lineWidth = 3;
  const fillAndStroke = () => { ctx.fill(); ctx.stroke(); };
  if (def.slot === 'head') {
    ctx.beginPath();
    ctx.arc(0, 4, 14, Math.PI, 0);
    ctx.closePath();
    fillAndStroke();
    rrect(-18, 2, 36, 7, 3, c, d, 3);
    if (def.tier === 1) rrect(-2.5, -10, 5, 12, 2, d);
  } else if (def.slot === 'chest') {
    poly([[-8, -15], [8, -15], [18, -8], [14, 0], [9, -3], [9, 15], [-9, 15], [-9, -3], [-14, 0], [-18, -8]]);
    fillAndStroke();
    ctx.beginPath();
    ctx.arc(0, -15, 4.5, 0, Math.PI);
    ctx.stroke();
  } else if (def.slot === 'legs') {
    poly([[-11, -15], [11, -15], [12, 15], [3, 15], [0, -3], [-3, 15], [-12, 15]]);
    fillAndStroke();
    rrect(-11, -15, 22, 5, 2, d);
  } else if (def.slot === 'feet') {
    for (const ox of [-8, 8]) {
      poly([[ox - 5, -13], [ox + 3, -13], [ox + 3, 6], [ox + 9, 9], [ox + 9, 14], [ox - 5, 14]]);
      fillAndStroke();
    }
  }
}
