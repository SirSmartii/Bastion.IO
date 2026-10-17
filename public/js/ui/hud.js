// HUD im Werkbank-Stil (ui/theme.js): Überlebenszeit oben, Kompass-Minimap oben rechts, Status unten links,
// Hotbar unten – und darüber die offenen Fenster. Bestenliste und Ausloggen stehen im Menü [Esc] (ui/esc.js).

import { ctx, cfg, me, myId, minimap, hovered, ui, mouse, now, W, H, dpr } from '../state.js';
import { TAU } from '../constants.js';
import { circle, rrect, text, inRect, fmtClock } from '../draw/primitives.js';
import { drawItemIcon, itemName } from '../draw/items.js';
import { drawStruct } from '../draw/entities.js';
import { toasts } from '../effects.js';
import { drawChatLog } from '../chat.js';
import { world } from '../world.js';
import { canAfford, teammates } from '../rules.js';
import { fmtCost } from './format.js';
import { drawStructureTooltip, drawPendingTooltip } from './tooltip.js';
import { drawInventory, drawChest, drawDragged, supplyText } from './inventory.js';
import { drawCharacter } from './character.js';
import { panels } from './panels.js';
import { artAt } from '../assets.js';
import { woodPanel, parchment, segmentBar, woodButton, WOOD, WOOD_DARK, PARCHMENT, PARCHMENT_DARK, INK, INK_LIGHT, CREAM } from './theme.js';

// Statusbrett unten links: so hoch, darüber beginnt der Chat (chat.js)
export const STATUS_H = 142, STATUS_W = 300;

// Dauer als h:mm:ss bzw. m:ss
export const fmtDuration = (sec) => (sec >= 3600 ? `${Math.floor(sec / 3600)}:${fmtClock(sec % 3600).padStart(5, '0')}` : fmtClock(sec));

// HOTBAR_SIZE Item-Slots und dahinter (mit etwas Abstand) der Bau-Button
export function hotbarRects() {
  const n = cfg ? cfg.HOTBAR_SIZE : 6, size = 60, gap = 6, sep = 18;
  const total = (n + 1) * size + n * gap + sep;
  // Mittig; in schmalen Fenstern rechts neben das Statusbrett, und passt sie dort nicht hin, darüber
  const statusRight = 14 + STATUS_W + 52; // Platz für "Lv" links der EP-Leiste
  let x0 = Math.round(W / 2 - total / 2), y = H - size - 24;
  if (x0 < statusRight) {
    if (statusRight + total <= W - 14) x0 = statusRight;
    else { x0 = Math.max(14, x0); y -= STATUS_H + 44; }
  }
  const rects = [];
  for (let i = 0; i < n; i++) rects.push({ x: x0 + i * (size + gap), y, w: size, h: size });
  rects.push({ x: x0 + n * (size + gap) + sep, y, w: size, h: size });
  return rects;
}

