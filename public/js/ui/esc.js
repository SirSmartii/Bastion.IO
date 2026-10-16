// Menü [Esc]: eigenes Überleben, Spielerliste (Bestenliste), Tastenübersicht, Weiterspielen & Ausloggen.
// Das Spiel läuft dabei weiter – es ist ein Mehrspieler-Spiel.

import { ctx, me, myId, account, leaderboard, online, ui, mouse, W, H } from '../state.js';
import { text, inRect } from '../draw/primitives.js';
import { logout } from '../net.js';
import { woodPanel, parchment, woodButton, CREAM, INK, INK_LIGHT } from './theme.js';
import { fmtDuration } from './hud.js';

const WIDTH = 440, PAD = 20, ROW = 22;

// Auch im Tod offen lassen: Ausloggen soll immer gehen
export const whileDead = true;

const KEYS = [
  '[Tab] Inventar · [C] Charakter · [B] Bauen · [G] Handwerk · [K] Fertigkeiten',
  '[T] Team · [M] Karte · [F] Benutzen · [H] Essen · [Shift] Sprinten · [Enter] Chat',
];

// Spielerliste: Bestenliste vom Server (Top 10); wer nicht darin steht, sieht sich selbst darunter
function rows() {
  const list = leaderboard.map(([id, name, score], i) => ({ rank: i + 1, name, score, mine: id === myId }));
  if (!list.some((r) => r.mine)) list.push({ rank: '–', name: 'Du', score: me.score, mine: true });
  return list;
}

export function layout() {
  const list = rows();
  const h = 58 + 64 + 30 + list.length * ROW + 18 + 54 + 56;
  const x = Math.round(W / 2 - WIDTH / 2), y = Math.round(Math.max(20, H / 2 - h / 2));
  const bw = (WIDTH - PAD * 2 - 12) / 2, by = y + h - 50;
  return {
    panel: { x, y, w: WIDTH, h }, list,
    resume: { x: x + PAD, y: by, w: bw, h: 34 },
    logout: { x: x + PAD + bw + 12, y: by, w: bw, h: 34 },
  };
}

export function onClick(x, y) {
  const L = layout();
  if (inRect(x, y, L.logout)) logout();
  else if (inRect(x, y, L.resume) || !inRect(x, y, L.panel)) ui.panel = null;
}

export function draw() {
  const L = layout(), { x, y, w } = L.panel, left = x + PAD, right = x + w - PAD;
  woodPanel(x, y, w, L.panel.h, 12);
  text('Menü', left, y + 34, { size: 20, bold: true, color: CREAM });
  text('[Esc] schließen', right, y + 34, { size: 12, color: 'rgba(243,226,192,0.6)', align: 'right' });

  // Eigenes Überleben
  let cy = y + 50;
  parchment(left, cy, w - PAD * 2, 56);
  const alive = me.dead ? 0 : me.al || 0;
  text(`⏳ ${fmtDuration(alive)} überlebt`, left + 12, cy + 22, { size: 15, bold: true, color: INK });
  text(`Rekord ${fmtDuration(me.ab || 0)}`, right - 12, cy + 22, { size: 13, color: INK_LIGHT, align: 'right' });
  text(`🏆 ${me.score} Punkte   💀 ${me.kills} Kills   Lv ${me.lvl}`, left + 12, cy + 44, { size: 13, color: INK_LIGHT });

  // Spielerliste
  cy += 80;
  text(`Spieler · ${online} online`, left, cy, { size: 14, bold: true, color: CREAM });
  cy += 12;
  parchment(left, cy, w - PAD * 2, L.list.length * ROW + 10);
  L.list.forEach((r, i) => {
    const ry = cy + 21 + i * ROW, color = r.mine ? '#2f6a1c' : INK;
    if (r.mine) {
      ctx.fillStyle = 'rgba(95,143,47,0.18)';
      ctx.fillRect(left + 4, ry - 15, w - PAD * 2 - 8, ROW - 2);
    }
    text(`${r.rank}.`, left + 14, ry, { size: 13, bold: r.mine, color });
    text(r.name, left + 42, ry, { size: 13, bold: r.mine, color });
    text(String(r.score), right - 12, ry, { size: 13, bold: r.mine, color, align: 'right' });
  });

  // Konto, Tasten
  cy += L.list.length * ROW + 30;
  text(account ? `👤 ${account} · Fortschritt wird gespeichert` : '👤 Gast · Fortschritt wird nicht gespeichert', left, cy,
    { size: 12, color: account ? '#b6e08a' : '#e0b0a0' });
  KEYS.forEach((line, i) => text(line, left, cy + 22 + i * 16, { size: 11, color: 'rgba(243,226,192,0.7)' }));

  woodButton(L.resume, 'Weiterspielen', inRect(mouse.x, mouse.y, L.resume), '#4f6b2a');
  woodButton(L.logout, '⏻ Ausloggen', inRect(mouse.x, mouse.y, L.logout), '#8a3a24');
}
