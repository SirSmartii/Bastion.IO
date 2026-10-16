// Item-Symbole (Inventar, Boden, Hotbar) und Waffen (auch in der Hand der Spielfiguren).

import { ctx, cfg } from '../state.js';
import { LEVEL_COLORS, LEVEL_DARK, ARROW_TIPS } from '../constants.js';
import { circle, rrect } from './primitives.js';
import { art } from '../assets.js';

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

// Item-Symbol, zentriert auf (x, y) mit Größe s (Grafiken unter assets/items und assets/gear)
export function drawItemIcon(item, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 40, s / 40);
  if (cfg.EQUIPMENT[item]) drawEquipShape(cfg.EQUIPMENT[item]);
  else if (item.startsWith('arrow')) {
    const [tip, tipDark] = ARROW_TIPS[cfg.AMMO.arrow.types.find((t) => t.item === item).look];
    art('items/ammo/arrows', { T: tip, U: tipDark });
  } else art(ITEM_ART[item] || `items/materials/${item}`);
  ctx.restore();
}

// Ordner der stapelbaren Items
const ITEM_ART = {};
for (const [folder, items] of Object.entries({
  materials: ['wood', 'stone', 'gold', 'iron_ore', 'coal', 'iron', 'bone', 'scrap', 'fur', 'whetstone', 'essence', 'ward'],
  food: ['meat', 'cooked_meat', 'berries', 'apple', 'carrot', 'potato', 'baked_potato', 'corn', 'roasted_corn', 'pumpkin', 'can'],
  supplies: ['bottle', 'water', 'bandage'],
  ammo: ['bullet', 'shell'],
})) for (const item of items) ITEM_ART[item] = `items/${folder}/${item}`;

// Material-Farben einer Waffe als Platzhalter für die Grafik ($C hell, $D dunkel)
const weaponColors = (def) => {
  const [C, D] = def.color || [LEVEL_COLORS[def.tier], LEVEL_DARK[def.tier]];
  return { C, D };
};

// Waffe entlang der +x-Achse ab dem Griff (Ursprung). Für Symbole und in der Hand.
// pull: wie weit die Bogensehne gespannt ist (0..1)
export function drawWeapon(def, pull = 0) {
  if (def.kind === 'gun') return drawGun(def.model);
  art(`gear/weapons/${def.kind}`, weaponColors(def)); // axe, pick, sword, dagger, spear, bow
  if (def.kind === 'bow') {
    // Sehne wird beim Spannen zurückgezogen
    ctx.beginPath();
    ctx.moveTo(0, -30); ctx.lineTo(-6 - pull * 14, 0); ctx.lineTo(0, 30);
    ctx.strokeStyle = 'rgba(240,240,230,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// Feuerwaffen von oben, Lauf zeigt in +x, Griff bei 0
export function drawGun(model) {
  art(`gear/weapons/${model}`);
}

// Symbol für ein Ausrüstungsteil (Mitte 0/0, Größe 40)
function drawEquipShape(def) {
  if (def.slot !== 'weapon') return art(`gear/armor/${def.tier ? 'iron' : 'fur'}/${def.slot}`);
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
}
