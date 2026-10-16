// Baumenü [B]: Gebäude nach Kategorien, Klick wählt das Gebäude zum Platzieren.

import { ctx, cfg, myId, ui, mouse, W, H } from '../state.js';
import { rrect, text, inRect, wrapText } from '../draw/primitives.js';
import { drawStruct } from '../draw/entities.js';
import { canAfford, buildBlocker } from '../rules.js';
import { fmtCost } from './format.js';

export function layout() {
  const cols = 3, cardW = 190, cardH = 132, gap = 10, pad = 18, head = 44, tabH = 34;
  const types = Object.keys(cfg.STRUCTURES).filter((t) => cfg.STRUCTURES[t].category === ui.buildCat);
  const rows = Math.max(1, Math.ceil(types.length / cols));
  const w = pad * 2 + cols * cardW + (cols - 1) * gap;
  const h = head + tabH + 14 + rows * cardH + (rows - 1) * gap + pad + 22;
  const x = Math.round(W / 2 - w / 2), y = Math.round(Math.max(70, H / 2 - h / 2 - 50));
  ctx.font = 'bold 14px Segoe UI, sans-serif';
  let tabX = x + pad;
  const tabs = cfg.BUILD_CATEGORIES.map((c) => {
    const tabW = ctx.measureText(c.name).width + 28;
    const rect = { x: tabX, y: y + head, w: tabW, h: tabH };
    tabX += tabW + 8;
    return { id: c.id, name: c.name, rect };
  });
  const cards = types.map((type, i) => ({
    type,
    rect: { x: x + pad + (i % cols) * (cardW + gap), y: y + head + tabH + 14 + Math.floor(i / cols) * (cardH + gap), w: cardW, h: cardH },
  }));
  return { panel: { x, y, w, h }, tabs, cards };
}

// Zuletzt gewählte Kategorie wieder öffnen
export function onOpen() {
  if (ui.buildType) ui.buildCat = cfg.STRUCTURES[ui.buildType].category;
}

export function onClick(x, y) {
  const L = layout();
  const tab = L.tabs.find((t) => inRect(x, y, t.rect));
  const card = L.cards.find((c) => inRect(x, y, c.rect));
  if (tab) ui.buildCat = tab.id;
  else if (card) {
    ui.buildType = card.type;
    ui.selected = 1;
    ui.panel = null;
  } else if (!inRect(x, y, L.panel)) ui.panel = null;
}

export function draw() {
  const { panel: P, tabs, cards } = layout();
  rrect(P.x, P.y, P.w, P.h, 14, 'rgba(18,24,14,0.95)', '#4b5d38', 3);
  text('🔨 Baumenü', P.x + 18, P.y + 29, { size: 18, bold: true, color: '#f2d27a' });
  text('[B] schließen · Rechtsklick/[Q] = Bauen abbrechen', P.x + P.w - 18, P.y + 29, { size: 12, color: '#a8b597', align: 'right' });
  for (const t of tabs) {
    const active = t.id === ui.buildCat, hover = inRect(mouse.x, mouse.y, t.rect);
    rrect(t.rect.x, t.rect.y, t.rect.w, t.rect.h, 8, active ? '#7fae45' : hover ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.3)',
      active ? '#5a8130' : 'rgba(255,255,255,0.1)', 2);
    text(t.name, t.rect.x + t.rect.w / 2, t.rect.y + 22, { size: 14, bold: true, align: 'center', color: active ? '#13200a' : '#e9eedd' });
  }
  for (const card of cards) drawCard(card);
  text('Tipp: Über ein eigenes Gebäude fahren → [E] upgraden, [X] abreißen', P.x + P.w / 2, P.y + P.h - 12, { size: 12, color: '#8f9c80', align: 'center' });
}

function drawCard({ type, rect: r }) {
  const def = cfg.STRUCTURES[type], cost = def.levels[0].cost;
  const blocked = buildBlocker(type), afford = canAfford(cost);
  const hover = inRect(mouse.x, mouse.y, r), chosen = type === ui.buildType;
  rrect(r.x, r.y, r.w, r.h, 10, hover ? 'rgba(255,230,140,0.12)' : 'rgba(0,0,0,0.32)',
    chosen ? '#ffd76a' : hover ? 'rgba(255,215,106,0.6)' : 'rgba(255,255,255,0.1)', chosen ? 3 : 2);
  // Vorschau des Gebäudes
  ctx.save();
  ctx.globalAlpha = blocked ? 0.4 : 1;
  ctx.translate(r.x + 34, r.y + 38);
  const k = type === 'core' ? 0.42 : 0.82;
  ctx.scale(k, k);
  drawStruct({ type, x: 0, y: 0, level: 0, hp: 1, maxHp: 1, owner: myId, angle: -0.8 }, true);
  ctx.restore();

  text(def.name, r.x + 66, r.y + 26, { size: 15, bold: true, color: blocked ? '#999' : '#fff' });
  if (def.limit) text(`max ${def.limit}`, r.x + r.w - 10, r.y + 26, { size: 11, color: '#a8b597', align: 'right' });
  ctx.font = '12px Segoe UI, sans-serif';
  wrapText(def.desc || '', r.w - 76).slice(0, 3).forEach((line, i) => text(line, r.x + 66, r.y + 45 + i * 15, { size: 12, color: '#b9c4aa' }));
  text(fmtCost(cost), r.x + 10, r.y + r.h - 30, { size: 13, color: afford ? '#9fe870' : '#ff8a7a' });
  text(blocked || (afford ? 'Klicken zum Auswählen' : 'Zu wenig Ressourcen'), r.x + 10, r.y + r.h - 11,
    { size: 11, color: blocked ? '#ff9a7a' : afford ? '#cfd8c0' : '#c9a69e' });
}