export function drawHud() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!me.dead) ui.spawnChoice = null; // Wahl im Todesbildschirm gilt nur bis zum Aufwachen
  const toastY = drawSurvivalTime();
  toasts.forEach((t, i) => {
    ctx.globalAlpha = Math.min(1, t.life);
    text(t.text, W / 2, toastY + i * 26, { size: 17, bold: true, align: 'center', color: '#fff' });
    ctx.globalAlpha = 1;
  });
  drawFirstSpawnHint(toastY + toasts.length * 26 + 4);
  text('[Esc] Menü', 16, 26, { size: 12, color: 'rgba(255,255,255,0.45)' });
  drawStatus();
  drawHotbar();
  drawMinimap();
  drawChatLog();

  if (!me.core && !me.dead) {
    const hint = ui.selected === 1 && ui.buildType === 'core' ? 'Klicke auf einen freien Platz, um deine Basis zu gründen' : 'Öffne das Baumenü [B] und platziere deinen Basis-Kern';
    text(hint, W / 2, H - 150, { size: 17, bold: true, align: 'center', color: '#ffe08a' });
  }
  if (hovered) drawStructureTooltip(hovered);

  // Fenster (Item-Tooltips erst danach, damit kein Fenster sie verdeckt)
  if (!me.dead) {
    if (ui.inv) drawInventory();
    if (ui.inv && me.ch) drawChest();
    if (ui.char) drawCharacter();
    if (ui.drag && (ui.inv || ui.char)) drawDragged();
  }
  drawPendingTooltip();
  if (ui.panel && (!me.dead || panels[ui.panel].whileDead)) panels[ui.panel].draw();

  if (me.dead) {
    ctx.fillStyle = 'rgba(40,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    text('Du wurdest überrannt!', W / 2, H / 2 - 10, { size: 40, bold: true, align: 'center', color: '#ff6b6b' });
    const buttons = deathButtons();
    if (!buttons.length) {
      text(`Du wachst in ${Math.ceil(me.rt)} s irgendwo in der Welt auf`, W / 2, H / 2 + 28, { size: 18, align: 'center' });
      text('Tipp: Lege einen Schlafsack (Baumenü [B]), um dort aufzuwachen.', W / 2, H / 2 + 54, { size: 14, align: 'center', color: '#ffd9a0' });
    } else {
      text(me.rt > 0 ? `Wo willst du aufwachen? (frühestens in ${Math.ceil(me.rt)} s)` : 'Wo willst du aufwachen?', W / 2, H / 2 + 28, { size: 18, align: 'center' });
      for (const b of buttons) {
        const chosen = ui.spawnChoice === b.id, ready = !b.wait;
        woodButton(b.rect, b.wait ? `${b.label} · frei in ${b.wait} s` : b.label, ready && inRect(mouse.x, mouse.y, b.rect), chosen ? '#4f6b2a' : ready ? undefined : '#4a3a2a');
      }
    }
  }
}

// Todesbildschirm: ein Knopf pro Schlafsack (me.sb: [id, x, y, Sekunden bis frei]) und "Irgendwo"
export function deathButtons() {
  if (!me || !me.dead || !me.sb || !me.sb.length) return [];
  const opts = me.sb.map(([id, , , wait], i) => ({ id, label: `🛏 Schlafsack ${i + 1}`, wait }));
  opts.push({ id: 0, label: '🎲 Irgendwo', wait: 0 });
  const w = 230, h = 40, gap = 12, total = opts.length * w + (opts.length - 1) * gap, x0 = Math.round(W / 2 - total / 2);
  return opts.map((o, i) => ({ ...o, rect: { x: x0 + i * (w + gap), y: Math.round(H / 2 + 50), w, h } }));
}

// ---------- Erster Spawn: Hinweis auf die Steuerung im Menü [Esc] ----------

// Nur beim allerersten Spiel in diesem Browser; verschwindet nach HINT_TIME s oder sobald das Menü offen war
const HINT_TIME = 25;
let hintSeen = false, hintStart = null, hintPlayer = null;
try { hintSeen = localStorage.getItem('bastion-help-seen') === '1'; } catch { /* privater Modus: jedes Mal zeigen */ }

function drawFirstSpawnHint(y) {
  if (hintSeen || me.dead) return;
  if (hintPlayer !== myId) { hintPlayer = myId; hintStart = now; }
  const age = now - hintStart;
  if (age > HINT_TIME || ui.panel === 'esc') {
    hintSeen = true;
    try { localStorage.setItem('bastion-help-seen', '1'); } catch { /* egal */ }
    return;
  }
  const w = 430, h = 64, x = W / 2 - w / 2;
  ctx.globalAlpha = Math.min(1, age * 2, (HINT_TIME - age) / 1.5);
  woodPanel(x, y, w, h, 10);
  text('Willkommen! Alle Tasten & Hilfe findest du im Menü [Esc].', W / 2, y + 27, { size: 14, bold: true, align: 'center', color: CREAM });
  text('Tipp: Lege einen Schlafsack (Baumenü [B]) – dort wachst du nach dem Tod auf.', W / 2, y + 47, { size: 12, align: 'center', color: 'rgba(243,226,192,0.75)' });
  ctx.globalAlpha = 1;
}

// ---------- Oben: wie lange man schon lebt ----------

