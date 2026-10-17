// Sonnenschatten am Tag, Dunkelheit mit Lichtquellen und Schattenwurf in der Nacht,
// und Sichtschatten: was die eigene Figur hinter Deckung nicht sehen kann.

import { ctx, cfg, me, myId, clock, players, zombies, structs, dpr, scale, worldToScreen } from '../state.js';
import { RES_HEIGHT, RUIN_HEIGHT, STRUCT_HEIGHT, TREE_TYPES } from '../constants.js';
import { resourcesIn, ruinsIn, resScale } from '../world.js';
import { structSize } from '../rules.js';

const darkCanvas = document.createElement('canvas'); // Nacht-Dunkelheit mit ausgeschnittenen Lichtern
const darkCtx = darkCanvas.getContext('2d');
const lightCanvas = document.createElement('canvas'); // eine Lichtquelle samt ihrer Schatten
const lightCtx = lightCanvas.getContext('2d');

// Sonnen- und Sichtschatten kommen direkt auf die Zeichenfläche: alle Formen in einem einzigen Pfad,
// einmal gefüllt – Überlappungen werden so nicht doppelt dunkel (Regel "nonzero", alle Teilpfade laufen
// gleich herum), und es braucht keine eigene Ebene, die jedes Bild über den ganzen Bildschirm geblendet
// werden müsste (das kostete ohne Grafikbeschleunigung, z. B. oft in Firefox, ~6 ms pro Ebene).
// Nur die Nacht braucht eine Ebene (weiche Lichtkegel); sie wird in geringerer Auflösung gezeichnet.
const LAYER_RES = 0.5; // Anteil der CSS-Auflösung

export function resizeLighting(width, height) {
  const k = Math.min(1, LAYER_RES / dpr);
  darkCanvas.width = Math.max(1, Math.ceil(width * k));
  darkCanvas.height = Math.max(1, Math.ceil(height * k));
}

// Ebene halbtransparent über das ganze Bild legen
function drawLayer(layer, alpha) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  // 'low' = bilinear: bei weichen Schattenflächen kein sichtbarer Unterschied. 'high' kostete ohne
  // Grafikbeschleunigung (Firefox zeichnet Canvas oft in Software) ~10 ms pro Ebene und Bild.
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(layer, 0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

const structBox = (s) => structSize(s.type, s.rot);
// Schattenwerfende Rechtecke (Mauern, Ruinen) sind so viel größer als ihr Feld: Nachbarn überlappen dann ein wenig,
// und weder Licht noch Sicht rutschen durch die Fuge zwischen zwei Mauern (wie RECT_MARGIN in server/game/sight.js)
const SEAM = 1;

// ---------- Schattenformen für eine Punktquelle (Licht oder Auge) bei (lx, ly) ----------
// ray(x, y) verlängert einen Punkt von der Quelle weg ins Weite. Ergebnis: Polygon [[x, y], …] oder null.

// Kreis: die beiden Tangentenpunkte von der Quelle aus (oder null, wenn die Quelle im Kreis steht)
function circleEdges(lx, ly, cx, cy, r) {
  const dx = cx - lx, dy = cy - ly, d = Math.hypot(dx, dy);
  if (d <= r + 2) return null;
  const th = Math.atan2(dy, dx), al = Math.asin(r / d), t = Math.sqrt(d * d - r * r);
  return [[lx + Math.cos(th - al) * t, ly + Math.sin(th - al) * t], [lx + Math.cos(th + al) * t, ly + Math.sin(th + al) * t]];
}

// Rechteck: Silhouette = die beiden Ecken mit kleinstem/größtem Winkel (relativ zur Richtung zur Mitte)
function rectEdges(lx, ly, sx, sy, hw, hh) {
  if (Math.abs(sx - lx) < hw && Math.abs(sy - ly) < hh) return null; // Quelle steht im Hindernis
  const base = Math.atan2(sy - ly, sx - lx);
  let lo = null, hi = null, loA = Infinity, hiA = -Infinity;
  for (const [cx, cy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
    const px = sx + cx, py = sy + cy;
    let a = Math.atan2(py - ly, px - lx) - base;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    if (a < loA) { loA = a; lo = [px, py]; }
    if (a > hiA) { hiA = a; hi = [px, py]; }
  }
  return [lo, hi];
}

const edgesToShadow = (edges, ray) => (edges ? [edges[0], ray(...edges[0]), ray(...edges[1]), edges[1]] : null);
const circleShadow = (lx, ly, cx, cy, r, ray) => edgesToShadow(circleEdges(lx, ly, cx, cy, r), ray);
const rectShadow = (lx, ly, sx, sy, hw, hh, ray) => edgesToShadow(rectEdges(lx, ly, sx, sy, hw, hh), ray);

// Polygon als Teilpfad anhängen (ohne zu füllen). Alle Teilpfade laufen gleich herum – so ergeben sich
// überlappende Formen beim gemeinsamen Füllen (Regel "nonzero") keine Löcher.
function addPolygon(g, points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i], [bx, by] = points[(i + 1) % points.length];
    area += ax * by - bx * ay;
  }
  const ordered = area >= 0 ? points : [...points].reverse();
  ordered.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
  g.closePath();
}

