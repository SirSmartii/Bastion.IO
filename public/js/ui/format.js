// Formatierung von Kosten und Zahlen für die Anzeige.

import { RES_ICON } from '../constants.js';

// { wood: 10, stone: 5 } → "10🪵 5🪨"
export const fmtCost = (cost) => Object.entries(cost).map(([item, n]) => `${n}${RES_ICON[item]}`).join(' ');
