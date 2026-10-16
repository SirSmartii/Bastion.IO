// Werkbank-Optik des HUDs: Holzbretter mit Nägeln, Pergament-Flächen und Leisten aus einzelnen Segmenten.

import { ctx } from '../state.js';
import { rrect } from '../draw/primitives.js';

export const WOOD = '#5a3d22', WOOD_DARK = '#2e1d0e', WOOD_LIGHT = '#7a5532';
export const PARCHMENT = '#e9dcbc', PARCHMENT_DARK = '#7a5a32', INK = '#3d2a14', INK_LIGHT = '#6b5232';
export const CREAM = '#f3e2c0'; // helle Schrift auf Holz

// Holzbrett: dunkle Kante, helle Innenkante, Nägel in den Ecken. radii wie bei roundRect (Zahl oder Liste).
export function woodPanel(x, y, w, h, radii = 8) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radii);
  ctx.fillStyle = WOOD;
  ctx.fill();
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x + 3.5, y + 3.5, w - 7, h - 7, Array.isArray(radii) ? radii.map((r) => Math.max(0, r - 3)) : Math.max(0, radii - 3));
  ctx.strokeStyle = 'rgba(255,220,160,0.14)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (w > 60 && h > 30) {
    ctx.beginPath();
    for (const [nx, ny] of [[x + 8, y + 8], [x + w - 8, y + 8], [x + 8, y + h - 8], [x + w - 8, y + h - 8]]) {
      ctx.moveTo(nx + 2, ny);
      ctx.arc(nx, ny, 2, 0, Math.PI * 2);
    }
    ctx.fillStyle = '#a08560';
    ctx.fill();
  }
}

export function parchment(x, y, w, h, r = 4) {
  rrect(x, y, w, h, r, PARCHMENT, PARCHMENT_DARK, 2);
}

// Leiste aus n Segmenten: volle Segmente in color, das angebrochene anteilig, leere dunkel.
// Je zwei Füllungen (leer / voll) statt einer pro Segment.
export function segmentBar(x, y, w, h, frac, color, n = 10) {
  const gap = 3, sw = (w - gap * (n - 1)) / n;
  const filled = Math.max(0, Math.min(1, frac)) * n;
  ctx.beginPath();
  for (let i = 0; i < n; i++) ctx.roundRect(x + i * (sw + gap), y, sw, h, 2);
  ctx.fillStyle = WOOD_DARK;
  ctx.fill();
  if (filled <= 0) return;
  ctx.beginPath();
  for (let i = 0; i < Math.ceil(filled); i++) ctx.roundRect(x + i * (sw + gap), y, sw * Math.min(1, filled - i), h, 2);
  ctx.fillStyle = color;
  ctx.fill();
  // Glanzkante oben
  ctx.beginPath();
  for (let i = 0; i < Math.ceil(filled); i++) ctx.rect(x + i * (sw + gap) + 1, y + 1, Math.max(0, sw * Math.min(1, filled - i) - 2), Math.max(1, h * 0.25));
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();
}

// Knopf im Holz-Stil; hover hellt auf. Liefert nichts, Klicks prüft der Aufrufer über das Rechteck.
export function woodButton(r, label, hover, color = WOOD_LIGHT) {
  rrect(r.x, r.y, r.w, r.h, 6, color, hover ? CREAM : WOOD_DARK, hover ? 2.5 : 2);
  if (hover) rrect(r.x, r.y, r.w, r.h, 6, 'rgba(255,255,255,0.08)');
  ctx.font = 'bold 14px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = CREAM;
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 5);
}

