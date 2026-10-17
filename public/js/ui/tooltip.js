// Tooltips für Items (in Fenstern) und Gebäude (unter der Maus).
// Item-Tooltips werden gesammelt und erst nach allen Fenstern gezeichnet, damit nichts sie verdeckt.

import { ctx, cfg, me, myId, ui, mouse, W, H } from '../state.js';
import { LEVEL_NAMES } from '../constants.js';
import { panel, text } from '../draw/primitives.js';
import { itemName, fmtStats, gearName, gearLines, rarityOf } from '../draw/items.js';
import { canAfford } from '../rules.js';
import { fmtCost } from './format.js';
import { t, dec } from '../i18n.js';

// lines: [[Text, Farbe, fett?], …] als Kasten neben der Maus
function drawTooltipBox(lines, lineH = 20) {
  ctx.font = '14px Segoe UI, sans-serif';
  const w = Math.max(...lines.map(([s]) => ctx.measureText(s).width)) + 24, h = lines.length * lineH + 12;
  let x = mouse.x + 16, y = mouse.y + 16;
  if (x + w > W) x = mouse.x - w - 10;
  if (y + h > H) y = mouse.y - h - 10;
  panel(x, y, w, h);
  lines.forEach(([s, color, bold], i) => text(s, x + 12, y + 22 + i * lineH, { size: 14, color, bold }));
}

// Beliebige Zeilen als Tooltip (wird nach allen Fenstern gezeichnet)
export function tooltipLines(lines) {
  drawTooltipBox(lines);
}

// d: Daten eines Ausrüstungs-Einzelstücks (Seltenheit, Stufe, Boni)
export function itemTooltip(item, extraLines, d) {
  ui.pendingTooltip = () => {
    const def = cfg.EQUIPMENT[item];
    const lines = [[def ? gearName(item, d) : itemName(item), def ? (d && d.r ? rarityOf(d).color : '#ffe08a') : '#ffe08a', true]];
    if (def) {
      lines.push([cfg.EQUIP_SLOTS.find((s) => s.id === def.slot).name, '#a8b597']);
      lines.push([fmtStats(def, d), '#cfd8c0']);
      lines.push(...gearLines(d));
    }
    drawTooltipBox(lines.concat(extraLines || []));
  };
}

export function drawPendingTooltip() {
  if (!ui.pendingTooltip) return;
  ui.pendingTooltip();
  ui.pendingTooltip = null;
}

// Werte eines Gebäudes auf einer Stufe (für "jetzt" und "nach dem Upgrade")
function structureStats(type, def, level) {
  switch (type) {
    case 'turret': return t('Schaden {dmg} · Reichweite {range} · {rate}/s', { dmg: level.dmg, range: level.range, rate: dec(level.rate) });
    case 'spike': return t('Schaden {dmg}', { dmg: level.dmg });
    case 'mine': return t('+{income} alle {n}s', { income: fmtCost(level.income), n: def.interval });
    case 'core': return t('Radius {r} · Limit {max} · Lager {n}', { r: level.radius, max: level.maxStructures, n: level.slots });
    case 'storage': return t('{n} Plätze', { n: level.slots });
    case 'furnace': return t('{n} Plätze · Barren alle {s} s', { n: level.slots, s: dec(level.time) }) + (def.levels.indexOf(level) + 1 >= 3 ? t(' · Stahl') : '');
    case 'tanner': return t('{n} Plätze · 1 Leder alle {s} s', { n: level.slots, s: level.time });
    case 'sleeping_bag': return t('Aufwachen nach dem Tod · danach {n} s gesperrt', { n: def.cooldown });
    case 'campfire': return t('{n} Plätze · brät alle {s} s · verscheucht Tiere', { n: level.slots, s: level.time });
    case 'forge': {
      const forgeLevel = def.levels.indexOf(level) + 1;
      const recipes = [...Object.values(cfg.EQUIPMENT), ...Object.values(cfg.ITEMS.recipes).map((recipe) => ({ recipe }))];
      return t('{n} Rezepte freigeschaltet', { n: recipes.filter((e) => e.recipe && e.recipe.forge <= forgeLevel).length });
    }
    default: return null;
  }
}

const INTERACT_HINTS = {
  forge: '[F] Schmiede öffnen (in der Nähe)',
  storage: '[F] Truhe öffnen (in der Nähe)',
  furnace: '[F] Ofen öffnen: Erze + Kohle → Barren, Bronze, Stahl',
  tanner: '[F] Gerbgestell: Fell hinein → Leder',
  core: '[F] Kern-Lager: Unterhalt einlagern',
  campfire: '[F] Lagerfeuer: Holz & Rohes hinein',
};

export function drawStructureTooltip(s) {
  const def = cfg.STRUCTURES[s.type], current = def.levels[s.level], next = def.levels[s.level + 1];
  const lines = [[`${def.name} · Lv ${s.level + 1} (${t(LEVEL_NAMES[s.level])})`, '#ffe08a', true], [`HP ${s.hp} / ${s.maxHp}`, '#fff']];
  const stats = structureStats(s.type, def, current);
  if (stats) lines.push([stats, '#cfd8c0']);
  if (s.owner === myId) {
    if (!next) lines.push([t('Maximales Level'), '#ffe08a']);
    else if (s.type !== 'core' && me.core && s.level + 1 > me.core[3]) lines.push([t('Kern upgraden, um weiter zu verbessern'), '#ff9a7a']);
    else {
      const nextStats = structureStats(s.type, def, next);
      lines.push([t('[E] Upgrade: {cost}', { cost: fmtCost(next.cost) }), canAfford(next.cost) ? '#9fe870' : '#ff9a7a']);
      lines.push([`→ HP ${next.hp}${nextStats ? ' · ' + nextStats : ''}`, '#aab6a0']);
    }
    if (s.hp < s.maxHp) lines.push([t('Axt-Schlag repariert ({n}🪵)', { n: 2 + s.level * 2 }), '#cfd8c0']);
    if (INTERACT_HINTS[s.type]) lines.push([t(INTERACT_HINTS[s.type]), '#ffd76a']);
    lines.push([t('[X] Abreißen'), '#aab6a0']);
  }
  drawTooltipBox(lines);
}
