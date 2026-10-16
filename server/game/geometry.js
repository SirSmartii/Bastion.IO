'use strict';
// Räumliches Raster und Kollisionsprüfungen.
//
// Formen in der Welt:
//   - Kreise: Spieler, Gegner, Ressourcen und Seen (Radius r bzw. Kollisionsradius cr)
//   - Achsenparallele Rechtecke: Gebäude und Ruinen (Mittelpunkt x/y, halbe Breite hw, halbe Höhe hh)

const { clamp } = require('./util');

// Teilt die Welt in Zellen; jedes Objekt wird in alle Zellen eingetragen, die sein
// Begrenzungskreis (br) berührt. Abfragen schauen dann nur in die nahen Zellen.
class Grid {
  constructor(cellSize) {
    this.cell = cellSize;
    this.cells = new Map();
    this.queryStamp = 0; // verhindert, dass ein Objekt aus mehreren Zellen doppelt gemeldet wird
  }

  key(cx, cy) { return (cx + 100) * 10000 + (cy + 100); }

  insert(o) {
    const c = this.cell, r = o.br;
    o.gridKeys = [];
    for (let cx = Math.floor((o.x - r) / c); cx <= Math.floor((o.x + r) / c); cx++) {
      for (let cy = Math.floor((o.y - r) / c); cy <= Math.floor((o.y + r) / c); cy++) {
        const k = this.key(cx, cy);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(o);
        o.gridKeys.push(k);
      }
    }
  }

  remove(o) {
    for (const k of o.gridKeys || []) {
      const list = this.cells.get(k);
      if (!list) continue;
      const i = list.indexOf(o);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) this.cells.delete(k);
    }
    o.gridKeys = [];
  }

  clear() { this.cells.clear(); }

  // Alle Objekte in Zellen, die das Quadrat um (x, y) mit "Radius" r berühren (grob, ohne Abstandsprüfung)
  query(x, y, r) {
    return this.queryRect(x - r, y - r, x + r, y + r);
  }

  queryRect(x0, y0, x1, y1) {
    const out = [], stamp = ++this.queryStamp, c = this.cell;
    for (let cx = Math.floor(x0 / c); cx <= Math.floor(x1 / c); cx++) {
      for (let cy = Math.floor(y0 / c); cy <= Math.floor(y1 / c); cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (const o of list) {
          if (o.queryStamp === stamp) continue;
          o.queryStamp = stamp;
          out.push(o);
        }
      }
    }
    return out;
  }
}

// Kreis e aus einem Rechteck s herausschieben. true, wenn sie sich berührt haben.
function pushOutOfRect(e, s) {
  const nx = clamp(e.x, s.x - s.hw, s.x + s.hw), ny = clamp(e.y, s.y - s.hh, s.y + s.hh);
  const dx = e.x - nx, dy = e.y - ny, d2 = dx * dx + dy * dy;
  if (d2 >= e.r * e.r) return false;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2), push = e.r - d;
    e.x += (dx / d) * push;
    e.y += (dy / d) * push;
  } else {
    // Mittelpunkt steckt im Rechteck: auf dem kürzesten Weg hinaus
    const outX = s.hw + e.r - Math.abs(e.x - s.x), outY = s.hh + e.r - Math.abs(e.y - s.y);
    if (outX < outY) e.x += Math.sign(e.x - s.x || 1) * outX;
    else e.y += Math.sign(e.y - s.y || 1) * outY;
  }
  return true;
}

// Kreis e aus einem Kreis (ox, oy, or) herausschieben
function pushOutOfCircle(e, ox, oy, or) {
  const dx = e.x - ox, dy = e.y - oy, min = e.r + or, d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2) || 0.01;
  e.x += (dx / d) * (min - d);
  e.y += (dy / d) * (min - d);
  return true;
}

function circleHitsRect(x, y, r, s) {
  const nx = clamp(x, s.x - s.hw, s.x + s.hw), ny = clamp(y, s.y - s.hh, s.y + s.hh);
  return (x - nx) ** 2 + (y - ny) ** 2 < r * r;
}

// Überlappt ein Kreis (x, y, r) das statische Objekt o (Kreis mit cr oder Rechteck mit hw/hh)?
function circleHitsStatic(o, x, y, r) {
  return o.cr !== undefined ? Math.hypot(o.x - x, o.y - y) < o.cr + r : circleHitsRect(x, y, r, o);
}

module.exports = { Grid, pushOutOfRect, pushOutOfCircle, circleHitsRect, circleHitsStatic };
