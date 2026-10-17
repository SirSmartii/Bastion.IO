// Inventar-Fenster und daneben der offene Behälter: Truhe, Schmelzofen (mit Fortschritt) oder Kern-Lager (mit Unterhalt).

import { ctx, cfg, me, myId, structs, ui, mouse, W, H } from '../state.js';
import { rrect, text, inRect, fmtClock } from '../draw/primitives.js';
import { drawItemIcon, stackMax, gearBadge } from '../draw/items.js';
import { fmtCost } from './format.js';
import { RES_ICON } from '../constants.js';
import { itemTooltip } from './tooltip.js';
import { charLayout } from './character.js';
import { t, dec } from '../i18n.js';

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
  const n = me ? me.inv.length : cfg.INVENTORY.slots, head = 40, h = gridHeight(n, head); // mit Rucksack mehr Plätze
  const sideBySide = ui.char || (me && me.ch); // Charakter oder Truhe rechts daneben
  const x = Math.round(sideBySide ? W / 2 - GRID_WIDTH - 8 : W / 2 - GRID_WIDTH / 2);
  const y = Math.round(Math.max(80, H / 2 - h / 2 - 40));
  return { panel: { x, y, w: GRID_WIDTH, h }, slots: slotGrid(n, x, y, head) };
}

// Behälterfenster rechts neben dem Inventar; Kern-Lager und Ofen haben oben zusätzlich eine Infozeile
export function chestLayout() {
  const s = structs.get(me.ch[0]), modes = s && cfg.STRUCTURES[s.type].modes;
  const n = me.ch[1].length, head = 40 + (me.ch[2] ? 78 : me.ch[3] ? 58 + (modes && modes.length > 1 ? 34 : 0) : 0), h = gridHeight(n, head);
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
  text(t('Inventar'), P.x + 18, P.y + 27, { size: 18, bold: true, color: '#f2d27a' });
  text(t('{n}/{max} Slots · [Tab] schließen', { n: me.inv.filter(Boolean).length, max: slots.length }), P.x + P.w - 18, P.y + 27, { size: 13, color: '#a8b597', align: 'right' });
  const hoverSlot = invSlotAt(mouse.x, mouse.y);
  drawSlots(slots, me.inv, 0, hoverSlot);

  const chestType = me.ch && structs.get(me.ch[0]) ? structs.get(me.ch[0]).type : null;
  const target = me.ch ? (me.ch[2] ? 'ins Kern-Lager' : chestType === 'campfire' ? 'ins Lagerfeuer' : chestType === 'tanner' ? 'ins Gerbgestell' : me.ch[3] ? 'in den Ofen' : 'in die Truhe') : null;
  const hint = target ? t('Rechtsklick: Stapel {target}', { target }) : t('Ziehen: sortieren / droppen · Shift: Hälfte · Rechtsklick: nutzen');
  text(hint, P.x + P.w / 2, P.y + P.h - 14, { size: 12, color: '#8f9c80', align: 'center' });

  if (ui.drag || hoverSlot < 0 || !me.inv[hoverSlot]) return;
  const [item, n, d] = me.inv[hoverSlot];
  if (target) itemTooltip(item, [[t('× {n} · Rechtsklick: {target}', { n, target }), '#cfd8c0']], d);
  else if (cfg.EQUIPMENT[item]) itemTooltip(item, [[t('Rechtsklick: ausrüsten'), '#a8b597']], d);
  else if (cfg.ITEMS.food[item]) itemTooltip(item, [[t('× {n} · Rechtsklick: verbrauchen', { n }), '#cfd8c0'], [foodText(item), '#9fe870']]);
  else itemTooltip(item, [[`× ${n}  (max ${stackMax(item)})`, '#cfd8c0']]);
}

