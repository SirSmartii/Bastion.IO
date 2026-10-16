// HUD: Uhr, Hinweise, Bestenliste, Status unten links, Hotbar, Minimap – und darüber die offenen Fenster.

import { ctx, cfg, me, myId, account, clock, leaderboard, online, minimap, hovered, ui, mouse, now, W, H, dpr } from '../state.js';
import { TAU } from '../constants.js';
import { circle, rrect, text, panel, inRect, fmtClock } from '../draw/primitives.js';
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

export const logoutRect = () => ({ x: 14, y: 14, w: 112, h: 32 });

// HOTBAR_SIZE Item-Slots und dahinter (mit etwas Abstand) der Bau-Button
export function hotbarRects() {
  const n = cfg ? cfg.HOTBAR_SIZE : 6, size = 60, gap = 6, sep = 18;
  const total = (n + 1) * size + n * gap + sep;
  const x0 = Math.round(W / 2 - total / 2), y = H - size - 30;
  const rects = [];
  for (let i = 0; i < n; i++) rects.push({ x: x0 + i * (size + gap), y, w: size, h: size });
  rects.push({ x: x0 + n * (size + gap) + sep, y, w: size, h: size });
  return rects;
}

export function drawHud() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const toastY = drawClockAndBadge();
  toasts.forEach((t, i) => {
    ctx.globalAlpha = Math.min(1, t.life);
    text(t.text, W / 2, toastY + i * 26, { size: 17, bold: true, align: 'center', color: '#fff' });
    ctx.globalAlpha = 1;
  });
  drawAccountBar();
  drawLeaderboard();
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
  if (ui.panel && (!me.dead || ui.panel === 'team' || ui.panel === 'map')) panels[ui.panel].draw();

  if (me.dead) {
    ctx.fillStyle = 'rgba(40,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    text('Du wurdest überrannt!', W / 2, H / 2 - 10, { size: 40, bold: true, align: 'center', color: '#ff6b6b' });
    text(`Respawn in ${Math.ceil(me.rt)}s ${me.core ? 'an deiner Basis' : ''}`, W / 2, H / 2 + 28, { size: 18, align: 'center' });
  }
}

// Tag/Nacht-Uhr und darunter ein Hinweis (Verfall, Spawnschutz, ruhige Nacht). Liefert y für die Meldungen.
function drawClockAndBadge() {
  const [day, night, progress] = clock;
  panel(W / 2 - 130, 14, 260, 52);
  text(`${night ? '🌙 Nacht' : '☀️ Tag'} ${day}`, W / 2, 38, { size: 17, bold: true, align: 'center', color: night ? '#a9b8ff' : '#ffe08a' });
  rrect(W / 2 - 110, 46, 220, 8, 4, 'rgba(255,255,255,0.12)');
  rrect(W / 2 - 110, 46, 220 * progress, 8, 4, night ? '#6f7fe0' : '#f5c84a');

  let badge = null;
  if (me.up && me.up.d) {
    const blink = Math.floor(now * 2) % 2 === 0;
    badge = ['⚠ Deine Basis verfällt – Holz/Stein/Gold in den Basis-Kern legen [F]', blink ? 'rgba(140,30,20,0.9)' : 'rgba(110,25,18,0.9)', '#ffd9d0'];
  } else if (me.prot > 0) badge = [`🛡 Spawnschutz – noch ${fmtClock(me.prot)}`, 'rgba(40,90,130,0.85)', '#cfeeff'];
  else if (me.calm > 0) badge = [`🌙 Ruhige erste Nacht – wenige Gegner (${fmtClock(me.calm)})`, 'rgba(50,50,100,0.85)', '#d6d9ff'];
  if (!badge) return 96;

  const [label, background, color] = badge;
  ctx.font = 'bold 13px Segoe UI, sans-serif';
  const bw = ctx.measureText(label).width + 24;
  rrect(W / 2 - bw / 2, 72, bw, 24, 12, background, 'rgba(255,255,255,0.25)', 1.5);
  text(label, W / 2, 89, { size: 13, bold: true, align: 'center', color });
  return 122;
}

