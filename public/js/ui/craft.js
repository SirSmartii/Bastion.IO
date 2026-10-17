// Handwerk [G]: einfache Rezepte (hand: true in der Config), überall ohne Schmiede herstellbar –
// und darunter Kochrezepte (campfire: true), die ein brennendes Lagerfeuer brauchen.

import { me, W, H } from '../state.js';
import { rrect, text, inRect } from '../draw/primitives.js';
import { send } from '../net.js';
import { recipeIds, cardGrid, drawRecipeCard, panelWidth, CARD } from './forge.js';
import { t } from '../i18n.js';

// Vier Spalten, wenn das Fenster breit genug ist – sonst würde die Liste zu hoch
const cols = () => (W >= panelWidth(4) + 40 ? 4 : CARD.cols);
const rowsHeight = (n) => Math.ceil(n / cols()) * (CARD.h + CARD.gap);

export function layout() {
  const hand = recipeIds((recipe) => recipe.hand), cooking = recipeIds((recipe) => recipe.campfire);
  const head = 50, section = 30, w = panelWidth(cols());
  const h = head + rowsHeight(hand.length) + section + rowsHeight(cooking.length) + 34;
  const x = Math.round(W / 2 - w / 2), y = Math.round(Math.max(40, H / 2 - h / 2 - 40));
  const cookTop = y + head + rowsHeight(hand.length) + section;
  return { panel: { x, y, w, h }, cards: [...cardGrid(hand, x, y + head, cols()), ...cardGrid(cooking, x, cookTop, cols())], cookTop };
}

export function onClick(x, y) {
  const card = layout().cards.find((c) => inRect(x, y, c.btn));
  if (card) send({ t: 'craft', id: card.id });
}

export function draw() {
  const { panel: P, cards, cookTop } = layout();
  rrect(P.x, P.y, P.w, P.h, 14, 'rgba(24,20,14,0.96)', '#6d6040', 3);
  text(t('🔨 Handwerk'), P.x + 18, P.y + 30, { size: 18, bold: true, color: '#f2d27a' });
  text(t('[G] schließen · mehr Rezepte an der Schmiede'), P.x + P.w - 18, P.y + 30, { size: 12, color: '#a8977f', align: 'right' });
  text(t('🔥 Am Lagerfeuer kochen'), P.x + 18, cookTop - 10, { size: 14, bold: true, color: '#f2d27a' });
  for (const card of cards) drawRecipeCard(card, Infinity);
  text(t(me.forge ? 'Bessere Werkzeuge, Waffen & Rüstung: an deiner Schmiede [F]' : 'Bessere Werkzeuge, Waffen & Rüstung: Schmiede bauen (Baumenü [B])'),
    P.x + P.w / 2, P.y + P.h - 14, { size: 12, color: '#a8977f', align: 'center' });
}
