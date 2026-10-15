'use strict';
// Slot-Inventar: Array fester Länge, jeder Slot ist null oder { item, n }.

const C = require('./config');

const stackOf = (item) => (C.EQUIPMENT[item] ? 1 : C.INVENTORY.stack[item] || 100);

function create() {
  return new Array(C.INVENTORY.slots).fill(null);
}

function count(inv, item) {
  let n = 0;
  for (const s of inv) if (s && s.item === item) n += s.n;
  return n;
}

function totals(inv) {
  const t = {};
  for (const item of Object.keys(C.INVENTORY.stack)) t[item] = 0;
  for (const s of inv) if (s) t[s.item] = (t[s.item] || 0) + s.n;
  return t;
}

// Legt n Stück ab (erst auf vorhandene Stapel, dann in freie Slots). Gibt den Rest zurück.
function add(inv, item, n) {
  const max = stackOf(item);
  for (const s of inv) {
    if (!n) return 0;
    if (s && s.item === item && s.n < max) {
      const k = Math.min(n, max - s.n);
      s.n += k;
      n -= k;
    }
  }
  for (let i = 0; i < inv.length && n > 0; i++) {
    if (inv[i]) continue;
    const k = Math.min(n, max);
    inv[i] = { item, n: k };
    n -= k;
  }
  return n;
}

// Entfernt n Stück (von hinten nach vorne). Gibt zurück, wie viel nicht entfernt werden konnte.
function remove(inv, item, n) {
  for (let i = inv.length - 1; i >= 0 && n > 0; i--) {
    const s = inv[i];
    if (!s || s.item !== item) continue;
    const k = Math.min(n, s.n);
    s.n -= k;
    n -= k;
    if (!s.n) inv[i] = null;
  }
  return n;
}

const canAfford = (inv, cost) => Object.entries(cost).every(([k, v]) => count(inv, k) >= v);

function pay(inv, cost) {
  for (const [k, v] of Object.entries(cost)) remove(inv, k, v);
}

// Slot verschieben: gleiche Items werden gestapelt, sonst getauscht
function move(inv, from, to) {
  if (from === to || !inv[from] || to < 0 || to >= inv.length) return;
  const a = inv[from], b = inv[to];
  if (b && b.item === a.item) {
    const k = Math.min(a.n, stackOf(a.item) - b.n);
    b.n += k;
    a.n -= k;
    if (!a.n) inv[from] = null;
  } else {
    inv[from] = b;
    inv[to] = a;
  }
}

// Nimmt bis zu n Stück aus einem Slot (n <= 0 = ganzer Stapel)
function take(inv, slot, n) {
  const s = inv[slot];
  if (!s) return null;
  const k = n > 0 ? Math.min(n, s.n) : s.n;
  s.n -= k;
  if (!s.n) inv[slot] = null;
  return { item: s.item, n: k };
}

module.exports = { create, count, totals, add, remove, canAfford, pay, move, take };
