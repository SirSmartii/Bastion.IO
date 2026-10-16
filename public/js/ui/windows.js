// Welche Fenster offen sind – an einer Stelle statt verstreut in der Tastaturbehandlung.
//
// Inventar und Charakter können zusammen offen sein (nebeneinander).
// Die großen Fenster (Schmiede, Baumenü, Fertigkeiten, Team, Karte) stehen allein: es ist höchstens
// eines offen, und es schließt Inventar und Charakter.
// Eine offene Truhe gehört zum Inventar: schließt das Inventar, schließt auch die Truhe.

import { ui, mouse, me, now } from '../state.js';
import { send } from '../net.js';

let containerCloseT = -9;

function resetPointer() {
  ui.drag = null;
  mouse.down = false;
}

export function closeAllWindows() {
  ui.panel = null;
  ui.inv = ui.char = false;
  resetPointer();
  closeContainer();
}

export function togglePanel(name) {
  const open = ui.panel !== name;
  closeAllWindows();
  if (open) ui.panel = name;
}

export function toggleInventory() {
  ui.inv = !ui.inv;
  ui.panel = null;
  resetPointer();
  if (!ui.inv) closeContainer();
}

export function toggleCharacter() {
  ui.char = !ui.char;
  ui.panel = null;
  resetPointer();
}

export const anyWindowOpen = () => !!(ui.panel || ui.inv || ui.char);

// ---------- Truhe / Kern-Lager ----------

// Öffnen läuft über den Server (er prüft Reichweite & Besitz); bis zur Antwort ist das Inventar schon offen
export function openContainer(s) {
  closeAllWindows();
  send({ t: 'open', id: s.id });
  ui.inv = true;
}

export function closeContainer() {
  if (!me || !me.ch) return;
  containerCloseT = now;
  send({ t: 'close' });
  if (ui.drag && ui.drag.c) ui.drag = null;
}

// Jedes Bild: Truhe offen, aber Inventar zu (z. B. über ein anderes Fenster) → Truhe schließen
export function syncContainer() {
  if (me.ch && !ui.inv && now - containerCloseT > 0.3) closeContainer();
}
