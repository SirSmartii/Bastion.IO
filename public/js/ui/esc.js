// Menü [Esc] mit zwei Reitern: Übersicht (eigenes Überleben, Spielerliste, Konto) und Steuerung (alle Tasten,
// nach Themen gruppiert). Unten Weiterspielen & Ausloggen. Das Spiel läuft dabei weiter – es ist ein Mehrspieler-Spiel.

import { ctx, me, myId, account, leaderboard, online, ui, mouse, W, H, isAdmin } from '../state.js';
import { text, inRect, rrect } from '../draw/primitives.js';
import { logout } from '../net.js';
import { woodPanel, parchment, woodButton, CREAM, INK, INK_LIGHT, PARCHMENT, PARCHMENT_DARK, WOOD_DARK } from './theme.js';
import { fmtDuration } from './hud.js';
import { t } from '../i18n.js';

const WIDTH = 520, PAD = 20, ROW = 22, KEY_ROW = 21;

// Auch im Tod offen lassen: Ausloggen soll immer gehen
export const whileDead = true;

const TABS = [{ id: 'overview', name: 'Übersicht' }, { id: 'keys', name: 'Steuerung' }];
const ADMIN_TAB = { id: 'admin', name: '🛠 Admin' }; // nur für Admins: öffnet das Admin-Menü
const tabs = () => (isAdmin ? [...TABS, ADMIN_TAB] : TABS);

// Tastenhilfe: [Gruppe, [[Tasten, Beschreibung], …]] – übersetzt wird beim Zeichnen (Tasten nur, wenn sie Wörter sind)
const CONTROLS = [
  ['Bewegen & Kämpfen', [
    [['W', 'A', 'S', 'D'], 'Bewegen'],
    [['Shift'], 'Sprinten (kostet Ausdauer)'],
    [['Linksklick'], 'Schlagen, schießen, abbauen'],
    [['1–6'], 'Hotbar benutzen'],
    [['R'], 'Munition wechseln'],
    [['Q', 'Rechtsklick'], 'Zurück zur Waffe'],
    [['H'], 'Essen, trinken, verbinden'],
  ]],
  ['Bauen', [
    [['B'], 'Baumenü'],
    [['R'], 'Gebäude drehen'],
    [['Mausrad'], 'Waffe ↔ Gebäude'],
    [['E'], 'Gebäude upgraden'],
    [['X'], 'Gebäude abreißen'],
    [['Schlagen'], 'Eigenes Gebäude reparieren'],
  ]],
  ['Fenster', [
    [['Tab'], 'Inventar'],
    [['C'], 'Charakter & Ausrüstung'],
    [['G'], 'Handwerk & Kochen'],
    [['K'], 'Fertigkeiten'],
    [['T'], 'Team'],
    [['M'], 'Weltkarte'],
  ]],
  ['Sonstiges', [
    [['F'], 'Benutzen · am See trinken / angeln'],
    [['Enter'], 'Chat · /t = Teamchat'],
    [['Esc'], 'Menü & diese Hilfe'],
    [['F3'], 'Leistungsanzeige'],
  ]],
];

// Spielerliste: Bestenliste vom Server (Top 10); wer nicht darin steht, sieht sich selbst darunter
function rows() {
  const list = leaderboard.map(([id, name, score], i) => ({ rank: i + 1, name, score, mine: id === myId }));
  if (!list.some((r) => r.mine)) list.push({ rank: '–', name: t('Du'), score: me.score, mine: true });
  return list;
}

// Höhe des Inhalts je Reiter (zwei Spalten bei der Steuerung)
function contentHeight(tab, list) {
  if (tab === 'overview') return 64 + 30 + list.length * ROW + 18 + 28;
  const col = (groups) => groups.reduce((h, [, keys]) => h + 26 + keys.length * KEY_ROW + 8, 0);
  return Math.max(col(CONTROLS.slice(0, 2)), col(CONTROLS.slice(2))) + 4;
}

export function layout() {
  const tab = TABS.some((tb) => tb.id === ui.escTab) ? ui.escTab : 'overview', list = rows();
  const top = 92, h = top + contentHeight(tab, list) + 56;
  const x = Math.round(W / 2 - WIDTH / 2), y = Math.round(Math.max(20, H / 2 - h / 2));
  const bw = (WIDTH - PAD * 2 - 12) / 2, by = y + h - 50, tw = (WIDTH - PAD * 2 - 8 * (tabs().length - 1)) / tabs().length;
  return {
    panel: { x, y, w: WIDTH, h }, list, tab, top: y + top,
    tabs: tabs().map((tb, i) => ({ ...tb, name: t(tb.name), rect: { x: x + PAD + i * (tw + 8), y: y + 48, w: tw, h: 30 } })),
    resume: { x: x + PAD, y: by, w: bw, h: 34 },
    logout: { x: x + PAD + bw + 12, y: by, w: bw, h: 34 },
  };
}

export function onClick(x, y) {
  const L = layout();
  const tab = L.tabs.find((tb) => inRect(x, y, tb.rect));
  if (tab && tab.id === 'admin') ui.panel = 'admin';
  else if (tab) ui.escTab = tab.id;
  else if (inRect(x, y, L.logout)) logout();
  else if (inRect(x, y, L.resume) || !inRect(x, y, L.panel)) ui.panel = null;
}

