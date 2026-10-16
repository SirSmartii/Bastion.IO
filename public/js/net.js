// Verbindung zum Server: Nachrichten senden, empfangen und den Spielzustand übernehmen.
// Das Nachrichtenformat ist in server/game/network.js beschrieben.

import {
  cfg, myId, me, account, now, cam, ui, players, zombies, structs, groundItems,
  setSession, setMe, setClock, setLeaderboard, setProjectiles, setMinimap,
} from './state.js';
import { RES_ICON, RESOURCE_COLORS } from './constants.js';
import { setupWorld, setResources, applyResourceUpdate, resById } from './world.js';
import { burst, floatText, damageNumber, toast, flashes, clearEffects } from './effects.js';
import { addChatMessage, clearChat } from './chat.js';
import { showMenu, hideMenu, showMenuMessage } from './menu.js';
import { dragStack } from './ui/inventory.js';
import { resize } from './main.js';
import { netMessage, setServerStats } from './perf.js';
import { onServerTick, addSample, resetInterpolation } from './interp.js';
import { reconcile, resetPrediction } from './predict.js';

let ws = null;
let loggingOut = false;
let slowState = {}; // zuletzt empfangener "seltener" Teil des eigenen Zustands (ms)

export function send(o) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
}

// Login, Registrierung oder Gast – über eine offene Verbindung vom letzten Versuch oder eine neue
export function sendAuth(msg) {
  if (ws && ws.readyState === 1 && !me) send(msg);
  else connect(msg);
}

export function logout() {
  loggingOut = true;
  if (ws) ws.close(); // der Server speichert beim Trennen
}

function connect(firstMessage) {
  if (ws) ws.close();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = ws = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onopen = () => send(firstMessage);
  socket.onmessage = (e) => {
    const t0 = performance.now(), m = JSON.parse(e.data);
    if (m.t === 's') netMessage(e.data.length, performance.now() - t0);
    onMessage(m);
  };
  socket.onclose = () => {
    if (socket !== ws) return; // alte Verbindung eines früheren Versuchs
    const wasPlaying = !!me;
    ws = null;
    resetGame();
    showMenu();
    if (loggingOut) showMenuMessage(account ? 'Ausgeloggt – dein Spielstand ist gespeichert.' : 'Ausgeloggt.', !!account);
    else showMenuMessage(wasPlaying ? 'Verbindung getrennt.' : 'Server nicht erreichbar.');
    loggingOut = false;
  };
}

// Alles vom letzten Spiel vergessen
function resetGame() {
  setMe(null);
  slowState = {};
  Object.assign(ui, { panel: null, inv: false, char: false, drag: null, selected: 0, buildType: null, pendingTooltip: null });
  players.clear();
  zombies.clear();
  structs.clear();
  groundItems.clear();
  clearChat();
  clearEffects();
  resetInterpolation();
  resetPrediction();
}

function onMessage(m) {
  switch (m.t) {
    case 'auth': showMenuMessage(m.err); break; // Login-Fehler
    case 'init':
      setSession(m.cfg, m.id, m.acc);
      setResources(m.res);
      setupWorld(m.world);
      resize();
      hideMenu();
      break;
    case 'm': toast(m.text); break;
    case 'c': addChatMessage(m); break;
    case 's': applyState(m); break;
  }
}

// ---------- Spielzustand ----------

function applyState(m) {
  const firstState = !me;
  if (m.ms) slowState = m.ms;
  setMe({ ...slowState, ...m.me });
  reconcile();
  setClock(m.tm);
  setProjectiles(m.pr);
  if (m.lb) setLeaderboard(m.lb, m.on);
  if (m.sv) setServerStats(m.sv);
  if (m.mm) setMinimap(m.mm);
  if (m.ru) applyResourceUpdate(m.ru);

  syncAll(players, m.pl, (a) => ({ id: a[0], x: a[1], y: a[2], angle: a[3], hp: a[4], maxHp: a[5], name: a[6], swings: a[7], look: a[8], sprint: a[9], prot: a[10], team: a[11] }));
  syncDelta(zombies, m.zs, m.zx, (a) => ({ id: a[0], type: a[1], x: a[2], y: a[3], angle: a[4], hp: a[5], maxHp: a[6], swings: a[7], aggro: a[8], burning: a[9], alpha: a[10], hunger: a[11], r: a[12] }));
  syncDelta(structs, m.ss, m.sx, (a) => ({ id: a[0], type: a[1], x: a[2], y: a[3], level: a[4], hp: a[5], maxHp: a[6], owner: a[7], angle: a[8], active: a[9], rot: a[10] || 0 }));
  syncDelta(groundItems, m.it, m.ix, (a) => ({ id: a[0], item: a[1], n: a[2], x: a[3], y: a[4], r: a[5] || 0 }));

  // Stützpunkte zum zeitgenauen Abspielen der Bewegung (interp.js)
  const serverT = onServerTick(m.n, cfg.TICK_RATE);
  for (const a of m.pl) addSample(players.get(a[0]), serverT);
  for (const a of m.zs || []) addSample(zombies.get(a[0]), serverT);

  if (firstState) { cam.x = me.x; cam.y = me.y; }
  // Gezogenes Item gibt es nicht mehr (z. B. benutzt oder Truhe geschlossen)
  if (ui.drag && ui.drag.slot !== undefined && !dragStack()) ui.drag = null;
  for (const e of m.ev) handleEvent(e);
}

