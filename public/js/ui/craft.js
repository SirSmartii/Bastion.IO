// Handwerk [G]: einfache Rezepte (hand: true in der Config), überall ohne Schmiede herstellbar.

import { me, W, H } from '../state.js';
import { rrect, text, inRect } from '../draw/primitives.js';
import { send } from '../net.js';
import { recipeIds, cardGrid, drawRecipeCard, panelWidth, CARD } from './forge.js';

export function layout() {
  const ids = recipeIds((recipe) => recipe.hand), head = 50, w = panelWidth();
  const h = head + Math.ceil(ids.length / CARD.cols) * (CARD.h + CARD.gap) + 34;
  const x = Math.round(W / 2 - w / 2), y = Math.round(Math.max(60, H / 2 - h / 2 - 40));
  return { panel: { x, y, w, h }, cards: cardGrid(ids, x, y + head) };
}

export function onClick(x, y) {
  const card = layout().cards.find((c) => inRect(x, y, c.btn));
  if (card) send({ t: 'craft', id: card.id });
}

export function draw() {
  const { panel: P, cards } = layout();
  rrect(P.x, P.y, P.w, P.h, 14, 'rgba(24,20,14,0.96)', '#6d6040', 3);
  text('🔨 Handwerk', P.x + 18, P.y + 30, { size: 18, bold: true, color: '#f2d27a' });
  text('[G] schließen · mehr Rezepte an der Schmiede', P.x + P.w - 18, P.y + 30, { size: 12, color: '#a8977f', align: 'right' });
  for (const card of cards) drawRecipeCard(card, Infinity);
  text(me.forge ? 'Bessere Werkzeuge, Waffen & Rüstung: an deiner Schmiede [F]' : 'Bessere Werkzeuge, Waffen & Rüstung: Schmiede bauen (Baumenü [B])',
    P.x + P.w / 2, P.y + P.h - 14, { size: 12, color: '#a8977f', align: 'center' });
}
