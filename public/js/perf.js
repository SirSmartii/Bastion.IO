// Leistungsanzeige (F3): FPS, Frame-Zeiten mit Verlauf, Zeit pro Zeichenschritt und Netzwerk-Takt.
// Bei offener Anzeige schalten die Tasten J/L/N/O Sonnenschatten, Sichtschatten, Nachtlicht und die
// volle Auflösung ab – so lässt sich herausfinden, was die Grafikkarte bremst (das sieht man in den
// JavaScript-Zeiten nicht, nur an der Frame-Zeit).
// Ruckeln zeigt sich als einzelne lange Frames (Spitzen im Verlauf) oder unregelmäßig ankommende
// Server-Nachrichten – beides ist hier zu sehen, nicht nur der Durchschnitt.

import { ctx, dpr } from './state.js';
import { renderDelay } from './interp.js';

const HISTORY = 180; // Frames im Verlauf (~3 s)

export const perf = {
  visible: false,
  frames: new Float32Array(HISTORY).fill(NaN), // Abstand zwischen Frames in ms (NaN = noch leer)
  frameIndex: 0,
  sections: new Map(), // Name -> { avg, max, cur } in ms
  net: { last: 0, gaps: new Float32Array(HISTORY).fill(NaN), index: 0, bytes: 0, parse: 0 },
  server: null, // [⌀ ms pro Tick, max ms, Ticks] der letzten Sekunde, vom Server gemessen
  js: 0, // ⌀ JavaScript-Zeit pro Bild (ms)
  off: { sun: false, sight: false, night: false, fullRes: false }, // zum Testen abgeschaltet
};

try { perf.visible = localStorage.getItem('perf') === '1'; } catch { /* kein Speicher – egal */ }

export function togglePerf() {
  perf.visible = !perf.visible;
  try { localStorage.setItem('perf', perf.visible ? '1' : '0'); } catch { /* egal */ }
}

// ---------- Messen ----------

let lastFrameT = 0, sectionStart = 0, jsStart = 0;

export function frameStart(t) {
  if (lastFrameT) {
    perf.frames[perf.frameIndex] = t - lastFrameT;
    perf.frameIndex = (perf.frameIndex + 1) % HISTORY;
  }
  lastFrameT = t;
  jsStart = performance.now();
  for (const s of perf.sections.values()) s.cur = 0;
}

// Zeit seit dem letzten mark() dem Abschnitt name zuschreiben
export function mark(name) {
  const t = performance.now();
  if (name) {
    let s = perf.sections.get(name);
    if (!s) perf.sections.set(name, (s = { avg: 0, max: 0, cur: 0, maxT: 0 }));
    s.cur += t - sectionStart;
  }
  sectionStart = t;
}

// Am Frame-Ende: gleitender Mittelwert und Höchstwert der letzten Sekunde
export function frameEnd() {
  const t = performance.now();
  perf.js += (t - jsStart - perf.js) * 0.05;
  for (const s of perf.sections.values()) {
    s.avg += (s.cur - s.avg) * 0.05;
    if (s.cur >= s.max || t - s.maxT > 1000) { s.max = s.cur; s.maxT = t; }
  }
}

export function setServerStats(stats) { perf.server = stats; }

const PERF_OPTIONS = {
  KeyJ: ['sun', 'Sonnenschatten'],
  KeyL: ['sight', 'Sichtschatten'],
  KeyN: ['night', 'Nachtlicht'],
  KeyO: ['fullRes', 'Volle Auflösung'],
};

// Tasten J/L/N/O bei offener Anzeige. onResolution: Zeichenfläche neu anlegen.
// Liefert eine Meldung zum Anzeigen (oder null, wenn die Taste nichts damit zu tun hat).
export function togglePerfOption(key, onResolution) {
  const option = PERF_OPTIONS[key];
  if (!perf.visible || !option) return null;
  const [name, label] = option;
  perf.off[name] = !perf.off[name];
  if (name === 'fullRes') onResolution();
  return `Test: ${label} ${perf.off[name] ? 'AUS' : 'an'}`;
}

export function netMessage(bytes, parseMs) {
  const t = performance.now(), n = perf.net;
  if (n.last) {
    n.gaps[n.index] = t - n.last;
    n.index = (n.index + 1) % HISTORY;
  }
  n.last = t;
  n.bytes += (bytes - n.bytes) * 0.05;
  n.parse += (parseMs - n.parse) * 0.05;
}

// ---------- Anzeige ----------