// Brett mit gewölbter Oberkante; darunter ein Hinweis (Verfall, Spawnschutz, ruhige Nacht). Liefert y für die Meldungen.
function drawSurvivalTime() {
  const w = 190, x = W / 2 - w / 2;
  woodPanel(x, 10, w, 52, [26, 26, 8, 8]);
  const alive = me.dead ? 0 : me.al || 0, best = me.ab || 0;
  const time = fmtDuration(alive);
  ctx.font = 'bold 19px Segoe UI, sans-serif';
  const tw = ctx.measureText(time).width;
  artAt('ui/hourglass', W / 2 - tw / 2 - 4, 32, 18);
  text(time, W / 2 + 9, 38, { size: 19, bold: true, align: 'center', color: CREAM });
  text(alive >= best && best > 60 ? '★ neuer Rekord' : `überlebt · Rekord ${fmtDuration(best)}`, W / 2, 54, {
    size: 11, align: 'center', color: alive >= best && best > 60 ? '#ffd76a' : 'rgba(243,226,192,0.65)',
  });

  let badge = null;
  if (me.up && me.up.d) {
    const blink = Math.floor(now * 2) % 2 === 0;
    badge = ['⚠ Deine Basis verfällt – Holz/Stein/Gold in den Basis-Kern legen [F]', blink ? 'rgba(140,30,20,0.9)' : 'rgba(110,25,18,0.9)', '#ffd9d0'];
  } else if (me.prot > 0) badge = [`🛡 Spawnschutz – noch ${fmtClock(me.prot)}`, 'rgba(40,90,130,0.85)', '#cfeeff'];
  else if (me.calm > 0) badge = [`🌙 Ruhige erste Nacht – wenige Gegner (${fmtClock(me.calm)})`, 'rgba(50,50,100,0.85)', '#d6d9ff'];
  if (!badge) return 92;

  const [label, background, color] = badge;
  ctx.font = 'bold 13px Segoe UI, sans-serif';
  const bw = ctx.measureText(label).width + 24;
  rrect(W / 2 - bw / 2, 70, bw, 24, 12, background, 'rgba(255,255,255,0.25)', 1.5);
  text(label, W / 2, 87, { size: 13, bold: true, align: 'center', color });
  return 120;
}

// ---------- Unten links: Leben, Ausdauer, Hunger, Durst, Werte, Basis ----------

