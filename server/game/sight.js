'use strict';
// Sichtlinien: Bäume, Felsen, Kisten, Mauern und Ruinen verdecken, was dahinter steht.
//
// Ein Sichtstrahl läuft Zelle für Zelle durch das statische Raster (wie ein Strahl durch ein
// Kachelfeld) und prüft nur die Objekte in den Zellen, die er wirklich durchquert.
// Verdeckende Formen:
//   - Ressourcen: Kreis mit Radius r × RESOURCES[type].sight (schrumpft beim Abbauen mit)
//   - Ruinen und Gebäude mit blocksSight: ihr Rechteck
// Steht der Betrachter selbst in einem Hindernis (z. B. in einer Baumkrone), blendet ihn das nicht.
// Rechtecke zählen RECT_MARGIN größer, damit zwischen zwei aneinanderstoßenden Mauern (oder an Ecken,
// die sich nur berühren) kein Strahl durch die Fuge rutscht.

const C = require('../config');

const RECT_MARGIN = 1;

// Radius, mit dem eine Ressource die Sicht blockiert (0 = durchsichtig)
function resourceSightRadius(o) {
  return o.r * (C.RESOURCES[o.type].sight || 0);
}

// overBuildings: Türme stehen erhöht und schauen über Gebäude hinweg. solidOnly: nur Mauern & Ruinen zählen
function blocksSight(o, overBuildings, solidOnly) {
  if (o.kind === 'res') return !solidOnly && C.RESOURCES[o.type].sight > 0;
  if (o.kind === 'ruin') return true;
  return o.kind === 's' && !overBuildings && !!C.STRUCTURES[o.type].blocksSight;
}

// Schneidet die Strecke (x0,y0)→(x0+dx, y0+dy) den Kreis (cx, cy, r)? Startpunkt im Kreis zählt nicht.
function segmentHitsCircle(x0, y0, dx, dy, cx, cy, r) {
  const fx = cx - x0, fy = cy - y0, r2 = r * r;
  if (fx * fx + fy * fy <= r2) return false;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (fx * dx + fy * dy) / len2)) : 0;
  const ex = fx - dx * t, ey = fy - dy * t;
  return ex * ex + ey * ey < r2;
}

// Schneidet die Strecke das achsenparallele Rechteck (Mitte cx/cy, halbe Breite hw, halbe Höhe hh)? (Slab-Verfahren)
function segmentHitsRect(x0, y0, dx, dy, cx, cy, hw, hh) {
  if (Math.abs(x0 - cx) <= hw && Math.abs(y0 - cy) <= hh) return false; // Startpunkt im Rechteck
  let tMin = 0, tMax = 1;
  for (const [p, d, c, h] of [[x0, dx, cx, hw], [y0, dy, cy, hh]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < c - h || p > c + h) return false;
      continue;
    }
    let t1 = (c - h - p) / d, t2 = (c + h - p) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return true;
}

module.exports = {
  // Freie Sicht von (x0, y0) nach (x1, y1)? overBuildings: Gebäude verdecken nicht (für Türme),
  // solidOnly: nur Gebäude und Ruinen verdecken (Bäume, Felsen & Büsche nicht)
  lineOfSight(x0, y0, x1, y1, overBuildings = false, solidOnly = false) {
    const grid = this.statics, cell = grid.cell, stamp = ++grid.queryStamp;
    const dx = x1 - x0, dy = y1 - y0;

    // Zellen entlang der Strecke ablaufen (Amanatides & Woo)
    let cx = Math.floor(x0 / cell), cy = Math.floor(y0 / cell);
    const endX = Math.floor(x1 / cell), endY = Math.floor(y1 / cell);
    const stepX = Math.sign(dx), stepY = Math.sign(dy);
    const tDeltaX = stepX ? Math.abs(cell / dx) : Infinity, tDeltaY = stepY ? Math.abs(cell / dy) : Infinity;
    let tMaxX = stepX ? ((stepX > 0 ? (cx + 1) * cell - x0 : x0 - cx * cell) / Math.abs(dx)) : Infinity;
    let tMaxY = stepY ? ((stepY > 0 ? (cy + 1) * cell - y0 : y0 - cy * cell) / Math.abs(dy)) : Infinity;

    for (let steps = 0; steps < 200; steps++) {
      const list = grid.cells.get(grid.key(cx, cy));
      if (list) {
        for (const o of list) {
          if (o.queryStamp === stamp) continue;
          o.queryStamp = stamp;
          if (!blocksSight(o, overBuildings, solidOnly)) continue;
          const hit = o.kind === 'res'
            ? segmentHitsCircle(x0, y0, dx, dy, o.x, o.y, resourceSightRadius(o))
            : segmentHitsRect(x0, y0, dx, dy, o.x, o.y, o.hw + RECT_MARGIN, o.hh + RECT_MARGIN);
          if (hit) return false;
        }
      }
      // Endzelle erreicht oder die nächste Zellgrenze liegt hinter dem Ziel
      if ((cx === endX && cy === endY) || Math.min(tMaxX, tMaxY) > 1) return true;
      if (tMaxX < tMaxY) { tMaxX += tDeltaX; cx += stepX; } else { tMaxY += tDeltaY; cy += stepY; }
    }
    return true;
  },

  // Sieht (x, y) den Körper e? Geprüft werden die Mitte und die beiden Seiten (quer zur Blickrichtung),
  // damit jemand, der halb hinter einem Baum hervorschaut, nicht unsichtbar ist.
  // Ganz nah (SIGHT.near) spürt man jeden – auch im selben Busch oder hinter einem Baum –, aber nicht durch Mauern.
  seesBody(x, y, e, overBuildings = false) {
    const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy);
    const close = d < C.SIGHT.near;
    if (d < 1 || this.lineOfSight(x, y, e.x, e.y, overBuildings, close)) return true;
    const side = (e.r || 20) * 0.8, nx = (-dy / d) * side, ny = (dx / d) * side;
    return this.lineOfSight(x, y, e.x + nx, e.y + ny, overBuildings, close) || this.lineOfSight(x, y, e.x - nx, e.y - ny, overBuildings, close);
  },

  // Sieht Spieler p das Wesen e? Ergebnisse gelten SIGHT.recheck Sendungen lang (p.sight: id → [Sendung, sichtbar]).
  // Die Prüfungen sind über die Sendungen verteilt (nach ID), damit nicht alle in derselben anfallen.
  canSee(p, e) {
    const tick = this.sendTick, every = C.SIGHT.recheck;
    const cached = p.sight.get(e.id);
    if (cached && tick - cached[0] < every && (tick + e.id) % every !== 0) return cached[1];
    const visible = this.seesBody(p.x, p.y, e);
    if (cached) { cached[0] = tick; cached[1] = visible; } else p.sight.set(e.id, [tick, visible]);
    return visible;
  },

  // Alte Einträge aus dem Sicht-Zwischenspeicher werfen (Wesen, die längst weg sind)
  pruneSight(p) {
    if (p.sight.size < 400) return;
    for (const [id, entry] of p.sight) if (this.sendTick - entry[0] > 120) p.sight.delete(id);
  },
};

