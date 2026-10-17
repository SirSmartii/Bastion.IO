// Admin-Menü [F8] (nur für Admins – das Recht steht in der Datenbank, der Server prüft jede Aktion):
// Übersicht (Besucher & Spieler der letzten 7 Tage, letzte Sitzungen), Spieler (Hin, Holen, Godmode, Heilen,
// Kick, Bann), Items erstellen und Bans. Oben eine Leiste für einen selbst: Godmode, Heilen, Tag/Nacht, Gegner weg.
// Teleport: Klick auf die Weltkarte [M].

import { ctx, cfg, me, myId, ui, mouse, now, W, H, isAdmin } from '../state.js';
import { rrect, text, inRect } from '../draw/primitives.js';
import { drawItemIcon, itemName } from '../draw/items.js';
import { send } from '../net.js';
import { itemTooltip } from './tooltip.js';
import { fmtDuration } from './hud.js';
import { woodPanel, parchment, CREAM, INK, INK_LIGHT, PARCHMENT, PARCHMENT_DARK } from './theme.js';
import { t, lang } from '../i18n.js';

export const whileDead = true;

const WIDTH = 820, PAD = 18, TOP = 128, BODY_H = 440, ROW = 46, PER_PAGE = 8, ICON = 46;
const TABS = ['overview', 'players', 'items', 'bans'];
const TAB_NAMES = { overview: 'Übersicht', players: 'Spieler', items: 'Items', bans: 'Bans' };
const AMOUNTS = [1, 10, 50, 100, 500];

// Zuletzt vom Server geschickte Daten ({ now, online, stats, bans }) und Auswahl im Menü
let data = null, lastRequest = -9, armed = { key: '', t: -9 };
const sel = { tab: 'overview', page: 0, cat: 'items', n: 10, rarity: 0 };

export function setAdminData(m) { data = m; }

// Zweiter Klick innerhalb von 2 s bestätigt (Kick, Bann)
function confirm(key) {
  if (armed.key === key && now - armed.t < 2) { armed.key = ''; return true; }
  armed = { key, t: now };
  return false;
}
const isArmed = (key) => armed.key === key && now - armed.t < 2;

