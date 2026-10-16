// Inventar-Fenster und daneben der offene Behälter: Truhe, Schmelzofen (mit Fortschritt) oder Kern-Lager (mit Unterhalt).

import { ctx, cfg, me, myId, structs, ui, mouse, W, H } from '../state.js';
import { rrect, text, inRect, fmtClock } from '../draw/primitives.js';
import { drawItemIcon, stackMax, gearBadge } from '../draw/items.js';
import { fmtCost } from './format.js';
import { RES_ICON } from '../constants.js';
import { itemTooltip } from './tooltip.js';
import { charLayout } from './character.js';

const SLOT = 60, GAP = 8, PAD = 18, COLS = 5;

// Raster aus n Slots ab (x, y + head)
function slotGrid(n, x, y, head) {
  const slots = [];
  for (let i = 0; i < n; i++) {
    slots.push({ x: x + PAD + (i % COLS) * (SLOT + GAP), y: y + head + Math.floor(i / COLS) * (SLOT + GAP), w: SLOT, h: SLOT });
  }
  return slots;
}

const gridHeight = (n, head) => head + PAD + Math.ceil(n / COLS) * (SLOT + GAP) - GAP + 34;
const GRID_WIDTH = PAD * 2 + COLS * SLOT + (COLS - 1) * GAP;

// ---------- Layout ----------

export function invLayout() {
  const n = cfg.INVENTORY.slots, head = 40, h = gridHeight(n, head);
  const sideBySide = ui.char || (me && me.ch); // Charakter oder Truhe rechts daneben
  const x = Math.round(sideBySide ? W / 2 - GRID_WIDTH - 8 : W / 2 - GRID_WIDTH / 2);
  const y = Math.round(Math.max(80, H / 2 - h / 2 - 40));
  return { panel: { x, y, w: GRID_WIDTH, h }, slots: slotGrid(n, x, y, head) };
}

// Behälterfenster rechts neben dem Inventar; Kern-Lager und Ofen haben oben zusätzlich eine Infozeile
export function chestLayout() {
  const n = me.ch[1].length, head = 40 + (me.ch[2] ? 78 : me.ch[3] ? 58 : 0), h = gridHeight(n, head);
  const x = Math.round(W / 2 + 8), y = invLayout().panel.y;
  return { panel: { x, y, w: GRID_WIDTH, h }, slots: slotGrid(n, x, y, head) };
}

export function invSlotAt(sx, sy) {
  if (!ui.inv || !cfg || !me) return -1;
  return invLayout().slots.findIndex((r) => inRect(sx, sy, r));
}

export function chestSlotAt(sx, sy) {
  if (!ui.inv || !me || !me.ch) return -1;
  return chestLayout().slots.findIndex((r) => inRect(sx, sy, r));
}

// Liegt der Punkt über Inventar, Charakter oder Truhe?
export function overItemWindows(sx, sy) {
  return (ui.inv && inRect(sx, sy, invLayout().panel)) || (ui.char && inRect(sx, sy, charLayout().panel)) ||
    (ui.inv && !!me.ch && inRect(sx, sy, chestLayout().panel));
}

// Gezogener Stapel [item, n] (aus Inventar oder Truhe)
export function dragStack(d = ui.drag) {
  if (!d || d.slot === undefined) return null;
  const box = d.c ? me.ch && me.ch[1] : me.inv;
  return (box && box[d.slot]) || null;
}

// ---------- Zeichnen ----------

// Slot-Raster (Inventar: container 0, Truhe: 1) mit Hover und halb durchsichtigem Drag-Ursprung
function drawSlots(slots, box, container, hoverSlot) {
  slots.forEach((r, i) => {
    const s = box[i];
    const isHover = hoverSlot === i;
    rrect(r.x, r.y, r.w, r.h, 8, isHover ? 'rgba(255,230,140,0.16)' : 'rgba(0,0,0,0.35)',
      isHover && ui.drag ? '#ffd76a' : 'rgba(255,255,255,0.1)', 2);
    if (!s) return;
    const [item, n] = s;
    ctx.globalAlpha = ui.drag && ui.drag.slot === i && (ui.drag.c || 0) === container ? 0.3 : 1;
    drawItemIcon(item, r.x + r.w / 2, r.y + r.h / 2 - 3, 38);
    gearBadge(r, s[2]);
    if (!cfg.EQUIPMENT[item]) {
      ctx.font = 'bold 14px Segoe UI, sans-serif';
      ctx.textAlign = 'right';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(String(n), r.x + r.w - 5, r.y + r.h - 6);
      ctx.fillStyle = n >= stackMax(item) ? '#ffd76a' : '#fff'; // voller Stapel gelb
      ctx.fillText(String(n), r.x + r.w - 5, r.y + r.h - 6);
    }
    ctx.globalAlpha = 1;
  });
}