// Ausloggen-Knopf und ob gespeichert wird
function drawAccountBar() {
  const r = logoutRect(), hover = inRect(mouse.x, mouse.y, r);
  rrect(r.x, r.y, r.w, r.h, 8, hover ? 'rgba(160,60,40,0.85)' : 'rgba(10,14,8,0.62)', 'rgba(255,255,255,0.12)', 1.5);
  text('⏻ Ausloggen', r.x + r.w / 2, r.y + 21, { size: 13, bold: true, align: 'center', color: '#fff' });
  text(account ? `👤 ${account} · wird gespeichert` : '👤 Gast · wird nicht gespeichert', r.x + r.w + 10, r.y + 21, { size: 12, color: account ? '#9fe870' : '#c9a69e' });
}

function drawLeaderboard() {
  const w = 220;
  panel(W - w - 14, 14, w, 40 + leaderboard.length * 22);
  text(`Bestenliste · ${online} online`, W - w, 38, { size: 14, bold: true, color: '#ffe08a' });
  leaderboard.forEach(([id, name, score], i) => {
    const color = id === myId ? '#9fe870' : '#fff';
    text(`${i + 1}. ${name}`, W - w, 62 + i * 22, { size: 14, color });
    text(String(score), W - 28, 62 + i * 22, { size: 14, color, align: 'right' });
  });
}

// Statusfeld unten links: Leben, Ausdauer, Werte, Schmiede, Basis, Punkte
function drawStatus() {
  panel(14, H - 186, 330, 172);
  drawNeeds(28, H - 160);
  const hpFrac = me.hp / me.maxHp;
  text('Leben', 28, H - 134, { size: 13, color: '#cfd8c0' });
  rrect(80, H - 146, 250, 16, 8, 'rgba(0,0,0,0.5)');
  rrect(82, H - 144, 246 * hpFrac, 12, 6, hpFrac > 0.35 ? '#7ed957' : '#e05555');
  text(`${Math.round(me.hp)}/${me.maxHp}`, 205, H - 134, { size: 11, bold: true, align: 'center' });

  text('Ausdauer', 28, H - 110, { size: 13, color: me.ex ? '#ff8a7a' : '#cfd8c0' });
  rrect(92, H - 120, 238, 12, 6, 'rgba(0,0,0,0.5)');
  rrect(94, H - 118, 234 * (me.st / me.stats.stamina), 8, 4, me.ex ? '#e05555' : '#f5c84a');
  text(me.ex ? 'erschöpft' : '[Shift] sprinten', 330, H - 98, { size: 10, color: me.ex ? '#ff8a7a' : '#8f9c80', align: 'right' });

  const st = me.stats;
  text(`⚔ ${st.damage}  🛡 ${st.armor}  👟 ${st.speed}  ·  [C] Charakter`, 28, H - 86, { size: 13 });
  if (me.forge) text('⚒️ Äxte & Kleidung: an der Schmiede [F]', 28, H - 66, { size: 13, color: '#cfd8c0' });
  else text('⚒️ Baue eine Schmiede [B] für Äxte & Kleidung', 28, H - 66, { size: 13, color: '#c9a69e' });

  if (me.core) {
    const base = `🏰 Basis Lv ${me.core[3] + 1} · Gebäude ${me.count}/${me.max} · `;
    text(base, 28, H - 46, { size: 13, color: '#cfd8c0' });
    const [supply, color] = !me.up ? ['', ''] : me.up.d ? ['⚠ Verfall!', '#ff8a7a'] : [`⏳ ${supplyText(me.up)}`, me.up.n < 2 ? '#ffb36a' : '#cfd8c0'];
    ctx.font = '13px Segoe UI, sans-serif';
    text(supply, 28 + ctx.measureText(base).width, H - 46, { size: 13, bold: true, color });
  } else text('🏰 Noch keine Basis', 28, H - 46, { size: 13, color: '#ff9a7a' });
  text(`🏆 ${me.score}   💀 ${me.kills}`, 28, H - 26, { size: 13, color: '#cfd8c0' });
  text('[Tab] Inventar', 330, H - 26, { size: 12, color: '#a8b597', align: 'right' });
}

