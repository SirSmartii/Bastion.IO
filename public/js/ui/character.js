// Charakterfenster [C]: Ausrüstungs-Slots (Mütze, Shirt, Hose, Schuhe, Waffe), alle Werte und die
// Fähigkeiten durch Übung (Laufen, Holzfällen …).

import { ctx, cfg, me, ui, mouse, W, H } from '../state.js';
import { rrect, text, inRect } from '../draw/primitives.js';
import { drawItemIcon, itemName, gearBadge } from '../draw/items.js';
import { itemTooltip, tooltipLines } from './tooltip.js';
import { dragStack } from './inventory.js';

const PRACTICE_ROW = 52, practiceHeight = () => Math.ceil(cfg.PRACTICE.list.length / 2) * PRACTICE_ROW + 44;

export function charLayout() {
  const w = 470, h = 410 + practiceHeight(), size = 60;
  const x = Math.round(ui.inv ? W / 2 + 8 : W / 2 - w / 2); // mit Inventar: rechts daneben
  const y = Math.round(Math.max(80, H / 2 - h / 2 - 40));
  const cx = x + 125; // Mittelachse der "Figur"
  const slots = {
    head: { x: cx - 30, y: y + 56, w: size, h: size },
    chest: { x: cx - 30, y: y + 126, w: size, h: size },
    legs: { x: cx - 30, y: y + 196, w: size, h: size },
    feet: { x: cx - 30, y: y + 266, w: size, h: size },
    weapon: { x: x + 20, y: y + 126, w: size, h: size },
  };
  return { panel: { x, y, w, h }, slots };
}

// Ausrüstungs-Slot unter dem Punkt ('head', 'weapon' …) oder null
export function eqSlotAt(sx, sy) {
  if (!ui.char || !cfg) return null;
  const { slots } = charLayout();
  return Object.keys(slots).find((k) => inRect(sx, sy, slots[k])) || null;
}

export function drawCharacter() {
  const { panel: P, slots } = charLayout();
  rrect(P.x, P.y, P.w, P.h, 14, 'rgba(18,24,14,0.95)', '#4b5d38', 3);
  text('🧍 Charakter', P.x + 18, P.y + 29, { size: 18, bold: true, color: '#f2d27a' });
  text(`Level ${me.lvl} · ${me.xp}/${me.xpNext} EP${me.sp ? ` · ${me.sp} Skillpunkt(e) [K]` : ''}`, P.x + 160, P.y + 29, { size: 12, color: me.sp ? '#ffd76a' : '#a8b597' });
  text('[C] schließen', P.x + P.w - 18, P.y + 29, { size: 12, color: '#a8b597', align: 'right' });

  // Silhouette hinter den Slots
  const cx = P.x + 125;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx, P.y + 86); ctx.lineTo(cx, P.y + 296);
  ctx.moveTo(slots.weapon.x + 60, P.y + 156); ctx.lineTo(cx + 80, P.y + 156);
  ctx.stroke();

  drawEquipSlots(slots);
  drawStats(P.x + 230, P.y + 68);
  drawPractice(P.x + 18, P.y + 392, P.w - 36);
  text('Ziehen oder Rechtsklick: an-/ablegen · rausziehen = droppen', P.x + P.w / 2, P.y + P.h - 14, { size: 12, color: '#8f9c80', align: 'center' });

  const hoverEq = eqSlotAt(mouse.x, mouse.y);
  if (!ui.drag && hoverEq && me.eq[hoverEq]) itemTooltip(me.eq[hoverEq], [['Rechtsklick: ablegen', '#a8b597']], me.eqd && me.eqd[hoverEq]);
}

function drawEquipSlots(slots) {
  const hoverEq = eqSlotAt(mouse.x, mouse.y);
  // Beim Ziehen eines Ausrüstungsteils den passenden Slot grün markieren
  const dragged = dragStack();
  const draggedDef = dragged && cfg.EQUIPMENT[dragged[0]];
  for (const slot of cfg.EQUIP_SLOTS) {
    const r = slots[slot.id], item = me.eq[slot.id];
    const fits = draggedDef && draggedDef.slot === slot.id;
    rrect(r.x, r.y, r.w, r.h, 8, hoverEq === slot.id ? 'rgba(255,230,140,0.16)' : 'rgba(0,0,0,0.4)',
      fits ? '#9fe870' : 'rgba(255,255,255,0.14)', fits ? 3 : 2);
    if (item) {
      ctx.globalAlpha = ui.drag && ui.drag.eq === slot.id ? 0.3 : 1;
      drawItemIcon(item, r.x + r.w / 2, r.y + r.h / 2, 40);
      gearBadge(r, me.eqd && me.eqd[slot.id]);
      ctx.globalAlpha = 1;
    } else {
      text(slot.name, r.x + r.w / 2, r.y + r.h / 2 + 5, { size: 12, color: 'rgba(255,255,255,0.3)', align: 'center' });
    }
  }
  text('Waffe', slots.weapon.x + 30, slots.weapon.y + 76, { size: 11, color: '#8f9c80', align: 'center' });
}