function drawStatus() {
  const x = 14, y = H - STATUS_H - 10, w = STATUS_W, S = cfg.SURVIVAL, blink = Math.sin(now * 8) > 0;
  woodPanel(x, y, w, STATUS_H);
  const barX = x + 40, barW = w - 56;
  // Symbol aus assets/ui; warn = blinkt
  const icon = (name, ix, iy, size, warn) => {
    if (warn && blink) ctx.globalAlpha = 0.35;
    artAt(`ui/${name}`, ix, iy, size);
    ctx.globalAlpha = 1;
  };

  // Leben (mit Zahl rechts darüber), Ausdauer
  const hpFrac = me.hp / me.maxHp, hpLow = hpFrac <= 0.35;
  icon('heart', x + 22, y + 24, 18, hpLow);
  segmentBar(barX, y + 18, barW, 13, hpFrac, hpLow ? '#e05555' : '#c94a3a');
  text(`${Math.round(me.hp)}/${me.maxHp}`, barX + barW, y + 14, { size: 10, bold: true, align: 'right', color: 'rgba(243,226,192,0.7)' });
  icon('stamina', x + 22, y + 45, 16, me.ex);
  segmentBar(barX, y + 41, barW, 9, me.st / me.stats.stamina, me.ex ? '#e05555' : '#e0ad35');

  // Hunger & Durst nebeneinander; unter warnAt blinken sie rot
  const half = (barW - 34) / 2;
  const need = (bx, name, v, color) => {
    const low = v <= S.warnAt;
    icon(name, bx - 17, y + 67, 16, low);
    segmentBar(bx, y + 62, half, 10, v / S.max, low ? '#e05555' : color, 5);
  };
  need(barX, 'hunger', me.hu ?? S.max, '#d98c2e');
  need(barX + half + 34, 'thirst', me.th ?? S.max, '#3f8ac0');

  // Pergament: Werte, Punkte und Basis bzw. was als Nächstes zu tun ist
  const py = y + 84;
  parchment(x + 10, py, w - 20, STATUS_H - 94);
  const st = me.stats;
  let vx = x + 20;
  for (const [name, value] of [['damage', st.damage], ['armor', st.armor], ['speed', st.speed]]) {
    artAt(`ui/${name}`, vx + 7, py + 14, 15);
    text(String(value), vx + 17, py + 19, { size: 13, bold: true, color: INK });
    ctx.font = 'bold 13px Segoe UI, sans-serif';
    vx += 17 + ctx.measureText(String(value)).width + 12;
  }
  ctx.font = 'bold 13px Segoe UI, sans-serif';
  const kills = String(me.kills), score = String(me.score), kw = ctx.measureText(kills).width;
  text(kills, x + w - 20, py + 19, { size: 13, bold: true, color: INK, align: 'right' });
  artAt('ui/skull', x + w - 28 - kw, py + 14, 14);
  const sx = x + w - 48 - kw;
  text(score, sx, py + 19, { size: 13, bold: true, color: INK, align: 'right' });
  artAt('ui/trophy', sx - ctx.measureText(score).width - 9, py + 14, 14);

  artAt('ui/base', x + 26, py + 33, 14);
  if (me.core) {
    const base = `Lv ${me.core[3] + 1} · ${me.count}/${me.max} Gebäude · `;
    text(base, x + 37, py + 38, { size: 12, color: INK_LIGHT });
    const [supply, color] = !me.up ? ['', ''] : me.up.d ? ['⚠ Verfall!', '#b02a1a'] : [supplyText(me.up), me.up.n < 2 ? '#a5520e' : INK_LIGHT];
    ctx.font = '12px Segoe UI, sans-serif';
    text(supply, x + 37 + ctx.measureText(base).width, py + 38, { size: 12, bold: true, color });
  } else text('Noch keine Basis – Baumenü [B]', x + 37, py + 38, { size: 12, bold: true, color: '#a5401e' });
}

// ---------- Hotbar ----------

function drawHotbar() {
  const rects = hotbarRects(), first = rects[0], last = rects[cfg.HOTBAR_SIZE];
  woodPanel(first.x - 8, first.y - 8, last.x + last.w - first.x + 16, first.h + 16, 10);
  const slotBackground = (r, active, border) => rrect(r.x, r.y, r.w, r.h, 6, active ? '#f7ecd0' : PARCHMENT,
    border || (active ? '#e0a82e' : PARCHMENT_DARK), active || border ? 3 : 2);
  const hoverSlot = rects.findIndex((r) => inRect(mouse.x, mouse.y, r));
  const draggingItem = ui.drag && ui.drag.slot !== undefined;

  for (let i = 0; i < cfg.HOTBAR_SIZE; i++) {
    const r = rects[i], item = me.hb[i];
    const def = item && cfg.EQUIPMENT[item];
    const equipped = def && me.eq[def.slot] === item;
    const count = item ? me.res[item] || 0 : 0;
    // Aktiv = ausgerüstete Waffe bzw. gewählte Munition
    const active = !!item && ui.selected === 0 && ((equipped && def.slot === 'weapon') || item === me.ammo);
    slotBackground(r, active, draggingItem && hoverSlot === i ? '#5f8f2f' : equipped && !active ? '#5f8f2f' : null);
    text(String(i + 1), r.x + 5, r.y + 14, { size: 11, color: INK_LIGHT, bold: true });
    if (!item) continue;
    ctx.globalAlpha = equipped || count > 0 ? 1 : 0.35;
    drawItemIcon(item, r.x + r.w / 2, r.y + r.h / 2 - 3, 36);
    ctx.globalAlpha = 1;
    if (!def) text(String(count), r.x + r.w - 5, r.y + r.h - 6, { size: 12, bold: true, align: 'right', color: count ? INK : '#b02a1a' });
    else if (equipped) text('E', r.x + r.w - 6, r.y + 14, { size: 11, bold: true, align: 'right', color: '#3f6f1a' });
    if (equipped && item === 'torch' && me.tl) text(fmtDuration(me.tl), r.x + r.w - 5, r.y + r.h - 6, { size: 11, bold: true, align: 'right', color: me.tl < 30 ? '#b02a1a' : INK }); // Fackel brennt noch
    if (equipped && def.ammo) {
      // Fernwaffe: Munitionsvorrat in der Ecke
      const ammo = me.res[me.ammo] || 0;
      text(String(ammo), r.x + r.w - 5, r.y + r.h - 6, { size: 11, bold: true, align: 'right', color: ammo ? INK : '#b02a1a' });
      drawItemIcon(me.ammo, r.x + 12, r.y + r.h - 11, 13);
    }
    if (hoverSlot === i && !ui.drag) text(itemName(item), r.x + r.w / 2, r.y - 34, { size: 12, bold: true, align: 'center' });
  }
  if (me.stats.ranged) {
    const kinds = cfg.AMMO[me.stats.ammo].types.filter((t) => (me.res[t.item] || 0) > 0).length;
    if (kinds > 1) text(`[R] ${itemName(me.ammo)}`, first.x, first.y - 40, { size: 11, bold: true, color: '#ffd76a' });
  }
  if (ui.inv) text('Item auf einen Slot ziehen oder mit Maus drauf 1–6 drücken · Rechtsklick leert', W / 2, first.y - 52, { size: 11, align: 'center', color: '#cfd8c0' });

  drawBuildButton(last, slotBackground);
  drawXpBar(rects);
}