// Hunger & Durst als zwei halbe Leisten über dem Leben; unter warnAt blinken sie rot
function drawNeeds(x, y) {
  const S = cfg.SURVIVAL, blink = Math.sin(now * 8) > 0;
  const bar = (bx, label, v, color) => {
    const low = v <= S.warnAt;
    text(label, bx, y + 4, { size: 13, color: low && blink ? '#ff8a7a' : '#cfd8c0' });
    rrect(bx + 28, y - 7, 112, 14, 7, 'rgba(0,0,0,0.5)');
    if (v > 0) rrect(bx + 30, y - 5, Math.max(4, 108 * (v / S.max)), 10, 5, low ? '#e05555' : color);
    text(String(Math.round(v)), bx + 84, y + 4, { size: 10, bold: true, align: 'center' });
  };
  bar(x, '🍖', me.hu ?? S.max, '#e8a34a');
  bar(x + 154, '💧', me.th ?? S.max, '#5bb8f0');
}

// ---------- Hotbar ----------

function drawHotbar() {
  const rects = hotbarRects();
  const slotBackground = (r, active, border) => rrect(r.x, r.y, r.w, r.h, 10, active ? 'rgba(255,230,140,0.28)' : 'rgba(10,14,8,0.62)',
    border || (active ? '#ffd76a' : 'rgba(255,255,255,0.12)'), active ? 3 : 2);
  const hoverSlot = rects.findIndex((r) => inRect(mouse.x, mouse.y, r));
  const draggingItem = ui.drag && ui.drag.slot !== undefined;

  for (let i = 0; i < cfg.HOTBAR_SIZE; i++) {
    const r = rects[i], item = me.hb[i];
    const def = item && cfg.EQUIPMENT[item];
    const equipped = def && me.eq[def.slot] === item;
    const count = item ? me.res[item] || 0 : 0;
    // Aktiv = ausgerüstete Waffe bzw. gewählte Munition
    const active = !!item && ui.selected === 0 && ((equipped && def.slot === 'weapon') || item === me.ammo);
    slotBackground(r, active, draggingItem && hoverSlot === i ? '#9fe870' : equipped ? '#9fe870' : null);
    text(String(i + 1), r.x + 6, r.y + 15, { size: 11, color: '#ddd', bold: true });
    if (!item) continue;
    ctx.globalAlpha = equipped || count > 0 ? 1 : 0.35;
    drawItemIcon(item, r.x + r.w / 2, r.y + r.h / 2 - 3, 36);
    ctx.globalAlpha = 1;
    if (!def) text(String(count), r.x + r.w - 5, r.y + r.h - 6, { size: 12, bold: true, align: 'right', color: count ? '#fff' : '#ff8a7a' });
    else if (equipped) text('E', r.x + r.w - 6, r.y + 15, { size: 11, bold: true, align: 'right', color: '#9fe870' });
    if (equipped && def.ammo) {
      // Fernwaffe: Munitionsvorrat in der Ecke
      const ammo = me.res[me.ammo] || 0;
      text(String(ammo), r.x + r.w - 5, r.y + r.h - 6, { size: 11, bold: true, align: 'right', color: ammo ? '#fff' : '#ff8a7a' });
      drawItemIcon(me.ammo, r.x + 12, r.y + r.h - 11, 13);
    }
    if (hoverSlot === i && !ui.drag) text(itemName(item), r.x + r.w / 2, r.y - 8, { size: 12, bold: true, align: 'center' });
  }
  if (me.stats.ranged) {
    const kinds = cfg.AMMO[me.stats.ammo].types.filter((t) => (me.res[t.item] || 0) > 0).length;
    if (kinds > 1) text(`[R] ${itemName(me.ammo)}`, rects[0].x, rects[0].y - 26, { size: 11, bold: true, color: '#ffd76a' });
  }
  if (ui.inv) text('Item auf einen Slot ziehen oder mit Maus drauf 1–6 drücken · Rechtsklick leert', W / 2, rects[0].y - 40, { size: 11, align: 'center', color: '#cfd8c0' });

  drawBuildButton(rects[cfg.HOTBAR_SIZE], slotBackground);
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
  text('B', r.x + 6, r.y + 15, { size: 11, color: '#ddd', bold: true });
  text(type ? cfg.STRUCTURES[type].name : 'Bauen', r.x + r.w / 2, r.y + r.h - 6, { size: 11, align: 'center' });
  if (type) {
    const cost = cfg.STRUCTURES[type].levels[0].cost;
    text(fmtCost(cost), r.x + r.w / 2, r.y + r.h + 15, { size: 11, color: canAfford(cost) ? '#e8e8e8' : '#ff8a7a', align: 'center' });
  }
}

