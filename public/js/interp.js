// Zeitgenaues Abspielen der Server-Positionen (Snapshot-Interpolation).
//
// Server-Zustände kommen nicht in perfekt gleichen Abständen an (Timer, Netzwerk). Liefe jede Figur
// einfach zur zuletzt empfangenen Position, würde sie mal schneller, mal langsamer – das ruckelt.
// Stattdessen hat jeder Zustand einen Zeitstempel (Tick-Nummer), und wir zeigen die Welt ein kleines
// Stück in der Vergangenheit: zwischen den zwei Zuständen, die diesen Zeitpunkt umschließen.
// Der Puffer (delay) passt sich an, wie unregelmäßig die Nachrichten gerade ankommen.

import { TAU } from './constants.js';

const KEEP = 10; // Stützpunkte pro Figur
const MIN_DELAY = 0.03, MAX_DELAY = 0.2; // Sekunden

let offset = null; // Ortszeit − Serverzeit; kleinster gesehener Wert ≈ schnellste Laufzeit
let jitter = 0.03; // wie viel später als die schnellste Nachricht welche ankommen (abklingender Höchstwert)
let tickTime = 1 / 60;

export const clientTime = () => performance.now() / 1000;

// Zu jeder Zustands-Nachricht: Server-Tick n
export function onServerTick(n, tickRate) {
  tickTime = 1 / tickRate;
  const serverT = n * tickTime, o = clientTime() - serverT;
  if (offset === null || o < offset) offset = o;
  else offset += (o - offset) * 0.001; // Uhren laufen nie ganz gleich: ganz langsam nachziehen
  jitter = Math.max(o - offset, jitter * 0.995);
  return serverT;
}

// Puffer = Schwankung der Ankunft + ein Tick Reserve (gemessen: mit weniger läuft er ab und zu leer)
export const renderDelay = () => Math.min(MAX_DELAY, Math.max(MIN_DELAY, jitter + tickTime + 0.002));

// Serverzeit, die gerade gezeigt wird
export function renderTime() {
  return offset === null ? 0 : clientTime() - offset - renderDelay();
}

export function resetInterpolation() {
  offset = null;
  jitter = 0.03;
}

// Neuer Stützpunkt für Figur e (Position x/y, Winkel angle zur Serverzeit t)
export function addSample(e, t) {
  const buf = e.buf || (e.buf = []);
  const last = buf[buf.length - 1];
  if (!last || Math.hypot(e.x - last[1], e.y - last[2]) > 300) {
    buf.length = 0; // neu im Bild oder teleportiert (Respawn): nicht quer über die Karte gleiten
  } else if (t - last[0] > tickTime * 2.5) {
    // Lange nichts gehört (stand still, Delta schickte nichts): die alte Position galt bis eben
    buf.push([t - tickTime, last[1], last[2], last[3]]);
  }
  buf.push([t, e.x, e.y, e.angle || 0]);
  if (buf.length > KEEP) buf.splice(0, buf.length - KEEP);
}

// Anzeigeposition (dx, dy, da) zur Serverzeit t
export function sampleAt(e, t) {
  const buf = e.buf;
  if (!buf || !buf.length) { e.dx = e.x; e.dy = e.y; e.da = e.angle || 0; return; }
  let i = buf.length - 1;
  while (i > 0 && buf[i - 1][0] > t) i--;
  const b = buf[i], a = buf[i - 1];
  if (!a || t >= b[0]) { [, e.dx, e.dy, e.da] = b; return; } // neuester Stand (keine Vorhersage)
  if (t <= a[0]) { [, e.dx, e.dy, e.da] = a; return; }
  const k = (t - a[0]) / (b[0] - a[0]);
  e.dx = a[1] + (b[1] - a[1]) * k;
  e.dy = a[2] + (b[2] - a[2]) * k;
  let d = (b[3] - a[3]) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  e.da = a[3] + d * k;
}
