// Grafiken des Spiels: SVG-Dateien unter public/assets/, thematisch geordnet (items/, gear/, structures/,
// creatures/, player/, world/, ui/).
//
// Jede Datei bringt ihr eigenes Koordinatensystem mit (viewBox) – in denselben Einheiten, in denen das Spiel
// zeichnet. art('structures/wall', vars) setzt das Bild genau dorthin, also in die aktuelle Transformation
// (Ursprung, Drehung, Maßstab). Farbvarianten (Gebäude-Stufe, Waffen-Material, Fell/Eisen …) stehen in der
// Datei als Platzhalter $C, $D, $E … und werden beim Laden ersetzt.
//
// Firefox rastert SVG-Bilder bei jedem drawImage neu – deshalb wird jede Variante einmal in der benötigten
// Pixelgröße auf ein Zwischenbild gezeichnet und danach nur noch kopiert.

import { ctx } from './state.js';

const sources = new Map(); // Name -> { text, vb: [x, y, w, h] } (oder Promise beim Laden)
const images = new Map(); // Name|Variablen -> HTMLImageElement (null = lädt noch)
const sprites = new Map(); // Name|Variablen|Pixelstufe -> Canvas
let loaded = false;
// Zählt Zeichenversuche, bei denen die Grafik noch nicht bereit war – wer Ergebnisse zwischenspeichert
// (z. B. Figuren-Bilder in entities.js), darf das nur, wenn sich der Zähler dabei nicht verändert hat
export let artMisses = 0;

// Alle Dateien einmal laden (beim Start, siehe main.js). names: Liste ohne .svg
export async function loadAssets(names) {
  await Promise.all(names.map(async (name) => {
    const res = await fetch(`assets/${name}.svg`);
    if (!res.ok) throw new Error(`Grafik fehlt: ${name}`);
    const text = await res.text();
    const vb = (/viewBox="([^"]+)"/.exec(text) || [, '0 0 100 100'])[1].split(/[ ,]+/).map(Number);
    sources.set(name, { text, vb });
  }));
  loaded = true;
}

export const assetsLoaded = () => loaded;

function image(name, vars) {
  const key = vars ? `${name}|${Object.values(vars).join(',')}` : name;
  let img = images.get(key);
  if (img === undefined) {
    const src = sources.get(name);
    if (!src) {
      if (!loaded) return null; // Dateien laden noch – später erneut versuchen
      console.warn('Unbekannte Grafik', name);
      images.set(key, null);
      return null;
    }
    // Firefox zeichnet SVG-Bilder ohne feste Größe nicht auf ein Canvas: Breite & Höhe aus der viewBox ergänzen
    let text = /<svg[^>]*\swidth=/.test(src.text) ? src.text : src.text.replace('<svg ', `<svg width="${src.vb[2]}" height="${src.vb[3]}" `);
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`$${k}`, v);
    img = new Image();
    img.ready = false;
    img.onload = () => { img.ready = true; };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    images.set(key, img);
  }
  return img && img.ready ? img : null;
}

// Pixel pro Einheit in Stufen von ~19 %: genug Schärfe, aber nicht für jede Zoomstufe ein neues Bild
const bucket = (k) => Math.pow(1.19, Math.ceil(Math.log(Math.max(0.05, k)) / Math.log(1.19)));

function sprite(name, vars, k) {
  const img = image(name, vars);
  if (!img) return null;
  const step = bucket(k), key = `${name}|${vars ? Object.values(vars).join(',') : ''}|${step.toFixed(3)}`;
  let c = sprites.get(key);
  if (!c) {
    const [, , w, h] = sources.get(name).vb;
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * step));
    c.height = Math.max(1, Math.ceil(h * step));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    if (sprites.size > 1500) sprites.clear();
    sprites.set(key, c);
  }
  return c;
}

// Grafik name in ihren eigenen Koordinaten (viewBox) in die aktuelle Transformation zeichnen
export function art(name, vars) {
  const m = ctx.getTransform(), k = Math.hypot(m.a, m.b);
  const c = sprite(name, vars, k);
  if (!c) { artMisses++; return; }
  const [x, y, w, h] = sources.get(name).vb;
  ctx.drawImage(c, x, y, w, h);
}

// Grafik zentriert auf (x, y) mit Größe size (längere Kante), z. B. für HUD-Symbole
export function artAt(name, x, y, size, vars) {
  const src = sources.get(name);
  if (!src) return;
  const [vx, vy, w, h] = src.vb, k = size / Math.max(w, h);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.translate(-(vx + w / 2), -(vy + h / 2));
  art(name, vars);
  ctx.restore();
}