// Eintrag anlegen oder aktualisieren. Neue bekommen Anzeige-Positionen (dx/dy/da) für das weiche Nachführen;
// ein geänderter Schlag-Zähler startet die Angriffsanimation.
function upsert(map, data) {
  const existing = map.get(data.id);
  if (!existing) {
    data.dx = data.x; data.dy = data.y; data.da = data.angle || 0; data.swingT = -9;
    map.set(data.id, data);
    return;
  }
  const previousSwings = existing.swings;
  Object.assign(existing, data);
  if (data.swings !== undefined && data.swings !== previousSwings) existing.swingT = now;
}

// Vollständige Liste: was fehlt, ist weg
function syncAll(map, list, parse) {
  const seen = new Set();
  for (const a of list) {
    const data = parse(a);
    seen.add(data.id);
    upsert(map, data);
  }
  for (const id of map.keys()) if (!seen.has(id)) map.delete(id);
}

// Delta: nur Geänderte plus Liste der entfernten IDs
function syncDelta(map, changed = [], removed = [], parse) {
  for (const a of changed) upsert(map, parse(a));
  for (const id of removed) map.delete(id);
}

// Ereignisse [x, y, Art, …] → Partikel, Zahlen, Texte
function handleEvent(e) {
  const [x, y, kind] = e;
  switch (kind) {
    case 'g': { // Abbau-Treffer [.., Menge, Ressourcen-ID, Item, Spieler]
      const r = resById.get(e[4]);
      if (r) { r.shake = now; r.hitT = now; }
      // Kisten geben pro Schlag nichts – nur Splitter; die Beute fällt beim Aufbrechen
      if (e[5] === 'crate') burst(x, y, (r && RESOURCE_COLORS[r.type]) || '#a8743f', 6, 110);
      else if (e[6] === myId && e[3] > 0) floatText(x, y - (r ? r.r : 30), `+${e[3]} ${RES_ICON[e[5]]}`, '#ffffff');
      break;
    }
    case 'hit': burst(x, y + 20, '#9b2f2f', 5, 120); damageNumber(x, y, e[3], '#ff4a3d'); break;
    case 'hurt': burst(x, y + 20, '#d22c2c', 6, 140); damageNumber(x, y, e[3], e[4] === myId ? '#b3001b' : '#ff4a3d'); break;
    case 'die': burst(x, y, '#3f5f2b', 16, 180); break;
    case 'lvl':
      burst(x, y, '#ffd76a', 30, 260);
      burst(x, y, '#fff3b8', 14, 160);
      floatText(x, y - 60, `Level ${e[3]}!`, '#ffd76a', { big: true, life: 1.8 });
      break;
    case 'boom': burst(x, y, '#7a6650', 22, 220); break;
    case 'burn': burst(x, y, '#5a5a5a', 18, 120); burst(x, y, '#ff8a3a', 8, 160); break; // im Morgenlicht zerfallen
    case 'fix': burst(x, y, '#7fd36a', 6, 90); break;
    case 'up': burst(x, y, '#ffd84a', 18, 200); floatText(x, y - 30, 'Upgrade!', '#ffd84a'); break;
    case 'mine': if (e[4] === myId) floatText(x, y - 20, `+${e[3]} 🪙`, '#ffd84a'); break;
    case 'pick': if (e[5] === myId) floatText(x, y - 20, `+${e[3]} ${RES_ICON[e[4]]}`, '#9fe870'); break;
    case 'bonus':
      if (e[5] === myId) floatText(x, y - 50, `Abbau-Bonus! ${Object.entries(e[4]).map(([item, n]) => `+${n} ${RES_ICON[item]}`).join(' ')}`, '#ffd76a');
      break;
    case 'shot': flashes.push({ x, y, a: e[3], t: now }); burst(x, y, '#ffd25a', 5, 160); break;
    case 'deplete':
      burst(x, y, RESOURCE_COLORS[e[4]], 26, 260);
      burst(x, y, '#6b4a2a', 10, 160);
      break;
    case 'eat': { // [.., Heilung, Spieler, Item]
      burst(x, y, '#7fd36a', 8, 90);
      if (e[4] !== myId) break;
      const def = cfg.ITEMS.food[e[5]] || {}, parts = [];
      if (def.food) parts.push(`+${def.food} 🍖`);
      if (def.water) parts.push(`+${def.water} 💧`);
      if (def.hp) parts.push(`${def.hp > 0 ? '+' : ''}${def.hp} ❤`);
      floatText(x, y - 40, parts.join('  '), def.hp < 0 ? '#ff9a7a' : '#7fd36a');
      break;
    }
    case 'drink':
      burst(x, y, '#5bb8f0', 10, 90);
      if (e[4] === myId) floatText(x, y - 40, `+${e[3]} 💧`, '#7cc8ff');
      break;
  }
}
