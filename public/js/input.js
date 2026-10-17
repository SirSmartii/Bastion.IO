// Tastatur & Maus: Fenster öffnen, Hotbar, Bauen, Drag & Drop – und die Eingabe für den Server.

import {
  canvas, cfg, me, myId, players, hovered, ui, keys, mouse, now, isAdmin,
  screenToWorld, setMyAngle, myAngle,
} from './state.js';
import { inRect } from './draw/primitives.js';
import { togglePerf, togglePerfOption } from './perf.js';
import { resize } from './main.js';
import { toast } from './effects.js';
import { t } from './i18n.js';
import { send } from './net.js';
import { nextInput } from './predict.js';
import { menuHasFocus } from './menu.js';
import { chatInput, isTyping, openChat, closeChat } from './chat.js';
import { nearForge, nearestContainer, snap, placementError, nearWater } from './rules.js';
import { togglePanel, toggleInventory, toggleCharacter, closeAllWindows, anyWindowOpen, openContainer, closeContainer } from './ui/windows.js';
import { panels } from './ui/panels.js';
import { onOpen as onBuildMenuOpen } from './ui/build.js';
import { hotbarRects, deathButtons } from './ui/hud.js';
import { invSlotAt, chestSlotAt, overItemWindows, dragStack, modeButtons } from './ui/inventory.js';
import { eqSlotAt } from './ui/character.js';

// ---------- Tastatur ----------

// Taste → Aktion (nur ohne Wiederholung beim Gedrückthalten)
const KEY_ACTIONS = {
  Tab: toggleInventory,
  KeyC: toggleCharacter,
  KeyK: () => togglePanel('skills'),
  KeyT: () => togglePanel('team'),
  KeyM: () => togglePanel('map'),
  KeyB: toggleBuildMenu,
  KeyF: interact,
  // [R]: beim Bauen drehen, sonst Munition wechseln
  KeyR: () => {
    if (ui.selected && ui.buildType) ui.buildRot = (ui.buildRot + 1) & 3;
    else if (me.stats.ranged) send({ t: 'ammo' });
  },
  KeyH: () => send({ t: 'eat' }),
  KeyQ: () => { ui.selected = 0; },
  KeyE: () => { if (hovered && hovered.owner === myId) send({ t: 'u', id: hovered.id }); },
  KeyX: demolishHovered,
  KeyG: () => togglePanel('craft'),
  F3: togglePerf,
  F8: () => { if (isAdmin) togglePanel('admin'); },
  // [Esc]: erst offene Fenster schließen, dann den Bau-Modus verlassen, sonst das Menü öffnen
  Escape: () => {
    if (anyWindowOpen()) closeAllWindows();
    else if (ui.selected) ui.selected = 0;
    else togglePanel('esc');
  },
};

addEventListener('keydown', (e) => {
  if (!me || menuHasFocus()) return;
  if (isTyping()) {
    // Während des Tippens gehen keine Tasten ans Spiel
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text) send({ t: 'chat', text });
      closeChat();
    } else if (e.key === 'Escape') closeChat();
    return;
  }
  if (e.code === 'Tab' || e.code === 'F3' || e.code === 'F8') e.preventDefault();
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    e.preventDefault();
    if (!e.repeat) openChat();
    return;
  }
  keys.add(e.code);
  if (e.repeat) return;

  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && +digit[1] <= cfg.HOTBAR_SIZE) return pressHotbarKey(+digit[1] - 1);
  const perfMessage = togglePerfOption(e.code, resize);
  if (perfMessage) return toast(perfMessage);
  if (KEY_ACTIONS[e.code]) KEY_ACTIONS[e.code]();
});

addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouse.down = false; });

function toggleBuildMenu() {
  togglePanel('build');
  if (ui.panel === 'build') onBuildMenuOpen();
}

// [F]: das nähere von Schmiede und Truhe/Kern-Lager öffnen bzw. schließen
function interact() {
  if (ui.panel === 'forge') { ui.panel = null; return; }
  if (me.ch) { closeContainer(); ui.inv = false; return; }
  const container = nearestContainer();
  const forgeDist = nearForge() ? Math.hypot(me.forge[1] - me.x, me.forge[2] - me.y) : Infinity;
  if (container && container.d < forgeDist) openContainer(container.s);
  else if (forgeDist < Infinity) togglePanel('forge');
  else if (nearWater()) send({ t: 'drink' });
  else toast(t(me.forge ? 'Geh näher an deine Schmiede, eine Truhe oder einen See.' : 'Keine Schmiede, Truhe oder See in der Nähe.'));
}