export function drawChest() {
  const { panel: P, slots } = chestLayout();
  const box = me.ch[1], upkeep = me.ch[2], furnace = me.ch[3], s = structs.get(me.ch[0]);
  rrect(P.x, P.y, P.w, P.h, 14, 'rgba(30,22,12,0.95)', '#7a5a32', 3);
  // Bei Team-Truhen den Besitzer nennen
  const owner = s && s.owner !== myId && me.team ? me.team.m.find((m) => m[0] === s.owner) : null;
  const campfire = s && s.type === 'campfire';
  const title = t(upkeep ? '🏰 Kern-Lager' : campfire ? '🔥 Lagerfeuer' : s && s.type === 'tanner' ? '🟫 Gerbgestell' : furnace ? '🔥 Schmelzofen' : '📦 Truhe');
  text(owner ? t('{title} von {name}', { title, name: owner[1] }) : title, P.x + 18, P.y + 27, { size: 18, bold: true, color: '#f2d27a' });
  text(t('{n}/{max} · [F] schließen', { n: box.filter(Boolean).length, max: box.length }), P.x + P.w - 18, P.y + 27, { size: 13, color: '#c2ab88', align: 'right' });
  if (upkeep) drawUpkeepInfo(upkeep, P.x + 18, P.y + 52, P.w - 36);
  if (furnace && campfire) drawCampfireInfo(furnace, P.x + 18, P.y + 52, P.w - 36);
  else if (furnace) drawFurnaceInfo(furnace, P.x + 18, P.y + 52, P.w - 36);
  const hoverSlot = chestSlotAt(mouse.x, mouse.y);
  drawSlots(slots, box, 1, hoverSlot);
  text(t('Ziehen: einlagern / entnehmen · Rechtsklick: ganzer Stapel'), P.x + P.w / 2, P.y + P.h - 14, { size: 12, color: '#a8957a', align: 'center' });
  if (!ui.drag && hoverSlot >= 0 && box[hoverSlot]) {
    const [item, n, d] = box[hoverSlot];
    itemTooltip(item, [[cfg.EQUIPMENT[item] ? t('Rechtsklick: ins Inventar') : t('× {n} · Rechtsklick: ins Inventar', { n }), '#cfd8c0']], d);
  }
}

// Unterhalt { c: Kosten, t: Sekunden bis zur Zahlung, n: gedeckte Zahlungen, d: verfällt }
function drawUpkeepInfo(up, x, y, w) {
  rrect(x - 6, y - 16, w + 12, 66, 8, up.d ? 'rgba(140,30,20,0.45)' : 'rgba(0,0,0,0.3)', up.d ? '#e05555' : 'rgba(255,255,255,0.08)', 1.5);
  text(t('Unterhalt alle {n} min: {cost}', { n: cfg.UPKEEP.interval / 60, cost: fmtCost(up.c) || '–' }), x, y, { size: 13, bold: true, color: '#f2e2c4' });
  text(t('Nächste Zahlung in {time} · repariert {n} % HP', { time: fmtClock(up.t), n: Math.round(cfg.UPKEEP.repair * 100) }), x, y + 20, { size: 12, color: '#c2ab88' });
  if (up.d) text(t('⚠ Vorrat leer – die Basis verfällt! Holz/Stein/Gold einlagern.'), x, y + 40, { size: 12, bold: true, color: '#ff8a7a' });
  else text(t('Vorrat reicht für {n} Zahlung(en) · {supply}', { n: up.n >= 999 ? '∞' : up.n, supply: supplyText(up) }), x, y + 40, { size: 12, color: up.n < 2 ? '#ffb36a' : '#9fe870' });
}

// Ofen & Gerbgestell { a: läuft, p: Fortschritt, t: Sekunden pro Durchgang, n: wie oft das Material noch reicht,
//   m: Betriebsart } – Rezepte der Betriebsart, Fortschritt und (bei mehreren) Knöpfe zum Umschalten
function drawFurnaceInfo(f, x, y, w) {
  const s = structs.get(me.ch[0]), def = s && cfg.STRUCTURES[s.type];
  if (!def || !def.modes) return;
  const mode = def.modes.find((m) => m.id === f.m) || def.modes[0];
  rrect(x - 6, y - 16, w + 12, 48, 8, 'rgba(0,0,0,0.3)', f.a ? '#e8913a' : 'rgba(255,255,255,0.08)', 1.5);
  const recipes = mode.recipes.map((r) => `${fmtCost(r.cost)} → ${r.n || 1}${RES_ICON[r.out]}`).join('   ');
  text(`${recipes}  ·  ${dec(f.t)} s`, x, y, { size: 12, bold: true, color: '#f2e2c4' });
  if (f.a) {
    rrect(x, y + 10, w * 0.55, 10, 4, 'rgba(0,0,0,0.5)');
    rrect(x, y + 10, Math.max(4, w * 0.55 * f.p), 10, 4, '#ff9a3a');
    text(t('läuft · noch {n}×', { n: f.n }), x + w, y + 19, { size: 12, color: '#ffc27a', align: 'right' });
  } else {
    const need = [...new Set(mode.recipes.flatMap((r) => Object.keys(r.cost)))].map((i) => cfg.ITEMS.names[i]).join(', ');
    text(f.n > 0 ? t('Kein Platz für das Ergebnis – entnimm etwas.') : t('Aus – lege {items} hinein.', { items: need }), x, y + 20, { size: 12, color: '#c2ab88' });
  }
  for (const b of modeButtons()) {
    const active = b.id === mode.id, locked = b.level && s.level + 1 < b.level, hover = inRect(mouse.x, mouse.y, b.rect);
    rrect(b.rect.x, b.rect.y, b.rect.w, b.rect.h, 6, active ? '#c98a3c' : hover ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.35)', active ? '#8a5a20' : 'rgba(255,255,255,0.12)', 1.5);
    text(locked ? `${b.name} · Lv ${b.level}` : b.name, b.rect.x + b.rect.w / 2, b.rect.y + 17, { size: 11, bold: true, align: 'center', color: active ? '#1f1409' : locked ? '#8a8070' : '#e9e0d0' });
  }
}