function stats(arr) {
  let sum = 0, max = 0, n = 0;
  // 0 ms zählt mit: mehrere Nachrichten im selben Moment (der Browser misst oft nur auf 1 ms genau)
  for (const v of arr) if (!Number.isNaN(v)) { sum += v; max = Math.max(max, v); n++; }
  return { avg: n ? sum / n : 0, max };
}

export function drawPerf(x, y) {
  if (!perf.visible) return;
  const frame = stats(perf.frames), gaps = stats(perf.net.gaps);
  const lines = [
    [`${frame.avg ? Math.round(1000 / frame.avg) : 0} FPS · Frame ⌀ ${frame.avg.toFixed(1)} ms, max ${frame.max.toFixed(1)} ms`, frame.max > 40 ? '#ff8a7a' : '#9fe870'],
    serverLine(),
    // Wann der Browser die Nachrichten verarbeitet – ist er mit einem Bild beschäftigt, warten sie (rote Spitzen
    // hier heißen also nicht, dass der Server hängt; das zeigt die Zeile darüber)
    [`Ankunft ⌀ ${gaps.avg.toFixed(1)} ms, max ${gaps.max.toFixed(1)} ms · Abspiel-Puffer ${Math.round(renderDelay() * 1000)} ms`,
      gaps.max > 60 ? '#ffb36a' : '#cfd8c0'],
    [`${(perf.net.bytes / 1024).toFixed(1)} KB pro Nachricht · JSON lesen ${perf.net.parse.toFixed(2)} ms`, '#cfd8c0'],
  ];
  const rest = Math.max(0, frame.avg - perf.js);
  lines.push([`JavaScript ⌀ ${perf.js.toFixed(1)} ms pro Bild · Rest ${rest.toFixed(1)} ms (Browser/Grafikkarte)`,
    rest > 12 && frame.avg > 18 ? '#ffb36a' : '#cfd8c0']);
  const o = perf.off, onOff = (v) => (v ? 'AUS' : 'an');
  lines.push([`Test: [J] Sonne ${onOff(o.sun)} · [L] Sicht ${onOff(o.sight)} · [N] Nacht ${onOff(o.night)} · [O] Auflösung ${o.fullRes ? 'reduziert' : 'voll'}`, '#8fd0ff']);
  for (const [name, s] of perf.sections) lines.push([`${name.padEnd(12)} ⌀ ${s.avg.toFixed(2)} ms   max ${s.max.toFixed(2)} ms`, s.max > 8 ? '#ffb36a' : '#cfd8c0']);

  const w = 470, graphH = 46, h = 14 + lines.length * 17 + graphH * 2 + 20;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x, y, w, h);
  ctx.font = '12px Consolas, monospace';
  ctx.textAlign = 'left';
  lines.forEach(([t, color], i) => {
    ctx.fillStyle = color;
    ctx.fillText(t, x + 8, y + 18 + i * 17);
  });
  const gy = y + 14 + lines.length * 17;
  drawGraph(perf.frames, perf.frameIndex, x + 8, gy, w - 16, graphH, 'Frames', 1000 / 60);
  drawGraph(perf.net.gaps, perf.net.index, x + 8, gy + graphH + 10, w - 16, graphH, 'Ankunft', 1000 / 60);
}

function serverLine() {
  const s = perf.server;
  if (!s) return ['Server: noch keine Messwerte', '#8f9c80'];
  const [avg, max, ticks] = s;
  return [`Server rechnet ⌀ ${avg.toFixed(2)} ms, max ${max.toFixed(1)} ms pro Tick · ${ticks} Ticks/s`,
    max > 16 || ticks < 55 ? '#ff8a7a' : '#9fe870'];
}

// Balken pro Eintrag; die Linie markiert das Ziel (16,7 ms = 60 FPS), Skala bis 50 ms
function drawGraph(arr, start, x, y, w, h, label, target) {
  const scaleMs = 50, bw = w / HISTORY;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(x, y, w, h);
  for (let i = 0; i < HISTORY; i++) {
    const v = arr[(start + i) % HISTORY];
    if (Number.isNaN(v)) continue;
    const bh = Math.min(h, (v / scaleMs) * h);
    ctx.fillStyle = v > 34 ? '#ff5a4a' : v > 20 ? '#ffb34a' : '#6fd36a';
    ctx.fillRect(x + i * bw, y + h - bh, Math.max(1, bw - 0.5), bh);
  }
  const ty = y + h - (target / scaleMs) * h;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(x, ty, w, 1);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, x + 4, y + 12);
}
