// Fertigkeiten [K]: Skillpunkte aus Level-Ups verteilen.

import { cfg, me, ui, mouse, W, H } from '../state.js';
import { rrect, text, inRect } from '../draw/primitives.js';
import { send } from '../net.js';
import { t } from '../i18n.js';

export function layout() {
  const cols = 2, cardW = 330, cardH = 78, gap = 10, pad = 18, head = 50;
  const rows = Math.ceil(cfg.SKILLS.length / cols);
  const w = pad * 2 + cols * cardW + gap, h = head + rows * (cardH + gap) + pad;
  const x = Math.round(W / 2 - w / 2), y = Math.round(Math.max(60, H / 2 - h / 2 - 40));
  const cards = cfg.SKILLS.map((skill, i) => {
    const rect = { x: x + pad + (i % cols) * (cardW + gap), y: y + head + Math.floor(i / cols) * (cardH + gap), w: cardW, h: cardH };
    return { skill, rect, btn: { x: rect.x + rect.w - 44, y: rect.y + rect.h / 2 - 17, w: 34, h: 34 } };
  });
  return { panel: { x, y, w, h }, cards };
}

export function onClick(x, y) {
  const L = layout();
  const card = L.cards.find((c) => inRect(x, y, c.btn));
  if (card) send({ t: 'skill', id: card.skill.id });
  else if (!inRect(x, y, L.panel)) ui.panel = null;
}

export function draw() {
  const { panel: P, cards } = layout();
  rrect(P.x, P.y, P.w, P.h, 14, 'rgba(18,24,14,0.96)', '#4b5d38', 3);
  text(t('✨ Fertigkeiten'), P.x + 18, P.y + 32, { size: 18, bold: true, color: '#f2d27a' });
  text(t(me.sp === 1 ? 'Level {lv} · {n} Punkt frei · [K] schließen' : 'Level {lv} · {n} Punkte frei · [K] schließen', { lv: me.lvl, n: me.sp }), P.x + P.w - 18, P.y + 32,
    { size: 13, color: me.sp ? '#ffd76a' : '#a8b597', align: 'right', bold: !!me.sp });
  for (const { skill, rect: r, btn } of cards) {
    const rank = me.skills[skill.id] || 0, maxed = rank >= skill.max, canLearn = me.sp > 0 && !maxed;
    rrect(r.x, r.y, r.w, r.h, 10, 'rgba(0,0,0,0.32)', rank ? 'rgba(159,232,112,0.45)' : 'rgba(255,255,255,0.1)', 2);
    text(skill.icon, r.x + 26, r.y + 46, { size: 26, align: 'center' });
    text(skill.name, r.x + 52, r.y + 26, { size: 15, bold: true });
    text(t('{desc} pro Rang', { desc: skill.desc }), r.x + 52, r.y + 45, { size: 12, color: '#b9c4aa' });
    for (let k = 0; k < skill.max; k++) rrect(r.x + 52 + k * 22, r.y + 56, 18, 8, 3, k < rank ? '#9fe870' : 'rgba(255,255,255,0.12)');
    const hover = inRect(mouse.x, mouse.y, btn);
    rrect(btn.x, btn.y, btn.w, btn.h, 8, canLearn ? (hover ? '#92c453' : '#7fae45') : 'rgba(255,255,255,0.08)', canLearn ? '#5a8130' : 'rgba(255,255,255,0.1)', 2);
    text(maxed ? '✓' : '+', btn.x + btn.w / 2, btn.y + 25, { size: 20, bold: true, align: 'center', color: canLearn ? '#13200a' : maxed ? '#9fe870' : '#777' });
  }
}