// EP-Leiste direkt über der Hotbar
function drawXpBar(rects) {
  const last = rects[cfg.HOTBAR_SIZE], x = rects[0].x, w = last.x + last.w - x, y = rects[0].y - 14;
  rrect(x, y, w, 8, 4, 'rgba(0,0,0,0.55)');
  rrect(x + 1.5, y + 1.5, Math.max(0, (w - 3) * Math.min(1, me.xp / me.xpNext)), 5, 2.5, '#7fc4ff');
  text(`Lv ${me.lvl}`, x - 8, y + 8, { size: 13, bold: true, align: 'right', color: '#ffd76a' });
  text(`${me.xp}/${me.xpNext} EP`, x + w + 8, y + 8, { size: 11, color: '#cfd8c0' });
  if (me.sp > 0) text(`+${me.sp} Skillpunkt${me.sp > 1 ? 'e' : ''} [K]`, x + w / 2, y - 4, { size: 12, bold: true, align: 'center', color: '#ffd76a' });
}

// ---------- Minimap ----------

// Radar um den Spieler: zeigt ±MINIMAP_RANGE Welteinheiten
function drawMinimap() {
  const size = 190, x = W - size - 14, y = H - size - 14, R = cfg.MINIMAP_RANGE, k = size / (2 * R);
  const mx = (wx) => x + size / 2 + (wx - me.x) * k, my = (wy) => y + size / 2 + (wy - me.y) * k;
  rrect(x, y, size, size, 10, 'rgba(32,48,24,0.92)', 'rgba(255,255,255,0.15)', 2);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 10);
  ctx.clip();
  // Außerhalb der Welt dunkel
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = 'rgba(52,78,38,0.95)';
  ctx.fillRect(mx(0), my(0), cfg.WORLD_SIZE * k, cfg.WORLD_SIZE * k);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (const r of [R / 3, (2 * R) / 3]) {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, r * k, 0, TAU);
    ctx.stroke();
  }
  if (me.core) {
    ctx.beginPath();
    ctx.arc(mx(me.core[1]), my(me.core[2]), me.core[4] * k, 0, TAU);
    ctx.fillStyle = 'rgba(120,200,255,0.25)';
    ctx.fill();
    rrect(mx(me.core[1]) - 4, my(me.core[2]) - 4, 8, 8, 2, '#86e6ff');
  }
  drawMinimapTerrain(mx, my, k);
  if (me.forge) rrect(mx(me.forge[1]) - 2.5, my(me.forge[2]) - 2.5, 5, 5, 1, '#ff9a3c');
  const e = minimap.e;
  for (let i = 0; i < e.length; i += 3) {
    const hostile = e[i + 2];
    circle(mx(e[i] * 10), my(e[i + 1] * 10), hostile ? 2.6 : 2, hostile ? '#ff3b3b' : 'rgba(240,170,165,0.75)');
  }
  const strangers = minimap.p;
  for (let i = 0; i < strangers.length; i += 2) circle(mx(strangers[i] * 10), my(strangers[i + 1] * 10), 3, '#ffe08a', '#000', 1);
  for (const [, , tx, ty, , dead] of teammates()) if (!dead) circle(mx(tx), my(ty), 3.5, '#7fe0a0', '#000', 1);
  circle(x + size / 2, y + size / 2, 4, '#fff', '#000', 1.5);
  ctx.restore();

  // Legende
  const legend = me.team ? [['#ff3b3b', 'Feind'], ['#ffe08a', 'Spieler'], ['#7fe0a0', 'Team']] : [['#ff3b3b', 'Feind'], ['#ffe08a', 'Spieler']];
  ctx.font = '10px Segoe UI, sans-serif';
  ctx.textAlign = 'left';
  let lx = x + 8;
  for (const [color, label] of legend) {
    ctx.fillStyle = color;
    ctx.fillText('●', lx, y + size - 8);
    lx += ctx.measureText('● ').width;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(label, lx, y + size - 8);
    lx += ctx.measureText(label + ' ').width + 2;
  }
  text('[M] Karte', x + size - 8, y + size - 8, { size: 10, color: 'rgba(255,255,255,0.55)', align: 'right' });
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
