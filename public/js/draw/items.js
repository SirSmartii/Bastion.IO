// Item-Symbole (Inventar, Boden, Hotbar) und Waffen (auch in der Hand der Spielfiguren).

import { ctx, cfg } from '../state.js';
import { LEVEL_COLORS, LEVEL_DARK, ARROW_TIPS } from '../constants.js';
import { circle, rrect } from './primitives.js';
import { art } from '../assets.js';
import { t, dec } from '../i18n.js';

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
  return `${v > 0 ? '+' : '−'}${dec(Math.abs(v))}${mod.pct ? ' %' : ''} ${mod.name}`;
}

// Tooltip-Zeilen: Seltenheit, Boni (grün), Fluch (rot)
export function gearLines(d) {
  const R = rarityOf(d), lines = [[`${R.name}${d && d.c ? t(' · verflucht') : ''}`, R.color, true]];
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
  if (def.kind === 'backpack') return t('+{n} Inventarplätze', { n: def.slots });
  if (def.slot !== 'weapon') return Object.entries(st).map(([k, v]) => `${v > 0 ? '+' : ''}${dec(v)} ${t(STAT_LABELS[k] || k)}`).join(' · ');
  const pellets = def.projectile && def.projectile.pellets;
  const parts = [t('{n} Schaden', { n: pellets ? `${pellets}×${dec(st.damage)}` : dec(st.damage) }), `${dec(st.attackSpeed || +(1 / cfg.PLAYER.attackCooldown).toFixed(1))}/s`];
  parts.push(st.range ? t('Weite {n}', { n: st.range }) : t('Reichw. {n}', { n: st.reach || cfg.PLAYER.reach }));
  if (def.ammo) parts.push(cfg.AMMO[def.ammo].label);
  else if (def.kind === 'torch') return t('{n} Schaden · leuchtet weit & verscheucht Tiere · brennt {min} min', { n: st.damage, min: Math.round(def.burn / 60) });
  else if (def.kind === 'rod') return t('Am Seeufer [F]: angeln');
  else if (st.mine) parts.push(t('×{n} Gestein', { n: st.mine }), t('×{n} Holz', { n: st.gather }));
  else parts.push(st.gather ? t('×{n} Abbau', { n: st.gather }) : t('kein Abbau'));
  if (st.tool !== undefined) parts.push(t('Erz: {ores}', { ores: oreReach(st.tool) }));
  return parts.join(' · ');
}

// Welche Erze ein Werkzeug der Material-Stufe tier abbauen kann (RESOURCES[*].tool)
function oreReach(tier) {
  const ores = Object.values(cfg.RESOURCES).filter((r) => r.tool && r.tool <= tier).map((r) => r.tool);
  if (!ores.length) return t('keins');
  const top = Math.max(...ores);
  return t(top >= 5 ? 'alles inkl. Edelsteine' : top >= 3 ? 'Kupfer, Zinn, Eisen' : 'Kupfer, Zinn');
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
  materials: ['wood', 'stone', 'gold', 'iron_ore', 'coal', 'iron', 'bone', 'scrap', 'fur', 'whetstone', 'essence', 'ward',
    'copper_ore', 'tin_ore', 'copper', 'tin', 'bronze', 'steel', 'diamond', 'ruby', 'leather'],
  food: ['meat', 'cooked_meat', 'berries', 'apple', 'carrot', 'potato', 'baked_potato', 'corn', 'roasted_corn', 'pumpkin', 'can',
    'fish', 'cooked_fish', 'stew', 'berry_juice', 'fish_soup'],
  supplies: ['bottle', 'water', 'bandage'],
  ammo: ['bullet', 'shell'],
})) for (const item of items) ITEM_ART[item] = `items/${folder}/${item}`;

// Material-Farben eines Teils als Platzhalter für die Grafik ($C hell, $D dunkel, $L Glanz)
export function gearColors(def) {
  const [C, D] = def.color || [LEVEL_COLORS[def.tier || 0], LEVEL_DARK[def.tier || 0]];
  return { C, D, L: mixColor(C, '#ffffff', 0.45) };
}

function mixColor(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (shift) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

// Waffe entlang der +x-Achse ab dem Griff (Ursprung). Für Symbole und in der Hand.
// pull: wie weit die Bogensehne gespannt ist (0..1)
export function drawWeapon(def, pull = 0) {
  if (def.kind === 'gun') return drawGun(def.model);
  art(`gear/weapons/${def.kind}`, gearColors(def)); // axe, pick, sword, dagger, spear, bow, torch, rod
  if (def.kind === 'torch') {
    // flackernde Flamme am Kopf der Fackel
    const s = performance.now() / 1000, f = 1 + Math.sin(s * 13) * 0.12 + Math.sin(s * 29) * 0.08;
    circle(42, 0, 9 * f, 'rgba(255,120,30,0.55)');
    circle(41, 0, 6 * f, 'rgba(255,190,60,0.9)');
    circle(40, 0, 3 * f, '#fff3b0');
  }
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
  if (def.kind === 'backpack') return art('gear/back/backpack', gearColors(def));
  if (def.slot !== 'weapon') return art(`gear/armor/${def.style}/${def.slot}`, gearColors(def));
  ctx.save();
  if (def.kind === 'bow') ctx.translate(-6, 0);
  else {
    // Lange Waffen schräg und verkleinert, damit sie in den Slot passen
    ctx.rotate(-0.75);
    const len = def.kind === 'gun' ? { pistol: 36, shotgun: 86, rifle: 100 }[def.model] : { sword: 62, dagger: 34, spear: 110, pick: 54, torch: 48, rod: 72 }[def.kind] || 48;
    const k = Math.min(1, 46 / len);
    ctx.scale(k, k);
    ctx.translate(def.kind === 'gun' && def.model !== 'pistol' ? -len / 2 + 22 : -len / 2, 0);
  }
  drawWeapon(def);
  ctx.restore();
}