// Kern abreißen nur mit zweitem Druck, weil dabei die ganze Basis verschwindet
let coreDemolishT = -9;
function demolishHovered() {
  if (!hovered || hovered.owner !== myId) return;
  if (hovered.type === 'core' && now - coreDemolishT > 2) {
    coreDemolishT = now;
    toast(t('Nochmal [X]: Kern abreißen zerstört die GANZE Basis!'));
    return;
  }
  send({ t: 'x', id: hovered.id });
}

// Zahl 1–6: mit der Maus über einem Inventar-Item → Item auf diesen Hotbar-Slot legen, sonst Slot benutzen
function pressHotbarKey(i) {
  const slot = invSlotAt(mouse.x, mouse.y);
  if (slot >= 0 && me.inv[slot]) {
    send({ t: 'hb', i, item: me.inv[slot][0] });
    return;
  }
  ui.selected = 0;
  send({ t: 'use', i });
}

// ---------- Maus ----------

canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  if (mouse.down && ui.selected > 0) tryBuild(true); // Ziehen baut Reihen
});

canvas.addEventListener('mousedown', (e) => {
  if (!me) return;
  if (e.button === 2) return rightClick(e.clientX, e.clientY);
  if (e.button === 0) leftClick(e.clientX, e.clientY, e.shiftKey);
});

addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  mouse.down = false;
  if (ui.drag) endDrag(e.clientX, e.clientY);
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Mausrad wechselt zwischen Waffe und zuletzt gewähltem Gebäude
canvas.addEventListener('wheel', () => {
  if (me && ui.buildType && ui.panel !== 'build') ui.selected = ui.selected ? 0 : 1;
}, { passive: true });

function leftClick(x, y, shift) {
  // Tot: Wahl, wo man aufwacht (Schlafsack oder irgendwo)
  if (me.dead && !ui.panel) {
    const b = deathButtons().find((d) => inRect(x, y, d.rect));
    if (b && !b.wait) { ui.spawnChoice = b.id; send({ t: 'spawn', id: b.id }); }
    return;
  }
  // Hotbar: Slot benutzen bzw. Bau-Button
  const hotbarSlot = hotbarRects().findIndex((r) => inRect(x, y, r));
  if (hotbarSlot >= 0 && hotbarSlot < cfg.HOTBAR_SIZE) {
    ui.selected = 0;
    send({ t: 'use', i: hotbarSlot });
    return;
  }
  if (hotbarSlot === cfg.HOTBAR_SIZE) {
    if (ui.buildType && ui.selected !== 1 && ui.panel !== 'build') ui.selected = 1;
    else toggleBuildMenu();
    return;
  }

  if (ui.panel) return panels[ui.panel].onClick(x, y);

  // Bei offenem Inventar/Charakter steuert die Maus nur die Fenster: Ziehen beginnen
  if (ui.inv || ui.char) {
    const mode = ui.inv && me.ch ? modeButtons().find((b) => inRect(x, y, b.rect)) : null;
    if (mode) return send({ t: 'mode', id: me.ch[0], m: mode.id }); // Betriebsart von Ofen & Co.
    const invSlot = invSlotAt(x, y), chestSlot = chestSlotAt(x, y), eqSlot = eqSlotAt(x, y);
    if (invSlot >= 0 && me.inv[invSlot]) ui.drag = { slot: invSlot, half: shift, c: 0 };
    else if (chestSlot >= 0 && me.ch[1][chestSlot]) ui.drag = { slot: chestSlot, half: shift, c: 1 };
    else if (eqSlot && me.eq[eqSlot]) ui.drag = { eq: eqSlot };
    return;
  }

  mouse.down = true;
  lastBuildKey = '';
  if (ui.selected > 0) tryBuild(false);
}

// Rechtsklick: Truhe ↔ Inventar (ganzer Stapel), Essen / Ausrüsten, Ablegen, Hotbar-Slot leeren, Bauen abbrechen
function rightClick(x, y) {
  const chestSlot = chestSlotAt(x, y);
  if (chestSlot >= 0) {
    if (me.ch[1][chestSlot]) send({ t: 'cmv', fc: 1, from: chestSlot, quick: 1 });
    return;
  }
  const invSlot = invSlotAt(x, y), item = invSlot >= 0 && me.inv[invSlot] && me.inv[invSlot][0];
  if (me.ch && item) return send({ t: 'cmv', fc: 0, from: invSlot, quick: 1 });

  const hotbarSlot = hotbarRects().findIndex((r) => inRect(x, y, r));
  if (hotbarSlot >= 0 && hotbarSlot < cfg.HOTBAR_SIZE) return send({ t: 'hb', i: hotbarSlot, item: null });

  const eqSlot = eqSlotAt(x, y);
  if (item && cfg.ITEMS.food[item]) send({ t: 'eat', slot: invSlot });
  else if (item && cfg.EQUIPMENT[item]) send({ t: 'equip', slot: invSlot });
  else if (eqSlot && me.eq[eqSlot]) send({ t: 'unequip', eq: eqSlot });
  else if (!ui.inv && !ui.char) ui.selected = 0;
}

