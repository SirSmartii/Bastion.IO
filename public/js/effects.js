// Kurzlebige Effekte: Partikel, schwebende Zahlen/Texte, Mündungsfeuer und Meldungen oben im Bild.

import { ctx, now } from './state.js';
import { TAU, FONT } from './constants.js';
import { circle } from './draw/primitives.js';

export const particles = [];
export const floats = []; // schwebende Texte in Weltkoordinaten
export const toasts = []; // Meldungen oben im Bild
export const flashes = []; // Mündungsfeuer

export function burst(x, y, color, n, speed) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = speed * (0.3 + Math.random() * 0.7);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5, max: 0.5, color, size: 3 + Math.random() * 4 });
  }
}

export function floatText(x, y, text, color, { big = false, life = 1.1 } = {}) {
  floats.push({ x, y, text, color, life, big });
}

// Rote Schadenszahl über dem Getroffenen, leicht versetzt und mit kurzem "Pop"
export function damageNumber(x, y, n, color) {
  if (!n) return;
  floats.push({ x: x + (Math.random() - 0.5) * 24, y: y - 8, text: String(n), color, life: 0.9, dmg: true, born: now });
}

// Gleiche Meldung nicht doppelt anzeigen, höchstens 4 gleichzeitig
export function toast(text) {
  const same = toasts.find((t) => t.text === text);
  if (same) { same.life = 3.5; return; }
  toasts.push({ text, life: 3.5 });
  if (toasts.length > 4) toasts.shift();
}

export function clearEffects() {
  particles.length = floats.length = toasts.length = flashes.length = 0;
}

export function updateEffects(dt) {
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; p.life -= dt; }
  for (const f of floats) { f.y -= 40 * dt; f.life -= dt; }
  for (const t of toasts) t.life -= dt;
  for (const list of [particles, floats, toasts]) {
    for (let i = list.length - 1; i >= 0; i--) if (list[i].life <= 0) list.splice(i, 1);
  }
}

export function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    circle(p.x, p.y, p.size, p.color);
  }
  ctx.globalAlpha = 1;
}

export function drawFloats() {
  ctx.textAlign = 'center';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  for (const f of floats) {
    ctx.globalAlpha = Math.min(1, f.life * 2);
    const pop = f.dmg ? 1 + Math.max(0, 0.12 - (now - f.born)) * 5 : 1;
    ctx.font = `bold ${Math.round((f.big ? 30 : f.dmg ? 20 : 18) * pop)}px ${FONT}`;
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

export function drawMuzzleFlashes() {
  for (let i = flashes.length - 1; i >= 0; i--) {
    const fl = flashes[i], t = (now - fl.t) / 0.08;
    if (t > 1) { flashes.splice(i, 1); continue; }
    ctx.save();
    ctx.translate(fl.x, fl.y);
    ctx.rotate(fl.a);
    ctx.globalAlpha = 1 - t;
    ctx.beginPath();
    ctx.moveTo(-2, -7); ctx.lineTo(22, 0); ctx.lineTo(-2, 7); ctx.closePath();
    ctx.fillStyle = '#ffd25a';
    ctx.fill();
    circle(2, 0, 7, '#fff3c0');
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
