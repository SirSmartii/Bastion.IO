// Einfache Zeichenfunktionen auf dem Haupt-Canvas.

import { ctx } from '../state.js';
import { TAU, FONT } from '../constants.js';

export function circle(x, y, r, fill, stroke, lineWidth) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth || 3; ctx.stroke(); }
}

export function ellipse(x, y, rx, ry, fill, stroke, lineWidth) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth || 3; ctx.stroke(); }
}

// Abgerundetes Rechteck
export function rrect(x, y, w, h, r, fill, stroke, lineWidth) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth || 3; ctx.stroke(); }
}

// Pfad durch Punkte [[x, y], …] (optional skaliert), geschlossen – danach fill()/stroke()
export function poly(points, k = 1) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
  ctx.closePath();
}

export function text(str, x, y, { size = 15, color = '#fff', align = 'left', bold = false } = {}) {
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

// Text mit dunkler Kontur (gut lesbar auf dem Spielfeld)
export function outlinedText(str, x, y, { size = 16, color = '#fff', align = 'center', bold = true, outline = 'rgba(0,0,0,0.6)', width = 4 } = {}) {
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.lineWidth = width;
  ctx.strokeStyle = outline;
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

// Halbtransparente Fläche für HUD-Elemente
export function panel(x, y, w, h) {
  rrect(x, y, w, h, 10, 'rgba(10,14,8,0.62)', 'rgba(255,255,255,0.08)', 2);
}

// Kleiner Lebensbalken, mittig über/unter einem Objekt
export function hpBar(x, y, w, frac, color) {
  rrect(x - w / 2, y, w, 8, 4, 'rgba(0,0,0,0.55)');
  rrect(x - w / 2 + 1.5, y + 1.5, Math.max(0, (w - 3) * frac), 5, 2.5, color);
}

// Text auf Zeilen mit höchstens maxW Pixeln umbrechen (mit der aktuell gesetzten Schrift)
export function wrapText(str, maxW) {
  const lines = [];
  let line = '';
  for (const word of str.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxW && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

export const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
