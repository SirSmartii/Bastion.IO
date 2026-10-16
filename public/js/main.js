// Einstieg des Clients: Bildschirmgröße, Hauptschleife und Reihenfolge des Zeichnens.
//
// Aufbau:
//   state.js      gemeinsamer Zustand          net.js       Verbindung & Server-Nachrichten
//   world.js      Gelände & Ressourcen          input.js     Tastatur & Maus
//   rules.js      Spielregeln für die Anzeige   chat.js      Chat
//   effects.js    Partikel & Meldungen          menu.js      Startmenü
//   draw/*        Welt, Figuren, Licht          ui/*         HUD & Fenster

import {
  canvas, ctx, cfg, me, myId, now, cam, ui, mouse, players, zombies, structs, groundItems, projectiles, hovered,
  W, H, dpr, scale, setScreen, setNow, setHovered, screenToWorld,
} from './state.js';
import { resourcesIn } from './world.js';
import { inRect } from './draw/primitives.js';
import { drawGround, drawRuins, drawBaseZone, drawLoot, drawRock, drawTree, drawPlant, drawResourceBar } from './draw/terrain.js';
import { TREE_TYPES } from './constants.js';
import { drawStruct, drawBuildGhost, drawZombie, drawPlayer, drawStaminaRing, drawAimLine, drawGroundItem, drawProjectile, drawPrompt } from './draw/entities.js';
import { drawSunShadows, drawSightShadows, drawLighting, resizeLighting } from './draw/lighting.js';
import { particles, updateEffects, drawParticles, drawFloats, drawMuzzleFlashes } from './effects.js';
import { nearForge, nearestContainer, structSize, nearWater } from './rules.js';
import { sendInput } from './input.js';
import { syncContainer } from './ui/windows.js';
import { panels } from './ui/panels.js';
import { drawHud, hotbarRects, logoutRect } from './ui/hud.js';
import { overItemWindows } from './ui/inventory.js';
import { perf, frameStart, mark, frameEnd, drawPerf } from './perf.js';
import { renderTime, sampleAt } from './interp.js';
import './menu.js';

// ---------- Bildschirm ----------

export function resize() {
  const ratio = (window.devicePixelRatio || 1) * (perf.off.fullRes ? 0.6 : 1); // [O] in der F3-Anzeige: weniger Pixel
  const width = Math.max(1, innerWidth), height = Math.max(1, innerHeight); // nie 0: ein 0-px-Canvas lässt drawImage() werfen
  const viewW = cfg ? cfg.VIEW.w : 1600, viewH = cfg ? cfg.VIEW.h : 900;
  setScreen(width, height, ratio, Math.max(width / viewW, height / viewH));
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  resizeLighting(canvas.width, canvas.height);
}
addEventListener('resize', resize);
resize();

// ---------- Hauptschleife ----------

let lastFrame = performance.now();

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - lastFrame) / 1000);
  lastFrame = t;
  setNow(t / 1000);
  frameStart(t);
  mark();

  if (!cfg || !me) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#2b3a20';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  smoothMovement();
  sendInput();
  syncContainer();
  if (ui.panel === 'forge' && !nearForge()) ui.panel = null; // von der Schmiede weggelaufen
  setHovered(findHoveredStructure());
  spawnSprintDust();
  spawnBurnSmoke();
  updateEffects(dt);
  mark('Logik');

  drawWorld();
  if (!perf.off.night) drawLighting();
  mark('Nachtlicht');
  drawHud();
  mark('HUD');
  drawPerf(14, 60);
  frameEnd();
}
requestAnimationFrame(frame);

// Figuren zeitgenau zwischen den Server-Zuständen abspielen (interp.js); die Kamera folgt der eigenen Figur
function smoothMovement() {
  const t = renderTime();
  for (const map of [players, zombies]) for (const e of map.values()) sampleAt(e, t);
  const self = players.get(myId);
  if (self) {
    cam.x = self.dx;
    cam.y = self.dy;
  } else {
    // Tot: Kamera gleitet zur Respawn-Position
    cam.x += (me.x - cam.x) * 0.15;
    cam.y += (me.y - cam.y) * 0.15;
  }
}

// Gebäude unter der Maus (für Tooltip, [E] und [X]) – nicht, wenn die Maus über der Oberfläche ist
function findHoveredStructure() {
  if (ui.drag || mouseOverUi()) return null;
  const wm = screenToWorld(mouse.x, mouse.y);
  for (const s of structs.values()) {
    const { hw, hh } = structSize(s.type, s.rot);
    if (Math.abs(wm.x - s.x) < hw && Math.abs(wm.y - s.y) < hh) return s;
  }
  return null;
}

