// Chat: Eingabefeld (Enter), Verlauf unten links und Sprechblasen über den Köpfen.

import { ctx, H, now, keys, mouse, myId } from './state.js';
import { panel, wrapText } from './draw/primitives.js';
import { t } from './i18n.js';

export const chatInput = document.getElementById('chat');
export const chatLog = []; // { name, text, team, mine, t }
export const bubbles = new Map(); // Spieler-ID -> { text, t }

const VISIBLE_SECONDS = 12;

export const isTyping = () => document.activeElement === chatInput;

export function openChat() {
  keys.clear(); // Figur bleibt stehen, solange getippt wird
  mouse.down = false;
  chatInput.value = '';
  chatInput.classList.add('open');
  chatInput.classList.remove('team');
  chatInput.focus();
}

export function closeChat() {
  chatInput.value = '';
  chatInput.classList.remove('open');
  chatInput.blur();
}

// Teamchat-Präfix farbig markieren
chatInput.addEventListener('input', () => chatInput.classList.toggle('team', /^\/t(eam)?(\s|$)/i.test(chatInput.value)));
chatInput.addEventListener('blur', () => chatInput.classList.remove('open'));

// Nachricht vom Server { id, name, text, team }
export function addChatMessage(m) {
  chatLog.push({ name: m.name, text: m.text, team: m.team, mine: m.id === myId, t: now });
  if (chatLog.length > 40) chatLog.shift();
  if (!m.team) bubbles.set(m.id, { text: m.text, t: now });
}

export function clearChat() {
  closeChat();
  chatLog.length = 0;
  bubbles.clear();
}

// Die letzten Nachrichten über dem Statusfeld; beim Tippen mehr und mit Hintergrund
export function drawChatLog() {
  const typing = isTyping();
  const x = 14, w = 330, lineH = 19, bottom = H - 172 - (typing ? 40 : 0);
  const shown = chatLog.filter((c) => typing || now - c.t < VISIBLE_SECONDS).slice(typing ? -10 : -6);
  if (!shown.length) return;

  // Lange Nachrichten umbrechen
  ctx.font = '13px Segoe UI, sans-serif';
  const lines = [];
  for (const c of shown) {
    const prefix = `${c.team ? t('[Team] ') : ''}${c.name}: `;
    const alpha = typing ? 1 : Math.min(1, (VISIBLE_SECONDS - (now - c.t)) / 2);
    wrapText(prefix + c.text, w - 20).forEach((line, i) => lines.push({ line, c, first: i === 0, alpha, prefix }));
  }
  const h = lines.length * lineH + 12;
  if (typing) panel(x, bottom - h, w, h);

  lines.forEach(({ line, c, first, alpha, prefix }, i) => {
    const y = bottom - h + 20 + i * lineH;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.textAlign = 'left';
    let tx = x + 10, rest = line;
    if (first) {
      // Name fett und farbig, danach die Nachricht
      ctx.font = 'bold 13px Segoe UI, sans-serif';
      ctx.fillStyle = c.mine ? '#9fe870' : c.team ? '#6fd6ff' : '#ffe08a';
      ctx.strokeText(prefix, tx, y);
      ctx.fillText(prefix, tx, y);
      tx += ctx.measureText(prefix).width;
      rest = line.slice(prefix.length);
    }
    ctx.font = '13px Segoe UI, sans-serif';
    ctx.strokeText(rest, tx, y);
    ctx.fillStyle = c.team ? '#7fd6ff' : '#fff';
    ctx.fillText(rest, tx, y);
  });
  ctx.globalAlpha = 1;
}
