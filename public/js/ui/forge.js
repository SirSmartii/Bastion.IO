// Schmiede [F]: Rezepte nach Reitern (Werkzeug, Nahkampf, Bögen, Feuerwaffen, Kleidung, Vorräte).
// Die Rezeptkarten nutzt auch das Handwerk-Fenster [G] (ui/craft.js).

import { ctx, cfg, me, ui, mouse, W, H } from '../state.js';
import { rrect, text, inRect } from '../draw/primitives.js';
import { drawItemIcon, itemName, fmtStats } from '../draw/items.js';
import { RES_ICON } from '../constants.js';
import { canAfford, nearFire } from '../rules.js';
import { send } from '../net.js';
import { upgradeLayout, upgradeClick, drawUpgrade } from './upgrade.js';
import { foodText } from './inventory.js';

// Zusätzlicher Reiter nur im Client: Ausrüstung verbessern, umschmieden, zerlegen (ui/upgrade.js)
const UPGRADE_TAB = { id: 'upgrade', name: 'Verbessern' };
const forgeTabs = () => [...cfg.FORGE_TABS, UPGRADE_TAB];

// Rezept eines Items: Ausrüstung hat es direkt, stapelbare Items (Munition) in ITEMS.recipes
function recipeOf(id) {
  return cfg.EQUIPMENT[id] ? cfg.EQUIPMENT[id] : { name: itemName(id), recipe: cfg.ITEMS.recipes[id], stack: true };
}

// IDs aller Rezepte (Ausrüstung und stapelbare Items), auf die filter(recipe, id) passt
export function recipeIds(filter) {
  return [
    ...Object.keys(cfg.EQUIPMENT).filter((id) => cfg.EQUIPMENT[id].recipe && filter(cfg.EQUIPMENT[id].recipe, id)),
    ...Object.keys(cfg.ITEMS.recipes).filter((id) => filter(cfg.ITEMS.recipes[id], id)),
  ];
}

export const CARD = { cols: 3, w: 270, h: 96, gap: 8, pad: 18 };

// Material-Auswahl in einem Reiter (Reihenfolge wie die Material-Leiter, Fell & Leder vorne)
const MAT_ORDER = ['fur', 'leather', 'wood', 'stone', 'copper', 'bronze', 'iron', 'steel', 'diamond', 'ruby'];
const matName = (m) => ({ fur: 'Fell', leather: 'Leder' }[m] || cfg.MATERIALS[m].name);
const matForge = (m) => (cfg.MATERIALS[m] && cfg.MATERIALS[m].forge) || 1;
export const panelWidth = (cols = CARD.cols) => CARD.pad * 2 + cols * CARD.w + (cols - 1) * CARD.gap;

// Karten im Raster ab (x, top)
export function cardGrid(ids, x, top, cols = CARD.cols) {
  return ids.map((id, i) => {
    const rect = { x: x + CARD.pad + (i % cols) * (CARD.w + CARD.gap), y: top + Math.floor(i / cols) * (CARD.h + CARD.gap), w: CARD.w, h: CARD.h };
    return { id, rect, btn: { x: rect.x + rect.w - 92, y: rect.y + rect.h - 34, w: 82, h: 26 } };
  });
}

export function layout() {
  const tab = forgeTabs().some((t) => t.id === ui.forgeTab) ? ui.forgeTab : cfg.FORGE_TABS[0].id;
  const all = tab === 'upgrade' ? [] : recipeIds((recipe, id) => (cfg.EQUIPMENT[id] ? cfg.EQUIPMENT[id].tab : recipe.tab) === tab);
  // Gibt es im Reiter mehrere Materialien, zeigt die Schmiede nur eines (Auswahl über Knöpfe)
  const mats = MAT_ORDER.filter((m) => all.some((id) => cfg.EQUIPMENT[id] && cfg.EQUIPMENT[id].mat === m));
  const forgeLevel = me.forge ? me.forge[3] + 1 : 0;
  const best = [...mats].reverse().find((m) => matForge(m) <= forgeLevel) || mats[0];
  const mat = mats.length > 1 ? (mats.includes(ui.forgeMat) ? ui.forgeMat : best) : null;
  const ids = mat ? all.filter((id) => !cfg.EQUIPMENT[id] || cfg.EQUIPMENT[id].mat === mat) : all;
  const head = 44, tabH = 34, matH = mat ? 34 : 0, w = panelWidth();
  const h = tab === 'upgrade' ? head + tabH + 12 + 356 : head + tabH + 12 + matH + Math.ceil(ids.length / CARD.cols) * (CARD.h + CARD.gap) + 10;
  const x = Math.round(W / 2 - w / 2), y = Math.round(Math.max(60, H / 2 - h / 2 - 40));
  const step = (w - CARD.pad * 2 + 6) / forgeTabs().length;
  const tabs = forgeTabs().map(({ id, name }, i) => ({ id, name, rect: { x: x + CARD.pad + i * step, y: y + head, w: step - 6, h: tabH } }));
  const matStep = mats.length ? (w - CARD.pad * 2 + 6) / mats.length : 0;
  const matTabs = mat ? mats.map((m, i) => ({ id: m, name: matName(m), forge: matForge(m), rect: { x: x + CARD.pad + i * matStep, y: y + head + tabH + 8, w: matStep - 6, h: 26 } })) : [];
  const top = y + head + tabH + 12 + matH;
  const upgrade = tab === 'upgrade' ? upgradeLayout(x + CARD.pad, top, w - CARD.pad * 2) : null;
  return { panel: { x, y, w, h }, tabs, matTabs, mat, cards: cardGrid(ids, x, top), tab, upgrade, top };
}