// Loslassen nach dem Ziehen eines Items
function endDrag(sx, sy) {
  const d = ui.drag;
  ui.drag = null;
  if (!me) return;
  const invTarget = invSlotAt(sx, sy), eqTarget = eqSlotAt(sx, sy), chestTarget = chestSlotAt(sx, sy);
  const overWindow = overItemWindows(sx, sy);
  const world = screenToWorld(sx, sy);

  // Ausrüstungsteil: in einen Inventar-Slot ablegen oder aus dem Fenster werfen
  if (d.eq) {
    if (!me.eq[d.eq]) return;
    if (invTarget >= 0) send({ t: 'unequip', eq: d.eq, to: invTarget });
    else if (!overWindow) send({ t: 'unequip', eq: d.eq, drop: true, x: world.x, y: world.y });
    return;
  }

  const stack = dragStack(d);
  if (!stack) return;
  const amount = d.half ? Math.ceil(stack[1] / 2) : 0; // 0 = ganzer Stapel

  // Truhe beteiligt: der Server verschiebt zwischen Inventar (0) und Truhe (1)
  if (chestTarget >= 0 || d.c) {
    const toBox = chestTarget >= 0 ? 1 : invTarget >= 0 ? 0 : -1;
    if (toBox < 0) {
      if (d.c && !overWindow) toast(t('Erst ins Inventar ziehen, dann droppen.'));
      return;
    }
    const to = toBox ? chestTarget : invTarget;
    if (toBox !== d.c || to !== d.slot) send({ t: 'cmv', fc: d.c, from: d.slot, tc: toBox, to, n: amount });
    return;
  }

  // Auf einen Hotbar-Slot: Item dort ablegen (bleibt im Inventar)
  const hotbarTarget = hotbarRects().findIndex((r) => inRect(sx, sy, r));
  if (hotbarTarget >= 0 && hotbarTarget < cfg.HOTBAR_SIZE) return send({ t: 'hb', i: hotbarTarget, item: stack[0] });

  if (invTarget >= 0) {
    if (invTarget !== d.slot) send({ t: 'mv', from: d.slot, to: invTarget });
  } else if (eqTarget) {
    const def = cfg.EQUIPMENT[stack[0]];
    if (def && def.slot === eqTarget) send({ t: 'equip', slot: d.slot });
    else toast(t('Das passt nicht in diesen Slot.'));
  } else if (!overWindow) {
    // Aus dem Fenster gezogen: an der Mausposition in die Welt werfen
    send({ t: 'drop', slot: d.slot, n: amount, x: world.x, y: world.y });
  }
}

// ---------- Bauen ----------

let lastBuildKey = '';
function tryBuild(dragging) {
  const type = ui.buildType;
  if (!type) return;
  const wm = screenToWorld(mouse.x, mouse.y), g = snap(type, wm.x, wm.y, ui.buildRot);
  const key = `${type}:${g.x}:${g.y}:${ui.buildRot}`;
  if (key === lastBuildKey) return;
  // Beim Ziehen nur gültige Plätze senden (z. B. Mauerreihen ziehen)
  if (dragging && placementError(type, g)) return;
  lastBuildKey = key;
  send({ t: 'b', type, x: wm.x, y: wm.y, r: ui.buildRot });
}

// ---------- An den Server ----------

// Tastenbits: 1 hoch, 2 runter, 4 links, 8 rechts, 16 sprinten
const lastSent = { keys: -1, angle: 0, attack: false, t: 0 };

export function sendInput() {
  let k = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) k |= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) k |= 2;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) k |= 4;
  if (keys.has('KeyD') || keys.has('ArrowRight')) k |= 8;
  if ((keys.has('ShiftLeft') || keys.has('ShiftRight')) && !ui.drag) k |= 16;

  const self = players.get(myId), wm = screenToWorld(mouse.x, mouse.y);
  if (self) setMyAngle(Math.atan2(wm.y - self.dy, wm.x - self.dx));
  const attack = mouse.down && ui.selected === 0;
  // Nur senden, wenn sich etwas geändert hat (Blickwinkel höchstens 20×/s)
  const turned = Math.abs(myAngle - lastSent.angle) > 0.03 && now - lastSent.t > 0.05;
  if (k !== lastSent.keys || attack !== lastSent.attack || turned) {
    Object.assign(lastSent, { keys: k, angle: myAngle, attack, t: now });
    send({ t: 'i', k, a: +myAngle.toFixed(3), m: attack, s: nextInput(k) });
  }
}
