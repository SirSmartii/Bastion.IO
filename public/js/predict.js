// Bewegungsvorhersage für die eigene Figur.
//
// Ohne Vorhersage sähe man die eigene Bewegung erst, wenn der Server sie bestätigt hat – plus den
// Abspiel-Puffer aus interp.js: 30–50 ms lokal, mit echtem Ping deutlich mehr. Deshalb rechnet der Client
// die eigene Bewegung selbst (gleiche Formeln wie movePlayer in server/game/players.js) und zeigt sie sofort.
//
// Abgleich: Jede Eingabe trägt eine Nummer (seq). Der Server meldet mit jedem Zustand, welche Eingabe er
// zuletzt verarbeitet hat (sq) und wie viele Ticks seitdem damit gelaufen sind (sn). Seine Position ist
// die Wahrheit; darauf rechnen wir alle Schritte, die er noch nicht kennt, erneut drauf.
// Kleine Abweichungen werden über ein paar Bilder weich ausgeglichen, große (Respawn) springen.

import { cfg, me, structs } from './state.js';
import { world, resourcesIn, ruinsIn } from './world.js';
import { structSize, isAllied } from './rules.js';

const SNAP = 120; // ab so viel Abweichung springen statt gleiten
const BLEND = 12; // Ausgleich pro Sekunde (exponentiell)

let seq = 0;
let history = []; // vorhergesagte Schritte: { seq, i: n-ter Schritt mit dieser Eingabe, k: Tasten }
let stepsInSeq = 0, keys = 0;
let pos = null; // vorhergesagte Position (Simulation)
let err = { x: 0, y: 0 }; // noch auszugleichender Unterschied zwischen Anzeige und Simulation
let acc = 0; // angesammelte Zeit für feste Simulationsschritte

export const stats = { corr: 0, snaps: 0 }; // für die F3-Anzeige: ⌀ Korrektur (Welteinheiten), Sprünge

// Neue Eingabe wird gesendet: liefert ihre Nummer
export function nextInput(k) {
  seq++;
  keys = k;
  stepsInSeq = 0;
  return seq;
}

export function resetPrediction() {
  pos = null;
  history = [];
  err = { x: 0, y: 0 };
  acc = 0;
}

// Ein Simulationsschritt (wie movePlayer auf dem Server)
function step(p, k, dt) {
  const mx = (k & 8 ? 1 : 0) - (k & 4 ? 1 : 0), my = (k & 2 ? 1 : 0) - (k & 1 ? 1 : 0);
  if (mx || my) {
    const sprint = (k & 16) !== 0 && !me.ex && me.st > 0;
    const len = Math.hypot(mx, my), speed = me.stats.speed * (sprint ? cfg.PLAYER.sprintMult : 1);
    p.x += (mx / len) * speed * dt;
    p.y += (my / len) * speed * dt;
  }
  collide(p);
  const r = cfg.PLAYER.radius, WS = cfg.WORLD_SIZE;
  p.x = Math.min(WS - r, Math.max(r, p.x));
  p.y = Math.min(WS - r, Math.max(r, p.y));
}

// Aus Ressourcen, Seen, Ruinen und Gebäuden herausschieben (wie collideStatics auf dem Server)
function collide(p) {
  const r = cfg.PLAYER.radius, x0 = p.x - r - 130, y0 = p.y - r - 130, x1 = p.x + r + 130, y1 = p.y + r + 130;
  for (const o of resourcesIn(x0, y0, x1, y1)) {
    const def = cfg.RESOURCES[o.type];
    if (!def.solid) continue;
    const min = cfg.RESOURCE_MIN_SCALE, size = def.pick ? o.r : o.r * (min + (1 - min) * o.frac);
    pushOutOfCircle(p, o.x, o.y, size * def.solid);
  }
  for (const [lx, ly, lr] of lakesNear(p)) pushOutOfCircle(p, lx, ly, lr);
  const h = cfg.TILE / 2;
  for (const o of ruinsIn(x0 - h, y0 - h, x1 + h, y1 + h)) pushOutOfRect(p, o.x, o.y, h, h);
  for (const s of structs.values()) {
    if (Math.abs(s.x - p.x) > 200 || Math.abs(s.y - p.y) > 200) continue;
    const def = cfg.STRUCTURES[s.type];
    if (def.walkable || (def.passOwner && isAllied(s.owner))) continue;
    const { hw, hh } = structSize(s.type, s.rot);
    pushOutOfRect(p, s.x, s.y, hw, hh);
  }
}

const lakesNear = (p) => world.lakes.filter(([x, y, r]) => Math.abs(x - p.x) < r + 60 && Math.abs(y - p.y) < r + 60);

function pushOutOfCircle(p, ox, oy, or) {
  const dx = p.x - ox, dy = p.y - oy, min = cfg.PLAYER.radius + or, d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return;
  const d = Math.sqrt(d2) || 0.01;
  p.x += (dx / d) * (min - d);
  p.y += (dy / d) * (min - d);
}

function pushOutOfRect(p, sx, sy, hw, hh) {
  const r = cfg.PLAYER.radius;
  const nx = Math.min(sx + hw, Math.max(sx - hw, p.x)), ny = Math.min(sy + hh, Math.max(sy - hh, p.y));
  const dx = p.x - nx, dy = p.y - ny, d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2), push = r - d;
    p.x += (dx / d) * push;
    p.y += (dy / d) * push;
  } else {
    const outX = hw + r - Math.abs(p.x - sx), outY = hh + r - Math.abs(p.y - sy);
    if (outX < outY) p.x += Math.sign(p.x - sx || 1) * outX;
    else p.y += Math.sign(p.y - sy || 1) * outY;
  }
}

// Jedes Bild: feste Schritte (wie die Server-Ticks) mit den aktuellen Tasten weiterrechnen
export function advance(dt) {
  if (!pos || me.dead) return;
  const tick = 1 / cfg.TICK_RATE;
  acc = Math.min(acc + dt, tick * 10);
  while (acc >= tick) {
    acc -= tick;
    step(pos, keys, tick);
    history.push({ seq, i: stepsInSeq++, k: keys });
  }
  // Anzeige-Abweichung abbauen
  const f = Math.exp(-BLEND * dt);
  err.x *= f;
  err.y *= f;
}

// Mit jedem Server-Zustand: von der bestätigten Position aus alles Unbestätigte erneut rechnen
export function reconcile() {
  if (me.dead || me.sq === undefined) { resetPrediction(); return; }
  const ack = me.sq, done = me.sn;
  history = history.filter((h) => h.seq > ack || (h.seq === ack && h.i >= done));
  if (history.length > cfg.TICK_RATE * 3) history = []; // Server hängt weit hinterher: nichts mehr vorhersagen
  const next = { x: me.x, y: me.y }, tick = 1 / cfg.TICK_RATE;
  for (const h of history) step(next, h.k, tick);
  if (!pos) { pos = next; return; }
  const dx = next.x - pos.x, dy = next.y - pos.y, d = Math.hypot(dx, dy);
  stats.corr += (d - stats.corr) * 0.05;
  if (d > SNAP) { err = { x: 0, y: 0 }; stats.snaps++; }
  else { err.x -= dx; err.y -= dy; }
  pos = next;
}

// Wo die eigene Figur gezeichnet wird (null = keine Vorhersage, normal abspielen)
export function predictedPosition() {
  if (!pos || me.dead) return null;
  return { x: pos.x + err.x, y: pos.y + err.y };
}