export function onClick(x, y) {
  const L = layout();
  const tab = L.tabs.find((t) => inRect(x, y, t.rect));
  const matTab = L.matTabs.find((t) => inRect(x, y, t.rect));
  const card = L.cards.find((c) => inRect(x, y, c.btn));
  if (tab) ui.forgeTab = tab.id;
  else if (matTab) ui.forgeMat = matTab.id;
  else if (L.upgrade) upgradeClick(x, y, L.upgrade);
  else if (card) send({ t: 'craft', id: card.id });
}

export function draw() {
  const { panel: P, tabs, matTabs, mat, cards, tab, upgrade, top } = layout();
  const forgeLevel = me.forge ? me.forge[3] + 1 : 0;
  rrect(P.x, P.y, P.w, P.h, 14, 'rgba(24,18,14,0.96)', '#7a5a34', 3);
  text(`⚒️ Schmiede · Lv ${forgeLevel}`, P.x + 18, P.y + 29, { size: 18, bold: true, color: '#f2d27a' });
  text('[F] schließen · höheres Level mit [E] an der Schmiede', P.x + P.w - 18, P.y + 29, { size: 12, color: '#a8977f', align: 'right' });
  for (const t of tabs) {
    const active = t.id === tab;
    rrect(t.rect.x, t.rect.y, t.rect.w, t.rect.h, 8, active ? '#c98a3c' : 'rgba(0,0,0,0.3)', active ? '#8a5a20' : 'rgba(255,255,255,0.1)', 2);
    text(t.name, t.rect.x + t.rect.w / 2, t.rect.y + 22, { size: 12, bold: true, align: 'center', color: active ? '#1f1409' : '#e9e0d0' });
  }
  for (const t of matTabs) {
    const active = t.id === mat, locked = t.forge > forgeLevel;
    rrect(t.rect.x, t.rect.y, t.rect.w, t.rect.h, 6, active ? 'rgba(201,138,60,0.85)' : 'rgba(0,0,0,0.25)', active ? '#8a5a20' : 'rgba(255,255,255,0.08)', 1.5);
    text(t.name + (locked ? ` · Lv ${t.forge}` : ''), t.rect.x + t.rect.w / 2, t.rect.y + 17, { size: 11, bold: active, align: 'center', color: active ? '#1f1409' : locked ? '#8a8070' : '#d9cfbe' });
  }
  if (upgrade) drawUpgrade(upgrade, P.x + CARD.pad, top);
  for (const card of cards) drawRecipeCard(card, forgeLevel);
}

// Text auf maxW Pixel kürzen (mit …), damit er nicht über die Karte läuft
function fitText(str, maxW, font) {
  ctx.font = font;
  if (ctx.measureText(str).width <= maxW) return str;
  while (str.length > 1 && ctx.measureText(str + '…').width > maxW) str = str.slice(0, -1);
  return str.trimEnd() + '…';
}

// forgeLevel: Level der Schmiede (Infinity im Handwerk-Fenster). Handwerk-Rezepte brauchen kein Schmiede-Level.
export function drawRecipeCard({ id, rect: r, btn }, forgeLevel) {
  const def = recipeOf(id), recipe = def.recipe;
  const levelOk = recipe.campfire ? nearFire() : recipe.hand || forgeLevel >= recipe.forge, ok = levelOk && canAfford(recipe.cost);
  const equipped = !def.stack && me.eq[def.slot] === id;
  rrect(r.x, r.y, r.w, r.h, 10, 'rgba(0,0,0,0.35)', equipped ? '#9fe870' : 'rgba(255,255,255,0.1)', 2);
  ctx.globalAlpha = levelOk ? 1 : 0.4;
  drawItemIcon(id, r.x + 30, r.y + 32, 40);
  ctx.globalAlpha = 1;
  text(def.name, r.x + 58, r.y + 22, { size: 14, bold: true, color: levelOk ? '#fff' : '#999' });
  if (equipped) text('angelegt', r.x + r.w - 10, r.y + 22, { size: 11, color: '#9fe870', align: 'right' });
  const info = !def.stack ? fmtStats(def) : cfg.ITEMS.food[id] ? foodText(id) : `${recipe.amount}× pro Herstellung · im Inventar: ${me.res[id] || 0}`;
  text(fitText(info, r.w - 66, '11px Segoe UI, sans-serif'), r.x + 58, r.y + 40, { size: 11, color: '#cfb994' });

  // Kosten: grün = vorhanden, rot = fehlt
  let cx = r.x + 10;
  ctx.font = '12px Segoe UI, sans-serif';
  for (const [item, n] of Object.entries(recipe.cost)) {
    const label = `${n}${RES_ICON[item]}`;
    text(label, cx, r.y + 62, { size: 12, color: (me.res[item] || 0) >= n ? '#9fe870' : '#ff8a7a' });
    cx += ctx.measureText(label).width + 8;
  }
  if (!levelOk) text(recipe.campfire ? 'an einem brennenden Lagerfeuer' : `Schmiede Lv ${recipe.forge} nötig`, r.x + 10, r.y + r.h - 12, { size: 11, color: '#ff8a7a' });

  const hover = inRect(mouse.x, mouse.y, btn);
  rrect(btn.x, btn.y, btn.w, btn.h, 7, ok ? (hover ? '#92c453' : '#7fae45') : '#4a4a44', ok ? '#5a8130' : '#333', 2);
  text('Herstellen', btn.x + btn.w / 2, btn.y + 18, { size: 12, bold: true, align: 'center', color: ok ? '#13200a' : '#888' });
}