export function draw() {
  const L = layout(), { x, y, w } = L.panel;
  woodPanel(x, y, w, L.panel.h, 12);
  text(t('Menü'), x + PAD, y + 34, { size: 20, bold: true, color: CREAM });
  text(t('[Esc] schließen'), x + w - PAD, y + 34, { size: 12, color: 'rgba(243,226,192,0.6)', align: 'right' });
  for (const tb of L.tabs) {
    const active = tb.id === L.tab, hover = inRect(mouse.x, mouse.y, tb.rect);
    rrect(tb.rect.x, tb.rect.y, tb.rect.w, tb.rect.h, 6, active ? PARCHMENT : hover ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.25)',
      active ? PARCHMENT_DARK : 'rgba(255,220,160,0.18)', 1.5);
    text(tb.name, tb.rect.x + tb.rect.w / 2, tb.rect.y + 20, { size: 13, bold: true, align: 'center', color: active ? INK : CREAM });
  }
  if (L.tab === 'overview') drawOverview(L);
  else drawControls(L);
  woodButton(L.resume, t('Weiterspielen'), inRect(mouse.x, mouse.y, L.resume), '#4f6b2a');
  woodButton(L.logout, t('⏻ Ausloggen'), inRect(mouse.x, mouse.y, L.logout), '#8a3a24');
}

function drawOverview(L) {
  const { x, w } = L.panel, left = x + PAD, right = x + w - PAD;
  // Eigenes Überleben
  let cy = L.top;
  parchment(left, cy, w - PAD * 2, 56);
  const alive = me.dead ? 0 : me.al || 0;
  text(t('⏳ {time} überlebt', { time: fmtDuration(alive) }), left + 12, cy + 22, { size: 15, bold: true, color: INK });
  text(t('Rekord {time}', { time: fmtDuration(me.ab || 0) }), right - 12, cy + 22, { size: 13, color: INK_LIGHT, align: 'right' });
  text(t('🏆 {score} Punkte   💀 {kills} Kills   Lv {lv}', { score: me.score, kills: me.kills, lv: me.lvl }), left + 12, cy + 44, { size: 13, color: INK_LIGHT });

  // Spielerliste
  cy += 82;
  text(t('Spieler · {n} online', { n: online }), left, cy, { size: 14, bold: true, color: CREAM });
  cy += 10;
  parchment(left, cy, w - PAD * 2, L.list.length * ROW + 10);
  L.list.forEach((r, i) => {
    const ry = cy + 21 + i * ROW, color = r.mine ? '#2f6a1c' : INK;
    if (r.mine) {
      ctx.fillStyle = 'rgba(95,143,47,0.18)';
      ctx.fillRect(left + 4, ry - 15, w - PAD * 2 - 8, ROW - 2);
    }
    text(`${r.rank}.`, left + 14, ry, { size: 13, bold: r.mine, color });
    text(r.name, left + 42, ry, { size: 13, bold: r.mine, color });
    text(String(r.score), right - 12, ry, { size: 13, bold: r.mine, color, align: 'right' });
  });

  cy += L.list.length * ROW + 34;
  text(account ? t('👤 {name} · Fortschritt wird gespeichert', { name: account }) : t('👤 Gast · Fortschritt wird nicht gespeichert'), left, cy,
    { size: 12, color: account ? '#b6e08a' : '#e0b0a0' });
}

// Zwei Spalten: links Bewegen & Kämpfen, Bauen – rechts Fenster, Sonstiges
function drawControls(L) {
  const { x, w } = L.panel, colW = (w - PAD * 2 - 12) / 2;
  [CONTROLS.slice(0, 2), CONTROLS.slice(2)].forEach((groups, c) => {
    const cx = x + PAD + c * (colW + 12);
    let cy = L.top;
    for (const [title, keys] of groups) {
      text(t(title), cx, cy + 14, { size: 13, bold: true, color: CREAM });
      cy += 22;
      parchment(cx, cy, colW, keys.length * KEY_ROW + 6);
      keys.forEach(([caps, label], i) => {
        const ry = cy + 4 + i * KEY_ROW;
        let kx = cx + 8;
        for (const cap of caps) kx = keyCap(cap.length > 3 ? t(cap) : cap, kx, ry + 2) + 4;
        ctx.font = '12px Segoe UI, sans-serif';
        text(fit(t(label), cx + colW - 8 - Math.max(kx, cx + 62)), Math.max(kx, cx + 62), ry + 15, { size: 12, color: INK });
      });
      cy += keys.length * KEY_ROW + 14;
    }
  });
}

// Taste wie eine Tastenkappe; liefert das rechte Ende
function keyCap(label, x, y) {
  ctx.font = 'bold 11px Segoe UI, sans-serif';
  const w = Math.max(18, ctx.measureText(label).width + 10);
  rrect(x, y, w, 17, 3, '#fbf3df', WOOD_DARK, 1);
  rrect(x, y + 14, w, 3, 2, 'rgba(46,29,14,0.35)');
  text(label, x + w / 2, y + 12, { size: 11, bold: true, align: 'center', color: INK });
  return x + w;
}

// Text auf maxW kürzen (mit …)
function fit(str, maxW) {
  if (ctx.measureText(str).width <= maxW) return str;
  while (str.length > 1 && ctx.measureText(str + '…').width > maxW) str = str.slice(0, -1);
  return str.trimEnd() + '…';
}
