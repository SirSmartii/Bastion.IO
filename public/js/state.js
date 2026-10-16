// Gemeinsamer Zustand des Clients.
//
// Werte, die neu zugewiesen werden, sind als `let` exportiert: andere Module sehen über den Import
// immer den aktuellen Wert, ändern ihn aber nur über die set…-Funktionen hier.
// Objekte und Maps (ui, mouse, players …) werden direkt verändert.

export const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d');

// ---------- Sitzung (kommt mit der init-Nachricht) ----------

export let cfg = null; // Spiel-Config vom Server
export let myId = 0;
export let account = null; // Name des eingeloggten Accounts (Gast: null)

export function setSession(config, id, accountName) {
  cfg = config;
  myId = id;
  account = accountName;
}

// ---------- Eigener Zustand ----------

// me: Position, Leben, Inventar, Werte, Basis … (zusammengesetzt aus me + ms der Server-Nachricht)
export let me = null;
export function setMe(value) { me = value; }

// ---------- Weitere Daten aus den Server-Nachrichten ----------

export let clock = [1, 0, 0]; // [Tag, Nacht?, Fortschritt 0..1]
export let leaderboard = [];
export let online = 0;
export let projectiles = [];
export let minimap = { e: [], p: [] }; // Gegner [x, y, feindlich, …] und fremde Spieler [x, y, …] in Welt/10

export function setClock(value) { clock = value; }
export function setLeaderboard(list, count) { leaderboard = list; online = count; }
export function setProjectiles(list) { projectiles = list; }
export function setMinimap(value) { minimap = value; }

// Sichtbare Objekte, nach ID. Jedes hat x/y (Server) und dx/dy (weich nachgeführt fürs Zeichnen).
export const players = new Map();
export const zombies = new Map();
export const structs = new Map();
export const groundItems = new Map();

// ---------- Bildschirm & Kamera ----------

export let W = 0, H = 0; // Fenstergröße in CSS-Pixeln
export let dpr = 1; // Geräte-Pixel pro CSS-Pixel
export let scale = 1; // Welteinheiten → CSS-Pixel
export const cam = { x: 0, y: 0 };

export function setScreen(width, height, pixelRatio, worldScale) {
  W = width;
  H = height;
  dpr = pixelRatio;
  scale = worldScale;
}

export const screenToWorld = (sx, sy) => ({ x: cam.x + (sx - W / 2) / scale, y: cam.y + (sy - H / 2) / scale });
export const worldToScreen = (wx, wy) => ({ x: (wx - cam.x) * scale + W / 2, y: (wy - cam.y) * scale + H / 2 });

// ---------- Zeit ----------

export let now = 0; // Sekunden seit Seitenstart (für Animationen)
export function setNow(t) { now = t; }

// ---------- Eingabe & Oberfläche ----------

export const keys = new Set();
export const mouse = { x: 0, y: 0, down: false };

export let myAngle = 0; // Blickrichtung der eigenen Figur
export function setMyAngle(a) { myAngle = a; }

export let hovered = null; // Gebäude unter der Maus
export function setHovered(s) { hovered = s; }

// Fenster: `panel` ist höchstens eines der großen Fenster; Inventar und Charakter können zusammen offen sein.
export const ui = {
  panel: null, // null | 'forge' | 'build' | 'skills' | 'team' | 'map'
  inv: false,
  char: false,
  drag: null, // { slot, half, c } (c: 0 Inventar, 1 Truhe) oder { eq } (Ausrüstungs-Slot)
  selected: 0, // 0 = Waffe benutzen, 1 = Gebäude platzieren
  buildType: null, // zu platzierendes Gebäude
  buildRot: 0, // Drehung des zu platzierenden Gebäudes (0–3, [R])
  buildCat: 'base', // gewählter Reiter im Baumenü
  forgeTab: 'axes', // gewählter Reiter in der Schmiede
  upgSel: null, // im Reiter "Verbessern" gewähltes Teil { src: 'inv' | 'eq', i }
  upgWard: false, // Schutzsiegel beim Verbessern benutzen
  pendingTooltip: null, // wird nach allen Fenstern gezeichnet, damit nichts sie verdeckt
};
