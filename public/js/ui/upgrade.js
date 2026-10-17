// Schmiede-Reiter "Verbessern": Ausrüstung auswählen, verbessern (+1 … +5), Boni umschmieden, zerlegen.
// Die Chancen rechnet der Client zur Anzeige nach (gleiche Formel wie upgradeOdds in server/game/gear.js).

import { ctx, cfg, me, ui, mouse, now } from '../state.js';
import { rrect, text, inRect } from '../draw/primitives.js';
import { drawItemIcon, gearName, gearLines, rarityOf, gearBadge, fmtStats, fmtMod } from '../draw/items.js';
import { RES_ICON } from '../constants.js';
import { send } from '../net.js';
import { itemTooltip } from './tooltip.js';

const TILE = 52, GAP = 6, COLS = 4;
const ODDS_COLORS = ['#7ed957', '#8a8f86', '#f0a040', '#e05555'];
const ODDS_NAMES = ['Erfolg', 'nichts', 'Stufe −1', 'zerstört'];
let salvageArmed = -9; // Zerlegen braucht einen zweiten Klick innerhalb von 2 s

// Alle Ausrüstungsteile: getragene zuerst, dann das Inventar
function gearEntries() {
  const list = [];
  for (const slot of cfg.EQUIP_SLOTS) {
    const item = me.eq[slot.id];
    if (item) list.push({ src: 'eq', i: slot.id, item, d: (me.eqd && me.eqd[slot.id]) || null });
  }
  me.inv.forEach((s, i) => { if (s && cfg.EQUIPMENT[s[0]]) list.push({ src: 'inv', i, item: s[0], d: s[2] || null }); });
  return list;
}

const practiceLevel = (id) => ((me.prac || []).find((e) => e[0] === id) || [0, 0])[1];
function practiceBonus(key) {
  const def = cfg.PRACTICE.list.find((d) => d.per[key] !== undefined);
  return def ? def.per[key] * practiceLevel(def.id) : 0;
}

// wie upgradeOdds auf dem Server
function upgradeOdds(target, ward) {
  let [ok, , drop, brk] = cfg.GEAR.upgrade[target - 1].odds;
  drop *= Math.max(0, 1 + practiceBonus('smithDrop'));
  brk *= Math.max(0, 1 + practiceBonus('smithBreak'));
  if (ward) brk = 0;
  ok = Math.min(100 - drop - brk, ok + practiceBonus('smithSuccess') * 100);
  return [ok, 100 - ok - drop - brk, drop, brk].map((v) => +v.toFixed(1));
}

function reforgeCost(d) {
  const R = cfg.GEAR.reforge, k = 1 + R.growth * ((d && d.f) || 0), cost = {};
  for (const [item, n] of Object.entries(R.cost)) cost[item] = Math.ceil(n * k);
  return cost;
}

const have = (cost) => Object.entries(cost).every(([k, v]) => (me.res[k] || 0) >= v);

// Layout im Bereich { x, y, w } unterhalb der Reiter
export function upgradeLayout(x, y, w) {
  const entries = gearEntries();
  const tiles = entries.map((e, k) => ({ ...e, rect: { x: x + (k % COLS) * (TILE + GAP), y: y + 26 + Math.floor(k / COLS) * (TILE + GAP), w: TILE, h: TILE } }));
  let sel = tiles.find((t) => ui.upgSel && t.src === ui.upgSel.src && t.i === ui.upgSel.i) || tiles[0] || null;
  const dx = x + COLS * (TILE + GAP) + 14, dw = w - (dx - x);
  const L = { tiles, sel, detail: { x: dx, y, w: dw }, buttons: [] };
  if (!sel) return L;
  const d = sel.d, mods = d ? d.m : [];
  // Umschmieden-Knöpfe neben den Boni bzw. dem Fluch
  const rowY = (k) => y + 92 + k * 20;
  mods.forEach((_, k) => L.buttons.push({ act: 'rf', k, rect: { x: dx + dw - 30, y: rowY(k) - 14, w: 28, h: 18 } }));
  if (d && d.c) L.buttons.push({ act: 'rf', k: -1, rect: { x: dx + dw - 30, y: rowY(mods.length) - 14, w: 28, h: 18 } });
  const by = y + 196;
  const target = ((d && d.u) || 0) + 1;
  if (target <= cfg.GEAR.upgrade.length) {
    if (cfg.GEAR.upgrade[target - 1].odds[3] > 0 && (me.res.ward || 0) > 0) L.buttons.push({ act: 'ward', rect: { x: dx, y: by + 58, w: dw, h: 20 } });
    L.buttons.push({ act: 'upg', rect: { x: dx, y: by + 84, w: dw * 0.62, h: 30 } });
  }
  if (sel.src === 'inv') L.buttons.push({ act: 'salv', rect: { x: dx + dw * 0.62 + 8, y: by + 84, w: dw * 0.38 - 8, h: 30 } });
  return L;
}