const fmtTime = (ts) => new Date(ts).toLocaleString(lang, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDay = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(lang, { weekday: 'short', day: '2-digit', month: '2-digit' });
const sector = (x, y) => 'ABCDEFGHIJ'[Math.min(9, Math.floor(x / (cfg.WORLD_SIZE / 10)))] + (Math.min(9, Math.floor(y / (cfg.WORLD_SIZE / 10))) + 1);

// ---------- Layout ----------

function itemIds(cat) {
  if (cat === 'items') return Object.keys(cfg.ITEMS.names);
  return Object.keys(cfg.EQUIPMENT).filter((id) => cfg.EQUIPMENT[id].tab === cat);
}

export function layout() {
  const h = TOP + BODY_H + 20, x = Math.round(W / 2 - WIDTH / 2), y = Math.round(Math.max(20, H / 2 - h / 2));
  const left = x + PAD, inner = WIDTH - PAD * 2, top = y + TOP, buttons = [];
  const add = (rect, label, act, opts = {}) => buttons.push({ rect, label, act, ...opts });

  // Reiter
  const tw = (inner - 6 * (TABS.length - 1)) / TABS.length;
  TABS.forEach((id, i) => add({ x: left + i * (tw + 6), y: y + 46, w: tw, h: 28 }, t(TAB_NAMES[id]), { tab: id }, { active: sel.tab === id }));

  // Leiste für einen selbst
  const tools = [
    [me.god ? t('⚡ Godmode an') : t('Godmode aus'), { a: 'god' }, !!me.god],
    [t('Heilen'), { a: 'heal' }],
    [t('☀ Tag'), { a: 'time', night: false }],
    [t('🌙 Nacht'), { a: 'time', night: true }],
    [t('Gegner im Umkreis entfernen'), { a: 'clear' }],
  ];
  let bx = left;
  ctx.font = 'bold 12px Segoe UI, sans-serif';
  for (const [label, msg, active] of tools) {
    const bw = ctx.measureText(label).width + 20;
    add({ x: bx, y: y + 84, w: bw, h: 26 }, label, { send: msg }, { active });
    bx += bw + 6;
  }

  const L = { panel: { x, y, w: WIDTH, h }, left, inner, top, buttons, rows: [], icons: [] };
  if (!data) return L;

  if (sel.tab === 'players') {
    const pages = Math.max(1, Math.ceil(data.online.length / PER_PAGE));
    sel.page = Math.min(sel.page, pages - 1);
    data.online.slice(sel.page * PER_PAGE, (sel.page + 1) * PER_PAGE).forEach((o, i) => {
      const ry = top + 8 + i * ROW;
      L.rows.push({ o, y: ry });
      const self = o.id === myId;
      const acts = [
        [t('Hin'), { a: 'goto', id: o.id }, !self],
        [t('Holen'), { a: 'bring', id: o.id }, !self],
        [o.god ? t('God an') : t('God'), { a: 'god', id: o.id }, true, o.god],
        [t('Heilen'), { a: 'heal', id: o.id }, true],
        [t('Kick'), { a: 'kick', id: o.id }, !self, false, true],
        [t('Bann 1 h'), { a: 'ban', id: o.id, h: 1 }, !self, false, true],
        [t('Bann 24 h'), { a: 'ban', id: o.id, h: 24 }, !self, false, true],
        [t('Bann ∞'), { a: 'ban', id: o.id, h: 0 }, !self, false, true],
      ];
      let ax = left + inner;
      ctx.font = 'bold 11px Segoe UI, sans-serif';
      for (let k = acts.length - 1; k >= 0; k--) {
        const [label, msg, show, active, danger] = acts[k];
        if (!show) continue;
        const key = `${msg.a}:${msg.id}:${msg.h}`, shown = danger && isArmed(key) ? t('Sicher?') : label;
        const bw = Math.max(ctx.measureText(label).width, ctx.measureText(t('Sicher?')).width) + 14;
        ax -= bw;
        add({ x: ax, y: ry + 22, w: bw, h: 20 }, shown, { send: msg, confirm: danger ? key : null }, { active, danger, small: true });
        ax -= 4;
      }
    });
    if (pages > 1) {
      add({ x: left, y: top + BODY_H - 30, w: 34, h: 24 }, '◀', { page: -1 });
      add({ x: left + 90, y: top + BODY_H - 30, w: 34, h: 24 }, '▶', { page: 1 });
      L.pageText = `${sel.page + 1} / ${pages}`;
    }
  }

  if (sel.tab === 'items') {
    const cats = ['items', ...cfg.FORGE_TABS.map((f) => f.id)];
    const cw = (inner - 6 * (cats.length - 1)) / cats.length;
    cats.forEach((id, i) => add({ x: left + i * (cw + 6), y: top + 6, w: cw, h: 24 },
      id === 'items' ? t('Materialien & Essen') : cfg.FORGE_TABS.find((f) => f.id === id).name, { cat: id }, { active: sel.cat === id, small: true }));
    let ax = left;
    ctx.font = 'bold 11px Segoe UI, sans-serif';
    const gear = sel.cat !== 'items';
    for (const n of AMOUNTS) {
      if (gear && n > 20) continue;
      add({ x: ax, y: top + 38, w: 46, h: 22 }, `${n}×`, { n }, { active: sel.n === n, small: true });
      ax += 50;
    }
    if (gear) {
      ax += 16;
      cfg.GEAR.rarities.forEach((r, i) => {
        const bw = ctx.measureText(r.name).width + 16;
        add({ x: ax, y: top + 38, w: bw, h: 22 }, r.name, { rarity: i }, { active: sel.rarity === i, small: true, color: r.color });
        ax += bw + 4;
      });
    }
    const cols = Math.floor(inner / (ICON + 6));
    itemIds(sel.cat).forEach((id, i) => {
      L.icons.push({ id, rect: { x: left + (i % cols) * (ICON + 6), y: top + 70 + Math.floor(i / cols) * (ICON + 6), w: ICON, h: ICON } });
    });
  }

  if (sel.tab === 'bans') {
    data.bans.slice(0, 9).forEach((b, i) => {
      const ry = top + 8 + i * ROW;
      L.rows.push({ b, y: ry });
      add({ x: left + inner - 96, y: ry + 10, w: 92, h: 24 }, t('Aufheben'), { send: { a: 'unban', ban: b.id } }, { small: true });
    });
  }
  return L;
}

// ---------- Klicks ----------

export function onClick(x, y) {
  const L = layout();
  if (!inRect(x, y, L.panel)) { ui.panel = null; return; }
  const icon = L.icons.find((ic) => inRect(x, y, ic.rect));
  if (icon) {
    const n = cfg.EQUIPMENT[icon.id] ? Math.min(sel.n, 20) : sel.n;
    send({ t: 'adm', a: 'give', item: icon.id, n, r: sel.rarity });
    return;
  }
  const b = L.buttons.find((bt) => inRect(x, y, bt.rect));
  if (!b) return;
  const a = b.act;
  if (a.tab) { sel.tab = a.tab; sel.page = 0; }
  else if (a.cat) { sel.cat = a.cat; if (a.cat !== 'items') sel.n = Math.min(sel.n, 10); }
  else if (a.n) sel.n = a.n;
  else if (a.rarity !== undefined) sel.rarity = a.rarity;
  else if (a.page) sel.page = Math.max(0, sel.page + a.page);
  else if (a.send) {
    if (a.confirm && !confirm(a.confirm)) return;
    send({ t: 'adm', ...a.send });
    lastRequest = -9; // gleich frische Daten holen
  }
}

// ---------- Zeichnen ----------

function button(b) {
  const hover = inRect(mouse.x, mouse.y, b.rect), r = b.rect;
  const fill = b.active ? (b.color || PARCHMENT) : b.danger ? (hover ? '#a8442c' : '#7e3220') : hover ? '#93693f' : '#6e4c2c';
  rrect(r.x, r.y, r.w, r.h, 5, fill, b.active ? PARCHMENT_DARK : 'rgba(255,220,160,0.22)', 1.5);
  text(b.label, r.x + r.w / 2, r.y + r.h / 2 + (b.small ? 4 : 5), { size: b.small ? 11 : 12, bold: true, align: 'center', color: b.active ? INK : CREAM });
}

export function draw() {
  if (!isAdmin) { ui.panel = null; return; }
  if (now - lastRequest > 2) { lastRequest = now; send({ t: 'adm', a: 'info' }); }
  const L = layout(), { x, y, w } = L.panel;
  woodPanel(x, y, w, L.panel.h, 12);
  text(t('🛠 Admin'), x + PAD, y + 32, { size: 20, bold: true, color: CREAM });
  text(t('[F8] schließen · Teleport: Klick auf die Weltkarte [M]'), x + w - PAD, y + 32, { size: 12, color: 'rgba(243,226,192,0.65)', align: 'right' });
  parchment(L.left, L.top - 4, L.inner, BODY_H);
  for (const b of L.buttons) button(b);
  if (!data) { text(t('Lade …'), L.left + 12, L.top + 24, { size: 14, color: INK }); return; }
  if (sel.tab === 'overview') drawOverview(L);
  if (sel.tab === 'players') drawPlayers(L);
  if (sel.tab === 'items') drawItems(L);
  if (sel.tab === 'bans') drawBans(L);
}

function drawOverview(L) {
  const { left, inner, top } = L, s = data.stats, on = data.online;
  const accs = on.filter((o) => o.acc).length;
  text(t('Online: {n} ({acc} mit Account, {guests} Gäste)', { n: on.length, acc: accs, guests: on.length - accs }), left + 12, top + 20, { size: 14, bold: true, color: INK });
  if (!s) { text(t('Ohne Datenbank gibt es keine Statistik.'), left + 12, top + 44, { size: 13, color: INK_LIGHT }); return; }
  text(t('Accounts gesamt: {n}', { n: s.accounts }), left + inner - 12, top + 20, { size: 13, color: INK_LIGHT, align: 'right' });

  // Tabelle der letzten 7 Tage
  const cols = [[t('Tag'), 0], [t('Aufrufe'), 150], [t('Besucher'), 240], [t('Spieler'), 340], [t('davon Gäste'), 430], [t('Sitzungen'), 550], [t('⌀ Dauer'), 660]];
  let ry = top + 52;
  for (const [label, cx] of cols) text(label, left + 12 + cx, ry, { size: 12, bold: true, color: INK_LIGHT });
  for (const d of [...s.days].reverse()) {
    ry += 20;
    const today = d === s.days.at(-1);
    const vals = [today ? t('Heute') : fmtDay(d.day), d.views, d.visitors, d.players, d.guests, d.sessions, d.sessions ? fmtDuration(d.avg) : '–'];
    vals.forEach((v, i) => text(String(v), left + 12 + cols[i][1], ry, { size: 12, bold: today, color: INK }));
  }
  text(t('Aufrufe = Hauptmenü geladen · Besucher = verschiedene IPs · Spieler = wirklich ins Spiel gegangen'), left + 12, ry + 20, { size: 11, color: INK_LIGHT });

  // Letzte Sitzungen
  ry += 52;
  text(t('Letzte Sitzungen'), left + 12, ry, { size: 13, bold: true, color: INK });
  // Zwei Spalten: links und rechts abwechselnd, neueste zuerst
  s.recent.slice(0, 8).forEach((r, i) => {
    const colX = left + 12 + (i % 2) * (inner / 2), rowY = ry + 20 + Math.floor(i / 2) * 18;
    text(`${r.online ? '● ' : ''}${r.name}${r.acc ? '' : t(' (Gast)')}`, colX, rowY, { size: 12, bold: r.online, color: r.online ? '#2f6a1c' : INK });
    text(`${fmtTime(r.at)} · ${fmtDuration(r.dur)}`, colX + inner / 2 - 24, rowY, { size: 12, color: INK_LIGHT, align: 'right' });
  });
}

function drawPlayers(L) {
  const { left, inner } = L;
  if (!data.online.length) text(t('Niemand online.'), left + 12, L.top + 24, { size: 13, color: INK });
  for (const { o, y } of L.rows) {
    rrect(left + 4, y, inner - 8, ROW - 4, 6, o.id === myId ? 'rgba(95,143,47,0.16)' : 'rgba(0,0,0,0.05)');
    const badges = [o.admin ? '👑' : '', o.god ? '⚡' : '', o.dead ? '💀' : ''].join('');
    text(`${badges} ${o.name}`.trim(), left + 12, y + 16, { size: 14, bold: true, color: INK });
    const info = [o.acc ? t('Account') : t('Gast'), `Lv ${o.lvl}`, o.ip || '–', t('online {time}', { time: fmtDuration(Math.round((data.now - o.since) / 1000)) }), sector(o.x, o.y)];
    text(info.join(' · '), left + 12, y + 35, { size: 11, color: INK_LIGHT });
  }
  if (L.pageText) text(L.pageText, left + 62, L.top + BODY_H - 13, { size: 12, bold: true, color: INK, align: 'center' });
}

function drawItems(L) {
  let hover = null;
  for (const ic of L.icons) {
    const over = inRect(mouse.x, mouse.y, ic.rect);
    if (over) hover = ic;
    rrect(ic.rect.x, ic.rect.y, ICON, ICON, 6, over ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.1)', 'rgba(61,42,20,0.25)', 1);
    drawItemIcon(ic.id, ic.rect.x + ICON / 2, ic.rect.y + ICON / 2, 34);
  }
  if (hover) {
    const gear = cfg.EQUIPMENT[hover.id], n = gear ? Math.min(sel.n, 20) : sel.n;
    itemTooltip(hover.id, [[t('Klick: {n}× {name} erstellen', { n, name: itemName(hover.id) }), '#ffd76a']]);
  }
}

function drawBans(L) {
  const { left } = L;
  if (!data.bans.length) text(t('Keine aktiven Bans.'), left + 12, L.top + 24, { size: 13, color: INK });
  for (const { b, y } of L.rows) {
    rrect(left + 4, y, L.inner - 8, ROW - 4, 6, 'rgba(0,0,0,0.05)');
    text(`${b.name}${b.acc ? '' : t(' (Gast)')}`, left + 12, y + 16, { size: 14, bold: true, color: INK });
    const until = b.until ? t('bis {time}', { time: fmtTime(b.until) }) : t('dauerhaft');
    text([until, b.ip || '–', t('von {name} am {time}', { name: b.by, time: fmtTime(b.at) })].join(' · '), left + 12, y + 35, { size: 11, color: INK_LIGHT });
  }
  if (data.bans.length > 9) text(t('… und {n} weitere', { n: data.bans.length - 9 }), left + 12, L.top + BODY_H - 14, { size: 12, color: INK_LIGHT });
}