// Schattenkeil hinter einem Hindernis: von den Randpunkten a und b (vom Auge aus gesehen) ins Weite.
// Der Rand außen folgt den Tangenten an einen Kreis mit Radius far, damit auch sehr breite Keile
// (Hindernis direkt vor einem) bis zum Bildrand reichen.
function shadowWedge(ex, ey, a, b, far) {
  const aa = Math.atan2(a[1] - ey, a[0] - ex);
  let span = Math.atan2(b[1] - ey, b[0] - ex) - aa;
  span = Math.atan2(Math.sin(span), Math.cos(span));
  const mid = aa + span / 2, reach = far / Math.max(0.05, Math.cos(span / 2));
  return [
    a, [ex + Math.cos(aa) * far, ey + Math.sin(aa) * far],
    [ex + Math.cos(mid) * reach, ey + Math.sin(mid) * reach],
    [ex + Math.cos(aa + span) * far, ey + Math.sin(aa + span) * far], b,
  ];
}

// ---------- Sonne ----------

// Sonnenstand aus der Tageszeit: morgens lange Schatten nach Westen, mittags kurz nach Norden,
// abends lang nach Osten. Nachts keine Sonne.
function sunState() {
  const [, night, p] = clock;
  if (night) return null;
  const fade = Math.min(1, p / 0.05) * Math.min(1, (1 - p) / 0.1);
  if (fade <= 0.01) return null;
  const a = Math.PI + p * Math.PI;
  const len = Math.min(1.8, 0.5 / (Math.sin(Math.PI * p) + 0.25));
  return { dx: Math.cos(a) * len, dy: Math.sin(a) * len, alpha: 0.3 * fade };
}