function mouseOverUi() {
  const { x, y } = mouse;
  return hotbarRects().some((r) => inRect(x, y, r)) || inRect(x, y, logoutRect()) || overItemWindows(x, y) ||
    (!!ui.panel && inRect(x, y, panels[ui.panel].layout().panel));
}

// Staubwolken hinter sprintenden Spielern
function spawnSprintDust() {
  for (const p of players.values()) {
    const moving = Math.hypot(p.x - p.dx, p.y - p.dy) > 1;
    if (!p.sprint || !moving || now - (p.dustT || 0) <= 0.045) continue;
    p.dustT = now;
    const back = Math.atan2(p.dy - p.y, p.dx - p.x);
    particles.push({
      x: p.dx + Math.cos(back) * 16 + (Math.random() - 0.5) * 14, y: p.dy + Math.sin(back) * 16 + (Math.random() - 0.5) * 14,
      vx: Math.cos(back) * 40, vy: Math.sin(back) * 40, life: 0.45, max: 0.45, color: 'rgba(214,196,160,0.8)', size: 4 + Math.random() * 4,
    });
  }
}

// Qualm über Untoten, die im Morgenlicht zerfallen
function spawnBurnSmoke() {
  for (const z of zombies.values()) {
    if (!z.burning || now - (z.smokeT || 0) <= 0.08) continue;
    z.smokeT = now;
    const ember = Math.random() < 0.3;
    particles.push({
      x: z.dx + (Math.random() - 0.5) * 20, y: z.dy + (Math.random() - 0.5) * 20,
      vx: (Math.random() - 0.5) * 20, vy: -40 - Math.random() * 30, life: 0.9, max: 0.9,
      color: ember ? 'rgba(255,140,60,0.9)' : 'rgba(90,90,90,0.55)', size: ember ? 3 : 6 + Math.random() * 6,
    });
  }
}

// ---------- Welt zeichnen (von unten nach oben) ----------

function drawWorld() {
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (W / 2 - cam.x * scale), dpr * (H / 2 - cam.y * scale));
  const view = { x0: cam.x - W / 2 / scale, y0: cam.y - H / 2 / scale, x1: cam.x + W / 2 / scale, y1: cam.y + H / 2 / scale };
  const visibleResources = resourcesIn(view.x0, view.y0, view.x1, view.y1);

  mark();
  drawGround(view);
  mark('Boden');
  if (!perf.off.sun) drawSunShadows(view);
  mark('Sonnenschatten');
  drawBaseZone();
  drawRuins(view);
  for (const r of visibleResources) {
    if (cfg.RESOURCES[r.type].loot) drawLoot(r);
    else if (cfg.RESOURCES[r.type].pick) drawPlant(r);
    else if (!TREE_TYPES.has(r.type)) drawRock(r);
  }
  for (const s of structs.values()) drawStruct(s);
  for (const it of groundItems.values()) drawGroundItem(it);
  mark('Objekte');
  if (!perf.off.sight) drawSightShadows(view); // dahinter verdeckt; Figuren kommen darüber (der Server schickt nur sichtbare)
  mark('Sichtschatten');
  drawBuildGhost();
  for (const z of zombies.values()) drawZombie(z);
  for (const p of players.values()) drawPlayer(p);
  drawStaminaRing();
  drawAimLine();
  for (const b of projectiles) drawProjectile(b);
  drawMuzzleFlashes();
  // Baumkronen über allem, was am Boden ist
  for (const r of visibleResources) if (TREE_TYPES.has(r.type)) drawTree(r);
  for (const r of visibleResources) drawResourceBar(r);
  drawInteractionPrompts();
  if (hovered) {
    const { hw, hh } = structSize(hovered.type, hovered.rot);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeRect(hovered.x - hw, hovered.y - hh, hw * 2, hh * 2);
  }
  drawParticles();
  drawFloats();
  mark('Figuren & FX');
}

// "[F] …" über der nächsten Truhe/dem Kern bzw. der Schmiede
function drawInteractionPrompts() {
  const container = !me.ch && ui.panel !== 'forge' ? nearestContainer() : null;
  if (container) {
    const { s } = container, label = { core: '[F] Kern-Lager', furnace: '[F] Schmelzofen', storage: '[F] Truhe', campfire: '[F] Lagerfeuer' }[s.type];
    drawPrompt(label, s.x, s.y - structSize(s.type, s.rot).hh - 11);
  } else if (!me.ch && ui.panel !== 'forge' && !nearForge() && nearWater()) drawPrompt('[F] Trinken', me.x, me.y - 64);
  if (ui.panel !== 'forge' && nearForge()) drawPrompt('[F] Schmiede', me.forge[1], me.forge[2] - 42);
}