// Was eine Fähigkeit auf ihrer Stufe insgesamt bringt, z. B. "+6 % Tempo · −18 % Sprint-Ausdauer"
const PRACTICE_EFFECTS = {
  speedPct: (v) => `+${v} % Tempo`,
  sprintCost: (v) => `−${-v} % Sprint-Ausdauer`,
  extraWood: (v) => `${v} % Chance auf +1 Holz`,
  extraOre: (v) => `${v} % Chance auf +1 Gestein`,
  rangedDmg: (v) => `+${v} % Schaden`,
  rangedRate: (v) => `+${v} % Feuerrate`,
  meleeDmg: (v) => `+${v} % Schaden`,
  meleeRate: (v) => `+${v} % Schlagtempo`,
  lootTwice: (v) => `${v} % doppelte Beute`,
  smithSuccess: (v) => `+${v} % Erfolg`,
  smithDrop: (v) => `−${-v} % Stufenverlust`,
  smithBreak: (v) => `−${-v} % Zerstören`,
  smithLuck: (v) => `+${v} % Seltenheit`,
};

function practiceEffect(def, level) {
  if (!level) return 'Noch ungeübt';
  return Object.entries(def.per).map(([key, per]) => PRACTICE_EFFECTS[key](Math.round(per * level * 100))).join(' · ');
}

// Fähigkeiten durch Übung: zwei Spalten mit Stufe, Fortschritt und aktuellem Bonus
function drawPractice(x, y, w) {
  text('Fähigkeiten durch Übung', x, y, { size: 15, bold: true, color: '#e9eedd' });
  text('steigen beim Tun · bleiben nach dem Tod', x + w, y, { size: 11, color: '#8f9c80', align: 'right' });
  const info = new Map((me.prac || []).map(([id, level, xp, need]) => [id, { level, xp, need }]));
  const colW = (w - 12) / 2;
  let hoverDef = null;
  cfg.PRACTICE.list.forEach((def, i) => {
    const { level = 0, xp = 0, need = 0 } = info.get(def.id) || {};
    const rx = x + (i % 2) * (colW + 12), ry = y + 14 + Math.floor(i / 2) * PRACTICE_ROW;
    const box = { x: rx, y: ry, w: colW, h: PRACTICE_ROW - 6 };
    const hover = inRect(mouse.x, mouse.y, box);
    if (hover) hoverDef = def;
    rrect(box.x, box.y, box.w, box.h, 8, hover ? 'rgba(255,230,140,0.1)' : 'rgba(0,0,0,0.3)', 'rgba(255,255,255,0.08)', 1);
    text(`${def.icon} ${def.name}`, rx + 8, ry + 17, { size: 13, bold: true, color: '#e9eedd' });
    const maxed = level >= cfg.PRACTICE.max;
    text(maxed ? `Stufe ${level} (max)` : `Stufe ${level}`, rx + colW - 8, ry + 17, { size: 12, bold: true, color: level ? '#ffd76a' : '#8f9c80', align: 'right' });
    // Fortschritt zur nächsten Stufe
    const barW = colW - 16, frac = maxed ? 1 : need ? Math.min(1, xp / need) : 0;
    rrect(rx + 8, ry + 23, barW, 5, 2.5, 'rgba(255,255,255,0.1)');
    if (frac > 0) rrect(rx + 8, ry + 23, Math.max(4, barW * frac), 5, 2.5, maxed ? '#ffd76a' : '#7ed957');
    text(practiceEffect(def, level), rx + 8, ry + 41, { size: 11, color: level ? '#cfd8c0' : '#7c8770' });
  });
  if (hoverDef) {
    const { level = 0, xp = 0, need = 0 } = info.get(hoverDef.id) || {};
    ui.pendingTooltip = () => tooltipLines([
      [`${hoverDef.icon} ${hoverDef.name} · Stufe ${level}/${cfg.PRACTICE.max}`, '#ffe08a', true],
      [hoverDef.desc, '#cfd8c0'],
      [level >= cfg.PRACTICE.max ? 'Höchste Stufe erreicht' : `${xp} / ${need} Übung bis Stufe ${level + 1}`, '#a8b597'],
    ]);
  }
}

// Werte-Tabelle; grün = besser als der Grundwert, rot = schlechter
function drawStats(x, y) {
  const st = me.stats, base = cfg.PLAYER;
  text('Werte', x, y, { size: 15, bold: true, color: '#e9eedd' });
  const weapon = me.eq.weapon ? itemName(me.eq.weapon) : 'Faust';
  const rows = [
    ['❤', 'Leben', st.maxHp, st.maxHp - base.hp],
    ['🛡', 'Rüstung', `${st.armor}  (−${Math.round(st.reduction * 100)}% Schaden)`, st.armor],
    ['⚔', 'Schaden', `${st.damage}  (${weapon})`, 0],
    ['⛏', 'Abbau', `×${st.gather}`, 0],
    ['👟', 'Tempo', st.speed, st.speed - base.speed],
    ['⏱', 'Angriffe/s', st.attackSpeed, 0],
    ['✚', 'Regeneration', `${st.regen}/s`, +(st.regen - base.regen).toFixed(1)],
    st.ranged ? ['🏹', 'Schussweite', `${st.range}  (${me.res[me.ammo] || 0}× ${itemName(me.ammo)})`, 0] : ['↔', 'Reichweite', st.reach, st.reach - base.reach],
    ['⚡', 'Ausdauer', st.stamina, st.stamina - base.stamina],
  ];
  rows.forEach(([icon, label, value, bonus], i) => {
    const ry = y + 30 + i * 30;
    rrect(x - 6, ry - 19, 222, 26, 6, i % 2 ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.32)');
    text(`${icon}  ${label}`, x + 2, ry, { size: 13, color: '#cfd8c0' });
    text(String(value), x + 208, ry, { size: 13, bold: true, align: 'right', color: bonus > 0 ? '#9fe870' : bonus < 0 ? '#ff8a7a' : '#fff' });
  });
}