export function drawInventory() {
  const { panel: P, slots } = invLayout();
  rrect(P.x, P.y, P.w, P.h, 14, 'rgba(18,24,14,0.94)', '#4b5d38', 3);
  text('Inventar', P.x + 18, P.y + 27, { size: 18, bold: true, color: '#f2d27a' });
  text(`${me.inv.filter(Boolean).length}/${slots.length} Slots · [Tab] schließen`, P.x + P.w - 18, P.y + 27, { size: 13, color: '#a8b597', align: 'right' });
  const hoverSlot = invSlotAt(mouse.x, mouse.y);
  drawSlots(slots, me.inv, 0, hoverSlot);

  const chestType = me.ch && structs.get(me.ch[0]) ? structs.get(me.ch[0]).type : null;
  const target = me.ch ? (me.ch[2] ? 'ins Kern-Lager' : chestType === 'campfire' ? 'ins Lagerfeuer' : me.ch[3] ? 'in den Ofen' : 'in die Truhe') : null;
  const hint = target ? `Rechtsklick: Stapel ${target}` : 'Ziehen: sortieren / droppen · Shift: Hälfte · Rechtsklick: nutzen';
  text(hint, P.x + P.w / 2, P.y + P.h - 14, { size: 12, color: '#8f9c80', align: 'center' });

  if (ui.drag || hoverSlot < 0 || !me.inv[hoverSlot]) return;
  const [item, n, d] = me.inv[hoverSlot];
  if (target) itemTooltip(item, [[`× ${n} · Rechtsklick: ${target}`, '#cfd8c0']], d);
  else if (cfg.EQUIPMENT[item]) itemTooltip(item, [['Rechtsklick: ausrüsten', '#a8b597']], d);
  else if (cfg.ITEMS.food[item]) itemTooltip(item, [[`× ${n} · Rechtsklick: verbrauchen`, '#cfd8c0'], [foodText(item), '#9fe870']]);
  else itemTooltip(item, [[`× ${n}  (max ${stackMax(item)})`, '#cfd8c0']]);
}

export function drawChest() {
  const { panel: P, slots } = chestLayout();
  const box = me.ch[1], upkeep = me.ch[2], furnace = me.ch[3], s = structs.get(me.ch[0]);
  rrect(P.x, P.y, P.w, P.h, 14, 'rgba(30,22,12,0.95)', '#7a5a32', 3);
  // Bei Team-Truhen den Besitzer nennen
  const owner = s && s.owner !== myId && me.team ? me.team.m.find((m) => m[0] === s.owner) : null;
  const campfire = s && s.type === 'campfire';
  const title = upkeep ? '🏰 Kern-Lager' : campfire ? '🔥 Lagerfeuer' : furnace ? '🔥 Schmelzofen' : '📦 Truhe';
  text(owner ? `${title} von ${owner[1]}` : title, P.x + 18, P.y + 27, { size: 18, bold: true, color: '#f2d27a' });
  text(`${box.filter(Boolean).length}/${box.length} · [F] schließen`, P.x + P.w - 18, P.y + 27, { size: 13, color: '#c2ab88', align: 'right' });
  if (upkeep) drawUpkeepInfo(upkeep, P.x + 18, P.y + 52, P.w - 36);
  if (furnace && campfire) drawCampfireInfo(furnace, P.x + 18, P.y + 52, P.w - 36);
  else if (furnace) drawFurnaceInfo(furnace, P.x + 18, P.y + 52, P.w - 36);
  const hoverSlot = chestSlotAt(mouse.x, mouse.y);
  drawSlots(slots, box, 1, hoverSlot);
  text('Ziehen: einlagern / entnehmen · Rechtsklick: ganzer Stapel', P.x + P.w / 2, P.y + P.h - 14, { size: 12, color: '#a8957a', align: 'center' });
  if (!ui.drag && hoverSlot >= 0 && box[hoverSlot]) {
    const [item, n, d] = box[hoverSlot];
    itemTooltip(item, [[cfg.EQUIPMENT[item] ? 'Rechtsklick: ins Inventar' : `× ${n} · Rechtsklick: ins Inventar`, '#cfd8c0']], d);
  }
}

// Unterhalt { c: Kosten, t: Sekunden bis zur Zahlung, n: gedeckte Zahlungen, d: verfällt }
function drawUpkeepInfo(up, x, y, w) {
  rrect(x - 6, y - 16, w + 12, 66, 8, up.d ? 'rgba(140,30,20,0.45)' : 'rgba(0,0,0,0.3)', up.d ? '#e05555' : 'rgba(255,255,255,0.08)', 1.5);
  text(`Unterhalt alle ${cfg.UPKEEP.interval / 60} min: ${fmtCost(up.c) || '–'}`, x, y, { size: 13, bold: true, color: '#f2e2c4' });
  text(`Nächste Zahlung in ${fmtClock(up.t)} · repariert ${Math.round(cfg.UPKEEP.repair * 100)} % HP`, x, y + 20, { size: 12, color: '#c2ab88' });
  if (up.d) text('⚠ Vorrat leer – die Basis verfällt! Holz/Stein/Gold einlagern.', x, y + 40, { size: 12, bold: true, color: '#ff8a7a' });
  else text(`Vorrat reicht für ${up.n >= 999 ? '∞' : up.n} Zahlung(en) · ${supplyText(up)}`, x, y + 40, { size: 12, color: up.n < 2 ? '#ffb36a' : '#9fe870' });
}