// Bau-Button: zeigt das zuletzt gewählte Gebäude (oder einen Hammer)
function drawBuildButton(r, slotBackground) {
  const type = ui.buildType;
  slotBackground(r, ui.selected === 1 || ui.panel === 'build');
  ctx.save();
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2 - 4);
  if (type) {
    const k = type === 'core' ? 0.36 : 0.7;
    ctx.globalAlpha = canAfford(cfg.STRUCTURES[type].levels[0].cost) ? 1 : 0.4;
    ctx.scale(k, k);
    drawStruct({ type, x: 0, y: 0, level: 0, hp: 1, maxHp: 1, owner: myId, angle: -0.8 }, true);
  } else {
    ctx.rotate(-0.6);
    rrect(-3.5, -16, 7, 36, 3, '#7a5230', '#4a3019', 2);
    rrect(-14, -22, 28, 12, 3, '#9aa1a8', '#5c6268', 3);
  }
  ctx.restore();
  text('B', r.x + 5, r.y + 14, { size: 11, color: INK_LIGHT, bold: true });
  text(type ? cfg.STRUCTURES[type].name : 'Bauen', r.x + r.w / 2, r.y + r.h - 6, { size: 11, align: 'center', color: INK });
  if (type) {
    const cost = cfg.STRUCTURES[type].levels[0].cost;
    text(fmtCost(cost), r.x + r.w / 2, r.y + r.h + 20, { size: 11, color: canAfford(cost) ? '#e8e8e8' : '#ff8a7a', align: 'center' });
  }
}

// EP-Leiste über dem Hotbar-Brett
function drawXpBar(rects) {
  const last = rects[cfg.HOTBAR_SIZE], x = rects[0].x, w = last.x + last.w - x, y = rects[0].y - 22;
  rrect(x, y, w, 8, 4, WOOD_DARK, WOOD, 1.5);
  rrect(x + 1.5, y + 1.5, Math.max(0, (w - 3) * Math.min(1, me.xp / me.xpNext)), 5, 2.5, '#7fc4ff');
  text(`Lv ${me.lvl}`, x - 10, y + 8, { size: 13, bold: true, align: 'right', color: '#ffd76a' });
  text(`${me.xp}/${me.xpNext} EP`, x + w + 10, y + 8, { size: 11, color: '#cfd8c0' });
  if (me.sp > 0) text(`+${me.sp} Skillpunkt${me.sp > 1 ? 'e' : ''} [K]`, x + w / 2, y - 5, { size: 12, bold: true, align: 'center', color: '#ffd76a' });
}

// ---------- Minimap: runder Kompass oben rechts ----------

