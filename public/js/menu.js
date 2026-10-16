// Startmenü: Einloggen, Registrieren oder als Gast spielen.

import { sendAuth } from './net.js';

const menu = document.getElementById('menu');
export const nameInput = document.getElementById('name');
export const passInput = document.getElementById('pass');
const info = document.getElementById('menu-info');

try { nameInput.value = localStorage.getItem('bastion-name') || ''; } catch (_) { /* privater Modus */ }

// type: 'login' | 'register' | 'join' (Gast)
function start(type) {
  const name = nameInput.value.trim();
  try { localStorage.setItem('bastion-name', name); } catch (_) { /* privater Modus */ }
  if (type !== 'join' && (!name || !passInput.value)) return showMenuMessage('Name und Passwort eingeben.');
  showMenuMessage(type === 'register' ? 'Account wird angelegt…' : 'Verbinde…');
  sendAuth(type === 'join' ? { t: type, name } : { t: type, user: name, pass: passInput.value });
}

document.getElementById('play').addEventListener('click', () => start('login'));
document.getElementById('register').addEventListener('click', () => start('register'));
document.getElementById('guest').addEventListener('click', () => start('join'));
for (const input of [nameInput, passInput]) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') start('login'); });

export function showMenuMessage(text, success = false) {
  info.textContent = text;
  info.className = success ? 'ok' : '';
}

export function showMenu() {
  menu.classList.remove('hidden');
  passInput.value = '';
}

export function hideMenu() {
  menu.classList.add('hidden');
  // Nach dem Login per Enter stünde der Fokus sonst noch im versteckten Feld – und das Spiel ignorierte alle Tasten
  if (menuHasFocus()) document.activeElement.blur();
  showMenuMessage('');
}

export const menuHasFocus = () => document.activeElement === nameInput || document.activeElement === passInput;