// Knöpfe für die Betriebsart des offenen Ofens (leer, wenn es nur eine gibt)
export function modeButtons() {
  const s = me && me.ch && structs.get(me.ch[0]), def = s && cfg.STRUCTURES[s.type];
  if (!def || !def.modes || def.modes.length < 2) return [];
  const { panel: P } = chestLayout(), n = def.modes.length, gap = 6, w = (P.w - 36 - gap * (n - 1)) / n;
  return def.modes.map((m, i) => ({ id: m.id, name: m.name, level: m.level, rect: { x: P.x + 18 + i * (w + gap), y: P.y + 88, w, h: 26 } }));
}

// Lagerfeuer { a: brennt, p: Fortschritt, t: Sekunden pro Stück, n: rohe Stücke, f: Sekunden Brennstoff }
function drawCampfireInfo(f, x, y, w) {
  const def = cfg.STRUCTURES.campfire;
  rrect(x - 6, y - 16, w + 12, 48, 8, 'rgba(0,0,0,0.3)', f.a ? '#e8913a' : 'rgba(255,255,255,0.08)', 1.5);
  const cooks = Object.entries(def.cook).map(([raw, done]) => `${RES_ICON[raw]}→${RES_ICON[done]}`).join(' ');
  text(t('{cooks}  ·  alle {n} s', { cooks, n: dec(f.t) }), x, y, { size: 13, bold: true, color: "#f2e2c4" });
  if (!f.a) {
    text(t('Aus – lege Holz hinein. Brennend verscheucht es Tiere.'), x, y + 20, { size: 12, color: '#c2ab88' });
    return;
  }
  if (f.n) {
    rrect(x, y + 10, w * 0.5, 10, 4, 'rgba(0,0,0,0.5)');
    rrect(x, y + 10, Math.max(4, w * 0.5 * f.p), 10, 4, '#ff9a3a');
  }
  text(t(f.n ? 'brät · noch {n} · Holz für {time}' : 'brennt · Holz für {time}', { n: f.n, time: fmtClock(f.f) }), x + w, y + 19, { size: 12, color: '#ffc27a', align: 'right' });
}

// Was ein Lebensmittel bringt, z. B. "+35 🍖 Hunger · +10 ❤ Leben"
export function foodText(item) {
  const def = cfg.ITEMS.food[item] || {}, parts = [];
  if (def.food) parts.push(t('+{n} 🍖 Hunger', { n: def.food }));
  if (def.water) parts.push(t('+{n} 💧 Durst', { n: def.water }));
  if (def.hp) parts.push(t('{n} ❤ Leben', { n: `${def.hp > 0 ? '+' : ''}${def.hp}` }));
  if (def.buff) parts.push(def.buff.regen ? t('{n}× Regeneration für {s} s', { n: def.buff.regen, s: def.buff.t }) : t('+{n} % Ausdauer-Erholung für {s} s', { n: Math.round((def.buff.staminaRegen - 1) * 100), s: def.buff.t }));
  const cooked = cfg.STRUCTURES.campfire.cook[item];
  if (cooked) parts.push(t('am Lagerfeuer → {item}', { item: cfg.ITEMS.names[cooked] }));
  return parts.join(' · ');
}

// Wie lange die Basis noch versorgt ist (bis zur ersten Zahlung, die nicht mehr klappt)
export function supplyText(up) {
  if (up.n >= 999) return t('kein Unterhalt nötig');
  const sec = up.t + up.n * cfg.UPKEEP.interval;
  return sec >= 3600 ? t('~{n} h versorgt', { n: dec((sec / 3600).toFixed(1)) }) : t('~{n} min versorgt', { n: Math.max(1, Math.round(sec / 60)) });
}

// Das gezogene Item klebt an der Maus
export function drawDragged() {
  const d = ui.drag, s = d.eq ? [me.eq[d.eq], 1] : dragStack();
  if (!s || !s[0]) return;
  drawItemIcon(s[0], mouse.x, mouse.y, 42);
  if (!cfg.EQUIPMENT[s[0]]) text(String(d.half ? Math.ceil(s[1] / 2) : s[1]), mouse.x + 18, mouse.y + 22, { size: 14, bold: true });
  if (!overItemWindows(mouse.x, mouse.y) && !d.c) {
    text(t('Loslassen zum Droppen'), mouse.x, mouse.y - 30, { size: 13, bold: true, align: 'center', color: '#ffd76a' });
  }
}