// Radar um den Spieler: zeigt ±MINIMAP_RANGE Welteinheiten, Norden oben
function drawMinimap() {
  const R = 84, cx = W - 14 - R - 4, cy = 14 + R + 4, range = cfg.MINIMAP_RANGE, k = R / range;
  const mx = (wx) => cx + (wx - me.x) * k, my = (wy) => cy + (wy - me.y) * k;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.clip();
  // Außerhalb der Welt dunkel
  ctx.fillStyle = '#1d2616';
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.fillStyle = 'rgba(52,78,38,0.95)';
  ctx.fillRect(mx(0), my(0), cfg.WORLD_SIZE * k, cfg.WORLD_SIZE * k);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const r of [R / 3, (2 * R) / 3]) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); }
  ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
  ctx.stroke();
  if (me.core) {
    ctx.beginPath();
    ctx.arc(mx(me.core[1]), my(me.core[2]), me.core[4] * k, 0, TAU);
    ctx.fillStyle = 'rgba(120,200,255,0.25)';
    ctx.fill();
    rrect(mx(me.core[1]) - 4, my(me.core[2]) - 4, 8, 8, 2, '#86e6ff');
  }
  drawMinimapTerrain(mx, my, k);
  if (me.forge) rrect(mx(me.forge[1]) - 2.5, my(me.forge[2]) - 2.5, 5, 5, 1, '#ff9a3c');
  for (const [, bx, by] of me.bags || []) rrect(mx(bx) - 3, my(by) - 2, 6, 4, 1.5, '#7fa8e0', '#1d2a40', 1); // Schlafsäcke
  const e = minimap.e;
  for (let i = 0; i < e.length; i += 3) {
    const hostile = e[i + 2];
    circle(mx(e[i] * 10), my(e[i + 1] * 10), hostile ? 2.6 : 2, hostile ? '#ff3b3b' : 'rgba(240,170,165,0.75)');
  }
  const strangers = minimap.p;
  for (let i = 0; i < strangers.length; i += 2) circle(mx(strangers[i] * 10), my(strangers[i + 1] * 10), 3, '#ffe08a', '#000', 1);
  for (const [, , tx, ty, , dead] of teammates()) if (!dead) circle(mx(tx), my(ty), 3.5, '#7fe0a0', '#000', 1);
  circle(cx, cy, 4, '#fff', '#000', 1.5);
  ctx.restore();

  // Holzring mit Himmelsrichtungen
  circle(cx, cy, R + 4, null, WOOD, 8);
  circle(cx, cy, R + 8.5, null, WOOD_DARK, 2);
  circle(cx, cy, R, null, WOOD_DARK, 1.5);
  for (const [label, ax, ay] of [['N', 0, -1], ['O', 1, 0], ['S', 0, 1], ['W', -1, 0]]) {
    const north = label === 'N', px = cx + ax * (R + 4), py = cy + ay * (R + 4);
    if (north) circle(px, py, 9, PARCHMENT, PARCHMENT_DARK, 2);
    text(label, px, py + 4, { size: north ? 11 : 9, bold: true, align: 'center', color: north ? '#a5401e' : CREAM });
  }
  text('[M] Karte', cx, cy + R + 24, { size: 11, align: 'center', color: 'rgba(255,255,255,0.55)' });
}

function drawMinimapTerrain(mx, my, k) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(190,160,110,0.6)';
  ctx.lineWidth = Math.max(2, 66 * k);
  for (const pts of world.roads) {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(mx(px), my(py)) : ctx.moveTo(mx(px), my(py))));
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  ctx.beginPath();
  for (const [lx, ly, lr] of world.lakes) { ctx.moveTo(mx(lx) + lr * k, my(ly)); ctx.arc(mx(lx), my(ly), lr * k, 0, TAU); }
  ctx.fillStyle = '#3c7fb6';
  ctx.fill();
  for (const c of world.cities) {
    ctx.beginPath();
    ctx.arc(mx(c.x), my(c.y), c.r * k, 0, TAU);
    ctx.fillStyle = 'rgba(140,128,105,0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,60,45,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
    text(c.name, mx(c.x), my(c.y) + 3, { size: 9, bold: true, align: 'center', color: 'rgba(255,245,220,0.85)' });
  }
}

