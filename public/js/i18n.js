// Sprachen: Deutsch ist die Quellsprache – alle Texte im Code (und die Namen in der Server-Config) sind deutsch
// und dienen als Schlüssel für die Wörterbücher in lang/*.js. t('Text {n}', { n: 3 }) übersetzt und setzt
// Platzhalter ein; Texte, die (noch) fehlen, bleiben deutsch.
//
// Platzhalter-Werte werden selbst nachgeschlagen (Item-Namen aus Server-Meldungen); eine Liste
// [[Anzahl, Name], …] wird zu "2× Holz, 1× Stein".

import en from './lang/en.js';
import pl from './lang/pl.js';

export const LANGS = [
  { id: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { id: 'en', name: 'English', flag: '🇬🇧' },
  { id: 'pl', name: 'Polski', flag: '🇵🇱' },
];
const DICTS = { de: null, en, pl };
const STORE = 'bastion-lang';

function initialLang() {
  try {
    const saved = localStorage.getItem(STORE);
    if (saved && saved in DICTS) return saved;
  } catch (_) { /* privater Modus */ }
  const nav = (navigator.language || 'de').slice(0, 2).toLowerCase();
  return nav in DICTS ? nav : 'en';
}

export let lang = initialLang();
let dict = DICTS[lang];
document.documentElement.lang = lang;

// Fehlende Übersetzungen (zum Prüfen: window.__i18nMissing in der Konsole)
const missing = new Set();
window.__i18nMissing = missing;

export function setLang(id) {
  if (!(id in DICTS)) return;
  lang = id;
  dict = DICTS[id];
  document.documentElement.lang = id;
  try { localStorage.setItem(STORE, id); } catch (_) { /* privater Modus */ }
}

function look(str) {
  if (!dict || typeof str !== 'string') return str;
  const out = dict[str];
  if (out !== undefined) return out;
  if (/[A-Za-zÄÖÜäöüß]/.test(str)) missing.add(str);
  return str;
}

function value(v) {
  if (Array.isArray(v)) return v.map((e) => (Array.isArray(e) ? `${e[0]}× ${look(e[1])}` : look(e))).join(', ');
  return typeof v === 'string' ? (dict && dict[v] !== undefined ? dict[v] : v) : v;
}

// Dezimalzahl: Komma im Deutschen und Polnischen, Punkt im Englischen
export const dec = (x) => (lang === 'en' ? String(x) : String(x).replace('.', ','));

export function t(str, vars) {
  let s = look(str);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? value(vars[k]) : m));
  return s;
}

// Die Server-Config einmal übersetzen: alle Texte (Namen, Beschreibungen …), die im Wörterbuch stehen
export function localizeConfig(obj) {
  if (!dict || !obj || typeof obj !== 'object') return obj;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'string') { if (dict[v] !== undefined) obj[k] = dict[v]; }
    else if (v && typeof v === 'object') localizeConfig(v);
  }
  return obj;
}

// Statische Texte im HTML (Hauptmenü): data-i18n = Text, data-i18n-ph = Platzhalter, data-i18n-html = mit Markup
export function localizeDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.dataset.i18nSrc ??= el.textContent;
    el.textContent = t(el.dataset.i18nSrc);
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    el.dataset.i18nSrc ??= el.innerHTML;
    el.innerHTML = t(el.dataset.i18nSrc);
  }
  for (const el of root.querySelectorAll('[data-i18n-ph]')) {
    el.dataset.i18nSrc ??= el.placeholder;
    el.placeholder = t(el.dataset.i18nSrc);
  }
}
