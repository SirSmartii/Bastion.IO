// Team-Fenster [T]: Mitglieder, Einladungen und Spieler in der Nähe.

import { ctx, cfg, me, myId, players, ui, mouse, W, H } from '../state.js';
import { rrect, text, inRect } from '../draw/primitives.js';
import { send } from '../net.js';

const WIDTH = 440, PAD = 18, ROW = 36;

// Zeilen und Buttons (gemeinsam für Zeichnen & Klicks). Zeilen-y zuerst relativ, am Ende verschoben.
// Auch im Tod offen lassen (hud.js)
export const whileDead = true;

export function layout() {
  const x = Math.round(W / 2 - WIDTH / 2), right = x + WIDTH - PAD;
  const team = me.team, rows = [], buttons = [];
  let y = 52;
  const section = (title) => { rows.push({ kind: 'title', y, text: title }); y += 26; };
  // Button rechtsbündig bei bx; liefert die x-Position für den nächsten Button links daneben
  const button = (label, msg, color, rowY, bx) => {
    ctx.font = 'bold 12px Segoe UI, sans-serif';
    const bw = ctx.measureText(label).width + 20;
    const rect = { x: bx - bw, y: rowY + 6, w: bw, h: ROW - 12 };
    buttons.push({ rect, label, msg, color });
    return rect.x - 6;
  };

  if (team) {
    section(`${team.name} · ${team.m.length}/${cfg.TEAM.maxSize}`);
    for (const member of team.m) {
      rows.push({ kind: 'member', y, member, leader: member[0] === team.leader });
      if (team.leader === myId && member[0] !== myId) button('Entfernen', { t: 'tkick', id: member[0] }, '#b4553f', y, right);
      y += ROW;
    }
    y += 4;
    button('Team verlassen', { t: 'tleave' }, '#b4553f', y, right);
    rows.push({ kind: 'hint', y: y + 23, text: 'Teamchat: [Enter] → „/t Nachricht“' });
    y += ROW + 6;
  } else {
    rows.push({ kind: 'hint', y: y + 4, text: 'Du bist in keinem Team. Lade Spieler in deiner Nähe ein!' });
    y += 30;
  }

  if (me.ti.length) {
    section('Einladungen');
    for (const [id, name] of me.ti) {
      rows.push({ kind: 'invite', y, name });
      const nextX = button('Ablehnen', { t: 'tdec', id }, '#6b6b60', y, right);
      button('Annehmen', { t: 'tacc', id }, '#7fae45', y, nextX);
      y += ROW;
    }
  }

  const memberIds = new Set(team ? team.m.map((m) => m[0]) : []);
  const nearby = [...players.values()].filter((p) => p.id !== myId && !memberIds.has(p.id))
    .map((p) => ({ p, d: Math.hypot(p.x - me.x, p.y - me.y) })).sort((a, b) => a.d - b.d).slice(0, 6);
  const teamFull = team && team.m.length >= cfg.TEAM.maxSize;
  section('Spieler in der Nähe');
  if (!nearby.length) { rows.push({ kind: 'hint', y: y + 4, text: 'Niemand in Sichtweite.' }); y += 30; }
  for (const { p, d } of nearby) {
    rows.push({ kind: 'near', y, p, d });
    if (!p.team && !teamFull) button('Einladen', { t: 'tinv', id: p.id }, '#7fae45', y, right);
    y += ROW;
  }

  const h = y + 40, top = Math.round(Math.max(70, H / 2 - h / 2 - 30));
  for (const r of rows) r.y += top;
  for (const b of buttons) b.rect.y += top;
  return { panel: { x, y: top, w: WIDTH, h }, rows, buttons };
}

export function onClick(x, y) {
  const L = layout();
  const btn = L.buttons.find((b) => inRect(x, y, b.rect));
  if (btn) send(btn.msg);
  else if (!inRect(x, y, L.panel)) ui.panel = null;
}

export function draw() {
  const { panel: P, rows, buttons } = layout();
  rrect(P.x, P.y, P.w, P.h, 14, 'rgba(18,24,14,0.95)', '#4b5d38', 3);
  text('👥 Team', P.x + PAD, P.y + 29, { size: 18, bold: true, color: '#f2d27a' });
  text('[T] schließen', P.x + P.w - PAD, P.y + 29, { size: 12, color: '#a8b597', align: 'right' });
  const L = P.x + PAD;
  for (const r of rows) {
    if (r.kind === 'title') { text(r.text, L, r.y + 16, { size: 14, bold: true, color: '#e9eedd' }); continue; }
    if (r.kind === 'hint') { text(r.text, L, r.y + 14, { size: 13, color: '#a8b597' }); continue; }
    rrect(L - 6, r.y + 2, P.w - PAD * 2 + 12, ROW - 4, 7, 'rgba(0,0,0,0.28)');
    if (r.kind === 'member') {
      const [id, name, mx, my, hp, dead] = r.member;
      text(`${r.leader ? '👑 ' : ''}${name}${id === myId ? ' (du)' : ''}`, L + 4, r.y + 23, { size: 14, bold: true, color: '#7fe0a0' });
      rrect(L + 170, r.y + 14, 80, 8, 4, 'rgba(0,0,0,0.5)');
      if (!dead) rrect(L + 170, r.y + 14, 80 * hp, 8, 4, hp > 0.35 ? '#7ed957' : '#e05555');
      const info = dead ? '💀 tot' : id === myId ? '' : `${Math.round(Math.hypot(mx - me.x, my - me.y) / 10)} m`;
      text(info, L + 262, r.y + 23, { size: 12, color: '#cfd8c0' });
    } else if (r.kind === 'invite') {
      text(`${r.name} lädt dich ein`, L + 4, r.y + 23, { size: 14, color: '#fff' });
    } else if (r.kind === 'near') {
      text(r.p.name, L + 4, r.y + 23, { size: 14, color: '#ffe9b0' });
      text(r.p.team ? 'in einem Team' : `${Math.round(r.d / 10)} m`, L + 170, r.y + 23, { size: 12, color: '#a8b597' });
    }
  }
  for (const b of buttons) {
    const hover = inRect(mouse.x, mouse.y, b.rect);
    rrect(b.rect.x, b.rect.y, b.rect.w, b.rect.h, 6, b.color, hover ? '#fff' : 'rgba(0,0,0,0.4)', hover ? 2 : 1.5);
    text(b.label, b.rect.x + b.rect.w / 2, b.rect.y + 16, { size: 12, bold: true, align: 'center', color: '#fff' });
  }
  text('Team: kein Eigenbeschuss · Türen & Truhen teilen · auf der Karte sichtbar', P.x + P.w / 2, P.y + P.h - 14, { size: 11, color: '#8f9c80', align: 'center' });
}