// Konvexe Hülle (Monotone Chain) für den Schatten eines Quaders
function convexHull(points) {
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Alle Sonnenschatten halbtransparent in einem einzigen Pfad auf den Boden –
// so werden sich überlappende Schatten nicht doppelt dunkel.
export function drawSunShadows({ x0, y0, x1, y1 }) {
  const sun = sunState();
  if (!sun) return;
  const g = ctx;
  g.fillStyle = `rgba(0,0,0,${sun.alpha})`;
  const m = 160; // Schatten von knapp außerhalb liegenden Objekten ragen ins Bild
  const near = (x, y, r) => x > x0 - m - r && x < x1 + m + r && y > y0 - m - r && y < y1 + m + r;
  // Alle Schatten kommen in einen einzigen Pfad und werden am Ende auf einmal gefüllt –
  // viel billiger für die Grafikkarte als hunderte einzelne Füllungen (z. B. Ruinen in Städten)
  g.beginPath();
  const sunAngle = Math.atan2(sun.dy, sun.dx), half = Math.PI / 2;

  // Rundes Objekt: Kreis entlang des Sonnenvektors gezogen (Kapsel aus zwei Halbkreisen)
  const capsule = (x, y, r, height) => {
    const ex = x + sun.dx * height, ey = y + sun.dy * height;
    g.moveTo(ex + Math.cos(sunAngle - half) * r, ey + Math.sin(sunAngle - half) * r);
    g.arc(ex, ey, r, sunAngle - half, sunAngle + half);
    g.arc(x, y, r, sunAngle + half, sunAngle + 3 * half);
    g.closePath();
  };
  // Quader: Hülle aus Grundfläche und um den Sonnenvektor verschobener Grundfläche
  const box = (x, y, hw, hh, height) => {
    const ox = sun.dx * height, oy = sun.dy * height, pts = [];
    for (const [cx, cy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) pts.push([x + cx, y + cy], [x + cx + ox, y + cy + oy]);
    addPolygon(g, convexHull(pts));
  };

  for (const r of resourcesIn(x0 - m, y0 - m, x1 + m, y1 + m)) {
    const rr = r.r * resScale(r);
    capsule(r.x, r.y, rr * 0.88, rr * RES_HEIGHT[r.type]);
  }
  for (const s of structs.values()) {
    if (!near(s.x, s.y, 60)) continue;
    const { hw, hh } = structBox(s);
    box(s.x, s.y, hw, hh, STRUCT_HEIGHT[s.type] || 30);
  }
  for (const { x, y } of ruinsIn(x0 - m, y0 - m, x1 + m, y1 + m)) box(x, y, cfg.TILE / 2, cfg.TILE / 2, RUIN_HEIGHT);
  for (const z of zombies.values()) {
    if (!near(z.dx, z.dy, 40)) continue;
    const r = cfg.ENEMIES[z.type].r;
    capsule(z.dx, z.dy, r * 0.85, r * 1.1);
  }
  const pr = cfg.PLAYER.radius;
  for (const p of players.values()) if (near(p.dx, p.dy, 40)) capsule(p.dx, p.dy, pr * 0.85, 32);
  g.fill();
}

// ---------- Nacht ----------

// Wie dunkel es ist (0 = Tag): Dämmerung am Ende des Tages, volle Nacht, Morgengrauen
function darkness() {
  const [, night, p] = clock;
  if (!night) return p > 0.9 ? ((p - 0.9) / 0.1) * 0.35 : 0;
  let d = 0.35 + 0.35 * Math.min(1, p / 0.1);
  if (p > 0.9) d *= (1 - p) / 0.1;
  return d;
}

// Schattenpolygone (Weltkoordinaten), die Hindernisse für eine Punktlichtquelle (lx, ly, Radius R) werfen.
// Fenster lassen Licht durch, die Quelle selbst wirft keinen Schatten.
function lightShadows(lx, ly, R, source) {
  const out = [], far = R * 3;
  const ray = (x, y) => {
    const a = Math.atan2(y - ly, x - lx);
    return [lx + Math.cos(a) * far, ly + Math.sin(a) * far];
  };
  const add = (shape) => { if (shape) out.push(shape); };
  for (const r of resourcesIn(lx - R, ly - R, lx + R, ly + R)) {
    const rr = r.r * resScale(r) * 0.9;
    if (Math.hypot(r.x - lx, r.y - ly) <= R + rr) add(circleShadow(lx, ly, r.x, r.y, rr, ray));
  }
  const rect = (sx, sy, hw, hh) => {
    if (Math.abs(sx - lx) <= R + hw && Math.abs(sy - ly) <= R + hh) add(rectShadow(lx, ly, sx, sy, hw, hh, ray));
  };
  for (const s of structs.values()) {
    if (s === source || cfg.STRUCTURES[s.type].shootThrough) continue;
    const { hw, hh } = structBox(s);
    rect(s.x, s.y, hw + SEAM, hh + SEAM);
  }
  for (const { x, y } of ruinsIn(lx - R - 30, ly - R - 30, lx + R + 30, ly + R + 30)) rect(x, y, cfg.TILE / 2 + SEAM, cfg.TILE / 2 + SEAM);
  return out;
}

// Dunkelheit über das Bild legen; jede Lichtquelle wird einzeln gerendert
// (Lichtkegel minus Schatten der Hindernisse) und aus der Dunkelheit herausgeschnitten.
export function drawLighting() {
  const dark = darkness();
  if (dark < 0.01 || !darkCanvas.width || !darkCanvas.height) return;
  darkCtx.setTransform(1, 0, 0, 1, 0, 0);
  darkCtx.globalCompositeOperation = 'source-over';
  darkCtx.clearRect(0, 0, darkCanvas.width, darkCanvas.height);
  darkCtx.fillStyle = `rgba(6,10,32,${dark})`;
  darkCtx.fillRect(0, 0, darkCanvas.width, darkCanvas.height);
  darkCtx.globalCompositeOperation = 'destination-out';

  // Spieler leuchten etwas, mit Fackel in der Hand weit
  for (const p of players.values()) cutLight(p.dx, p.dy, p.look && p.look[0] === 'torch' ? cfg.EQUIPMENT.torch.light : 260, null);
  for (const s of structs.values()) {
    if (s.type === 'core') cutLight(s.x, s.y, 240 + s.level * 30, s);
    else if (s.type === 'turret') cutLight(s.x, s.y, 110, s);
    else if (s.type === 'forge') cutLight(s.x, s.y, 140, s);
    else if (s.type === 'furnace' && s.active) cutLight(s.x, s.y, 170, s);
    else if (s.type === 'campfire' && s.active) cutLight(s.x, s.y, 250 + Math.sin(performance.now() / 90) * 8, s);
  }
  drawLayer(darkCanvas, 1);
}

function cutLight(wx, wy, radius, source) {
  // Alles in Pixeln der (kleineren) Dunkelheits-Ebene
  const k = darkCanvas.width / ctx.canvas.width; // Ebenen-Pixel pro Bildschirm-Pixel
  const p = worldToScreen(wx, wy), s = scale * dpr * k, r = Math.ceil(radius * s);
  const x = p.x * dpr * k, y = p.y * dpr * k;
  if (x < -r || y < -r || x > darkCanvas.width + r || y > darkCanvas.height + r) return; // außerhalb des Bildes
  if (lightCanvas.width < r * 2 || lightCanvas.height < r * 2) lightCanvas.width = lightCanvas.height = r * 2;
  const g = lightCtx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, r * 2, r * 2);
  const glow = g.createRadialGradient(r, r, 0, r, r, r);
  glow.addColorStop(0, 'rgba(0,0,0,1)');
  glow.addColorStop(0.5, 'rgba(0,0,0,0.75)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, r * 2, r * 2);
  // Schatten aus dem Lichtkegel herausschneiden
  g.globalCompositeOperation = 'destination-out';
  g.setTransform(s, 0, 0, s, r - wx * s, r - wy * s);
  g.fillStyle = '#000';
  g.beginPath();
  for (const shape of lightShadows(wx, wy, radius, source)) addPolygon(g, shape);
  g.fill();
  darkCtx.drawImage(lightCanvas, 0, 0, r * 2, r * 2, x - r, y - r, r * 2, r * 2);
}

// ---------- Sichtschatten ----------

// Ob ein Hindernis selbst hell (sichtbar) oder dunkel (hinter einem anderen) ist, wechselt nicht hart,
// sondern gleitet in FADE_TIME Sekunden – sonst flackern Mauern & Ruinen beim Laufen an der Grenze.
const FADE_TIME = 0.35;
const SIGHT_ALPHA = 0.42; // so dunkel ist der Boden hinter Deckung
const bodyLight = new Map(); // "x|y" -> { v: Helligkeit 0..1, frame }
let fadeFrame = 0, lastFadeT = 0;
let dimmed = null; // Hindernisse, die selbst (teilweise) im Schatten liegen: Map Helligkeit -> [Hindernis]

// Bäume, Felsen, Kisten, Mauern und Ruinen verdecken die Sicht. Der Boden dahinter wird abgedunkelt –
// dort schickt der Server auch keine fremden Spieler und Gegner (gleiche Formen wie server/game/sight.js).
// Reihenfolge in main.js: erst alles, was die Sicht nicht verdeckt, dann diese Schatten, dann die
// Hindernisse selbst (die so hell bleiben) und zuletzt dimHiddenObstacles() für verdeckte Hindernisse.
export function drawSightShadows({ x0, y0, x1, y1 }) {
  dimmed = null;
  const self = players.get(myId);
  if (!self || me.dead) return;
  const ex = self.dx, ey = self.dy;
  const far = Math.hypot(x1 - x0, y1 - y0); // weiter als jede Bildecke vom Auge entfernt

  // Hindernisse: round = Kreis mit Radius r, sonst Rechteck mit halber Breite hw / Höhe hh
  // (r = kürzere halbe Kante). outer = äußerster Punkt. Gebäude so groß, wie sie gezeichnet werden.
  // dim = abdunkeln, wenn es selbst verdeckt ist (bei Kreisen: Radius wie gezeichnet; Bäume nicht, die Krone liegt eh darüber)
  const occluders = [];
  const add = (x, y, hw, hh, round, dim) => {
    const outer = round ? hw : Math.hypot(hw, hh);
    occluders.push({ x, y, hw, hh, r: Math.min(hw, hh), round, outer, dim, d: Math.hypot(x - ex, y - ey), angle: Math.atan2(y - ey, x - ex) });
  };
  for (const r of resourcesIn(x0, y0, x1, y1)) {
    const k = cfg.RESOURCES[r.type].sight, full = r.r * resScale(r), rr = full * k;
    if (k) add(r.x, r.y, rr, rr, true, TREE_TYPES.has(r.type) ? 0 : full);
  }
  for (const s of structs.values()) {
    if (!cfg.STRUCTURES[s.type].blocksSight) continue;
    const { hw, hh } = structBox(s);
    add(s.x, s.y, hw + SEAM, hh + SEAM, false, 1);
  }
  for (const { x, y } of ruinsIn(x0 - 30, y0 - 30, x1 + 30, y1 + 30)) add(x, y, cfg.TILE / 2 + SEAM, cfg.TILE / 2 + SEAM, false, 1);
  if (!occluders.length) return;

  // Von nah nach fern. Liegt ein Hindernis komplett im Schatten eines näheren, braucht es keinen eigenen
  // Schatten (und bleibt selbst dunkel) – im Wald fällt so ein Großteil der Keile weg.
  occluders.sort((a, b) => a.d - b.d);
  const casters = [], shown = new Set();
  const inShadow = (o) => {
    if (o.d <= o.outer) return false;
    const halfWidth = Math.asin(o.outer / o.d), nearest = o.d - o.outer;
    return casters.some((c) => {
      if (nearest < c.farthest) return false;
      const diff = Math.abs(Math.atan2(Math.sin(o.angle - c.angle), Math.cos(o.angle - c.angle)));
      return diff + halfWidth <= c.halfWidth;
    });
  };

  ctx.fillStyle = `rgba(0,0,0,${SIGHT_ALPHA})`;
  ctx.beginPath();
  for (const o of occluders) {
    if (inShadow(o)) continue;
    shown.add(o);
    const edge = o.round ? circleEdges(ex, ey, o.x, o.y, o.r) : rectEdges(ex, ey, o.x, o.y, o.hw, o.hh);
    if (!edge) continue; // man steht darin
    addPolygon(ctx, shadowWedge(ex, ey, edge[0], edge[1], far));
    // Was sicher dahinter liegt: der Kegel des inneren Kreises (bei Rechtecken die kürzere halbe Kante)
    if (o.d > o.r) casters.push({ angle: o.angle, halfWidth: Math.asin(o.r / o.d), farthest: o.d + o.outer });
  }
  ctx.fill();

  // Helligkeit der Hindernisse selbst nachführen (weich überblendet); dunkel werden sie erst in dimHiddenObstacles()
  const t = performance.now(), step = Math.min(1, (t - lastFadeT) / 1000 / FADE_TIME);
  lastFadeT = t;
  fadeFrame++;
  dimmed = new Map();
  for (const o of occluders) {
    const key = o.x + '|' + o.y, target = shown.has(o) ? 1 : 0;
    let state = bodyLight.get(key);
    if (!state) bodyLight.set(key, (state = { v: target })); // neu im Bild: sofort richtig, kein Einblenden
    state.v += Math.max(-step, Math.min(step, target - state.v));
    state.frame = fadeFrame;
    const level = Math.round(state.v * 8) / 8;
    if (level >= 1 || !o.dim) continue;
    if (!dimmed.has(level)) dimmed.set(level, []);
    dimmed.get(level).push(o);
  }
  if (fadeFrame % 120 === 0) for (const [key, state] of bodyLight) if (state.frame !== fadeFrame) bodyLight.delete(key);
}

// Hindernisse, die hinter anderen liegen, so dunkel wie den Boden dort – gleiche Helligkeit = eine Füllung
export function dimHiddenObstacles() {
  if (!dimmed) return;
  for (const [level, list] of dimmed) {
    ctx.fillStyle = `rgba(0,0,0,${SIGHT_ALPHA * (1 - level)})`;
    ctx.beginPath();
    for (const o of list) {
      if (o.round) {
        ctx.moveTo(o.x + o.dim, o.y);
        ctx.arc(o.x, o.y, o.dim, 0, Math.PI * 2);
      } else ctx.rect(o.x - o.hw + SEAM, o.y - o.hh + SEAM, (o.hw - SEAM) * 2, (o.hh - SEAM) * 2);
    }
    ctx.fill();
  }
  dimmed = null;
}