// Ofen { a: brennt, p: Fortschritt, t: Sekunden pro Barren, n: Barren aus dem vorhandenen Material }
function drawFurnaceInfo(f, x, y, w) {
  const { cost, out } = cfg.STRUCTURES.furnace.smelt;
  rrect(x - 6, y - 16, w + 12, 48, 8, 'rgba(0,0,0,0.3)', f.a ? '#e8913a' : 'rgba(255,255,255,0.08)', 1.5);
  text(`${fmtCost(cost)} → 1${RES_ICON[out]} alle ${String(f.t).replace('.', ',')} s`, x, y, { size: 13, bold: true, color: '#f2e2c4' });
  if (f.a) {
    rrect(x, y + 10, w * 0.55, 10, 4, 'rgba(0,0,0,0.5)');
    rrect(x, y + 10, Math.max(4, w * 0.55 * f.p), 10, 4, '#ff9a3a');
    text(`brennt · noch ${f.n} Barren`, x + w, y + 19, { size: 12, color: '#ffc27a', align: 'right' });
  } else {
    text(f.n > 0 ? 'Kein Platz für Barren – entnimm welche.' : 'Aus – lege Eisenerz und Kohle hinein.', x, y + 20, { size: 12, color: '#c2ab88' });
  }
}

// Lagerfeuer { a: brennt, p: Fortschritt, t: Sekunden pro Stück, n: rohe Stücke, f: Sekunden Brennstoff }
function drawCampfireInfo(f, x, y, w) {
  const def = cfg.STRUCTURES.campfire;
  rrect(x - 6, y - 16, w + 12, 48, 8, 'rgba(0,0,0,0.3)', f.a ? '#e8913a' : 'rgba(255,255,255,0.08)', 1.5);
  const cooks = Object.entries(def.cook).map(([raw, done]) => `${RES_ICON[raw]}→${RES_ICON[done]}`).join(' ');
  text(`${cooks}  ·  alle ${f.t} s`, x, y, { size: 13, bold: true, color: "#f2e2c4" });
  if (!f.a) {
    text('Aus – lege Holz hinein. Brennend verscheucht es Tiere.', x, y + 20, { size: 12, color: '#c2ab88' });
    return;
  }
  if (f.n) {
    rrect(x, y + 10, w * 0.5, 10, 4, 'rgba(0,0,0,0.5)');
    rrect(x, y + 10, Math.max(4, w * 0.5 * f.p), 10, 4, '#ff9a3a');
  }
  text(`${f.n ? `brät · noch ${f.n}` : 'brennt'} · Holz für ${fmtClock(f.f)}`, x + w, y + 19, { size: 12, color: '#ffc27a', align: 'right' });
}

// Was ein Lebensmittel bringt, z. B. "+35 🍖 Hunger · +10 ❤ Leben"
export function foodText(item) {
  const def = cfg.ITEMS.food[item] || {}, parts = [];
  if (def.food) parts.push(`+${def.food} 🍖 Hunger`);
  if (def.water) parts.push(`+${def.water} 💧 Durst`);
  if (def.hp) parts.push(`${def.hp > 0 ? '+' : ''}${def.hp} ❤ Leben`);
  const cooked = cfg.STRUCTURES.campfire.cook[item];
  if (cooked) parts.push(`am Lagerfeuer → ${cfg.ITEMS.names[cooked]}`);
  return parts.join(' · ');
}

// Wie lange die Basis noch versorgt ist (bis zur ersten Zahlung, die nicht mehr klappt)
export function supplyText(up) {
  if (up.n >= 999) return 'kein Unterhalt nötig';
  const sec = up.t + up.n * cfg.UPKEEP.interval;
  return sec >= 3600 ? `~${(sec / 3600).toFixed(1).replace('.', ',')} h versorgt` : `~${Math.max(1, Math.round(sec / 60))} min versorgt`;
}

// Das gezogene Item klebt an der Maus
export function drawDragged() {
  const d = ui.drag, s = d.eq ? [me.eq[d.eq], 1] : dragStack();
  if (!s || !s[0]) return;
  drawItemIcon(s[0], mouse.x, mouse.y, 42);
  if (!cfg.EQUIPMENT[s[0]]) text(String(d.half ? Math.ceil(s[1] / 2) : s[1]), mouse.x + 18, mouse.y + 22, { size: 14, bold: true });
  if (!overItemWindows(mouse.x, mouse.y) && !d.c) {
    text('Loslassen zum Droppen', mouse.x, mouse.y - 30, { size: 13, bold: true, align: 'center', color: '#ffd76a' });
  }
}