export function upgradeClick(mx, my, L) {
  const tile = L.tiles.find((t) => inRect(mx, my, t.rect));
  if (tile) { ui.upgSel = { src: tile.src, i: tile.i }; return; }
  const btn = L.buttons.find((b) => inRect(mx, my, b.rect));
  if (!btn || !L.sel) return;
  const { src, i } = L.sel;
  if (btn.act === 'ward') ui.upgWard = !ui.upgWard;
  else if (btn.act === 'upg') send({ t: 'upg', src, i, ward: !!ui.upgWard });
  else if (btn.act === 'rf') send({ t: 'rf', src, i, k: btn.k });
  else if (btn.act === 'salv') {
    if (now - salvageArmed < 2) { send({ t: 'salv', i }); salvageArmed = -9; ui.upgSel = null; } else salvageArmed = now;
  }
}

function costText(cost, x, y) {
  ctx.font = '12px Segoe UI, sans-serif';
  for (const [item, n] of Object.entries(cost)) {
    const label = `${n}${RES_ICON[item]}`;
    text(label, x, y, { size: 12, color: (me.res[item] || 0) >= n ? '#9fe870' : '#ff8a7a' });
    x += ctx.measureText(label).width + 7;
  }
  return x;
}

const button = (r, label, ok, color = '#7fae45') => {
  const hover = inRect(mouse.x, mouse.y, r);
  rrect(r.x, r.y, r.w, r.h, 7, ok ? (hover ? '#9ad35c' : color) : '#4a4a44', ok ? '#3d5a20' : '#333', 2);
  text(label, r.x + r.w / 2, r.y + r.h / 2 + 5, { size: 13, bold: true, align: 'center', color: ok ? '#13200a' : '#888' });
};

export function drawUpgrade(L, x, y) {
  text('Deine Ausrüstung', x, y + 14, { size: 13, bold: true, color: '#e9e0d0' });
  let hover = null;
  for (const t of L.tiles) {
    const selected = L.sel && t.src === L.sel.src && t.i === L.sel.i, over = inRect(mouse.x, mouse.y, t.rect);
    if (over) hover = t;
    rrect(t.rect.x, t.rect.y, TILE, TILE, 8, selected ? 'rgba(255,215,106,0.22)' : over ? 'rgba(255,230,140,0.12)' : 'rgba(0,0,0,0.35)',
      selected ? '#ffd76a' : 'rgba(255,255,255,0.1)', 2);
    drawItemIcon(t.item, t.rect.x + TILE / 2, t.rect.y + TILE / 2, 34);
    gearBadge(t.rect, t.d);
    if (t.src === 'eq') text('E', t.rect.x + TILE - 6, t.rect.y + TILE - 5, { size: 10, bold: true, color: '#9fe870', align: 'right' });
  }
  if (!L.tiles.length) text('Keine Ausrüstung im Inventar.', x, y + 46, { size: 12, color: '#a8977f' });
  if (hover) itemTooltip(hover.item, [], hover.d);

  const sel = L.sel;
  if (!sel) return;
  const { x: dx, w: dw } = L.detail, d = sel.d, def = cfg.EQUIPMENT[sel.item], R = rarityOf(d);
  rrect(dx - 8, y, dw + 8, 344, 10, 'rgba(0,0,0,0.3)', R.color + '66', 2);
  drawItemIcon(sel.item, dx + 26, y + 30, 40);
  text(gearName(sel.item, d), dx + 54, y + 24, { size: 16, bold: true, color: R.color });
  text(fmtStats(def, d), dx + 54, y + 42, { size: 11, color: '#cfd8c0' });
  text(sel.src === 'eq' ? 'angelegt' : 'im Inventar', dx + dw - 8, y + 24, { size: 11, color: sel.src === 'eq' ? '#9fe870' : '#a8977f', align: 'right' });

  // Seltenheit, Boni und Fluch – mit Umschmieden-Knöpfen
  gearLines(d).forEach(([line, color], k) => text(line.trim(), dx + 4, y + 72 + k * 20, { size: 13, bold: k === 0, color }));
  const rf = reforgeCost(d), canRf = have(rf);
  for (const b of L.buttons.filter((b) => b.act === 'rf')) {
    const over = inRect(mouse.x, mouse.y, b.rect);
    rrect(b.rect.x, b.rect.y, b.rect.w, b.rect.h, 5, over && canRf ? '#c98a3c' : 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.2)', 1);
    text(b.k === -1 ? '✕' : '↻', b.rect.x + b.rect.w / 2, b.rect.y + 14, { size: 13, bold: true, align: 'center', color: canRf ? '#f2d27a' : '#777' });
    if (over) itemTooltip(sel.item, [[b.k === -1 ? 'Fluch brechen (Boni verlieren ihre Verstärkung)' : 'Diesen Bonus neu würfeln', '#ffd76a']], d);
  }
  if (d && (d.m.length || d.c)) {
    const ry = y + 92 + (d.m.length + (d.c ? 1 : 0)) * 20;
    text('↻ / ✕ Umschmieden:', dx + 4, ry, { size: 12, color: '#a8977f' });
    costText(rf, dx + 122, ry);
  } else text('Gewöhnlich – keine Boni zum Umschmieden.', dx + 4, y + 112, { size: 12, color: '#7c7468' });

  // Verbessern
  const by = y + 196, target = ((d && d.u) || 0) + 1;
  if (target > cfg.GEAR.upgrade.length) {
    text(`Höchste Stufe erreicht (+${d.u})`, dx + 4, by + 20, { size: 14, bold: true, color: '#ffd76a' });
  } else {
    const step = cfg.GEAR.upgrade[target - 1], ward = !!ui.upgWard && (me.res.ward || 0) > 0 && step.odds[3] > 0;
    // Stahl-Ausrüstung und besser: Stahl statt Eisen (wie upgradeCost in server/game/gear.js)
    const cost = { ...step.cost };
    if ((def.tier || 0) >= cfg.GEAR.steelFrom && cost.iron) { cost.steel = cost.iron; delete cost.iron; }
    text(`Verbessern auf +${target}:`, dx + 4, by + 4, { size: 13, bold: true, color: '#f2e2c4' });
    costText(cost, dx + 130, by + 4);
    // Chancen als Leiste
    const odds = upgradeOdds(target, ward), barW = dw - 8;
    let bx = dx + 4;
    odds.forEach((v, k) => {
      if (!v) return;
      rrect(bx, by + 14, Math.max(2, (barW * v) / 100), 12, 3, ODDS_COLORS[k]);
      bx += (barW * v) / 100;
    });
    const label = odds.map((v, k) => (v ? `${String(v).replace('.', ',')} % ${ODDS_NAMES[k]}` : null)).filter(Boolean).join(' · ');
    text(label, dx + 4, by + 44, { size: 11, color: '#cfc4b0' });
    const wardBtn = L.buttons.find((b) => b.act === 'ward');
    if (wardBtn) {
      rrect(wardBtn.rect.x + 4, wardBtn.rect.y + 3, 14, 14, 3, ward ? '#ffd76a' : 'rgba(0,0,0,0.4)', '#ffd76a', 1.5);
      text(`Schutzsiegel benutzen (${me.res.ward}) – verhindert Zerstören`, wardBtn.rect.x + 24, wardBtn.rect.y + 15, { size: 12, color: '#ffd76a' });
    }
    const upg = L.buttons.find((b) => b.act === 'upg');
    button(upg.rect, `Verbessern +${target}`, have(cost));
  }
  const salv = L.buttons.find((b) => b.act === 'salv');
  if (salv) {
    const armed = now - salvageArmed < 2;
    button(salv.rect, armed ? 'Wirklich?' : 'Zerlegen', true, armed ? '#e05555' : '#a07850');
  }
  const lvl = practiceLevel('smithing');
  text(`🔨 Schmieden Stufe ${lvl}${lvl ? ' – senkt das Risiko' : ''}`, dx + 4, y + 334, { size: 11, color: "#a8977f" });
}
