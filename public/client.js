(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const shadow = document.createElement('canvas'); // Nacht-Dunkelheit
  const sctx = shadow.getContext('2d');
  const sunCanvas = document.createElement('canvas'); // Sonnenschatten (einfarbig, dann halbtransparent drüber)
  const sunCtx = sunCanvas.getContext('2d');
  const lightCanvas = document.createElement('canvas'); // eine Lichtquelle samt ihrer Schatten
  const lctx = lightCanvas.getContext('2d');
  const menu = document.getElementById('menu');
  const nameInput = document.getElementById('name');
  const playBtn = document.getElementById('play');
  const menuInfo = document.getElementById('menu-info');

  // Hotbar: HOTBAR_SIZE frei belegbare Item-Slots (Tasten 1–6) + Bau-Button (B)
  const LEVEL_COLORS = ['#a8743f', '#9aa1a8', '#e8b93f', '#62d6e8', '#e0577a'];
  const LEVEL_DARK = ['#6b4524', '#5c6268', '#9a7419', '#2b93a6', '#8f2a47'];
  const LEVEL_NAMES = ['Holz', 'Stein', 'Gold', 'Diamant', 'Rubin'];
  const RES_ICON = { wood: '🪵', stone: '🪨', gold: '🪙', bone: '🦴', scrap: '🔩', fur: '🧶', meat: '🍖', arrow_wood: '🏹', arrow_stone: '🏹', arrow_iron: '🏹', bullet: '🔸', shell: '🔴' };
  const ARROW_TIPS = [['#8a6236', '#4a3019'], null, ['#9aa1a8', '#5c6268'], ['#d4dde6', '#6a7682']]; // nach look
  const ZCOL = { normal: '#6d9b48', runner: '#a3c652', brute: '#4b6f37' };
  const TAU = Math.PI * 2;

  let ws = null, cfg = null, myId = 0, me = null;
  let tm = [1, 0, 0], lb = [], online = 0;
  const players = new Map(), zombies = new Map(), structs = new Map(), groundItems = new Map();
  let invOpen = false, forgeOpen = false, buildOpen = false, charOpen = false, mapOpen = false, skillOpen = false;
  const mapCache = document.createElement('canvas'); // statischer Teil der Weltkarte
  let forgeTab = 'axes';
  let pendingTooltip = null;
  let staminaFade = 0;
  let buildType = null; // aktuell zu platzierendes Gebäude (wenn selected === 1)
  let buildCat = 'base';
  let drag = null; // { slot, half } für Inventar-Slots oder { eq } für Ausrüstungs-Slots
  let projectiles = [];
  let world = null; // Biome, Seen, Wege, Städte (statisch, kommt mit init)
  const groundCanvas = document.createElement('canvas'); // 1 Pixel pro Biom-Zelle, wird weich hochskaliert
  let minimap = { e: [], p: [] }; // Gegner [x, y, feindlich, ...] und Spieler [x, y, ...] in Welt/10
  let resources = [];
  const resById = new Map();
  const particles = [], floats = [], toasts = [], flashes = [];
  let selected = 0;
  const keys = new Set();
  const mouse = { x: 0, y: 0, down: false };
  const cam = { x: 0, y: 0 };
  let scale = 1, W = 0, H = 0, dpr = 1;
  const lastInput = { k: -1, a: 0, m: false, t: 0 };
  let hovered = null, myAngle = 0, now = 0, lastFrame = performance.now();
  let lastBuildKey = '', coreDemolishT = -9;

  // ---------- Setup ----------

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, innerWidth); // nie 0: ein 0-px-Canvas lässt drawImage() werfen
    H = Math.max(1, innerHeight);
    canvas.width = shadow.width = sunCanvas.width = Math.round(W * dpr);
    canvas.height = shadow.height = sunCanvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const vw = cfg ? cfg.VIEW.w : 1600, vh = cfg ? cfg.VIEW.h : 900;
    scale = Math.max(W / vw, H / vh);
  }
  addEventListener('resize', resize);
  resize();

  try { nameInput.value = localStorage.getItem('bastion-name') || ''; } catch (_) { /* ignore */ }

  function start() {
    const name = nameInput.value.trim();
    try { localStorage.setItem('bastion-name', name); } catch (_) { /* ignore */ }
    menuInfo.textContent = 'Verbinde…';
    connect(name);
  }
  playBtn.addEventListener('click', start);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

  function connect(name) {
    if (ws) ws.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => send({ t: 'join', name });
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      menu.classList.remove('hidden');
      menuInfo.textContent = me ? 'Verbindung getrennt.' : 'Server nicht erreichbar.';
      me = null;
      invOpen = forgeOpen = buildOpen = charOpen = false;
      buildType = null;
      drag = null;
      players.clear(); zombies.clear(); structs.clear(); groundItems.clear();
    };
  }

  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  // ---------- Netzwerk ----------

  function onMessage(m) {
    if (m.t === 'init') {
      myId = m.id;
      cfg = m.cfg;
      resources = m.res.map(makeResource);
      setupWorld(m.world);
      resById.clear();
      for (const r of resources) resById.set(r.id, r);
      selected = 0;
      resize();
      menu.classList.add('hidden');
      menuInfo.textContent = '';
    } else if (m.t === 'm') {
      toast(m.text);
    } else if (m.t === 's') {
      applyState(m);
    }
  }

  const BIOME_COLORS = [
    [92, 139, 62], // Wiese
    [63, 111, 46], // Wald
    [125, 132, 102], // Fels
    [205, 187, 131], // Sand
    [119, 163, 74], // Blumenwiese
    [123, 117, 99], // Stadt
  ];

  function setupWorld(w) {
    world = w;
    world.ruinTiles = w.cities.flatMap((c) => c.ruins);
    // Bodenbild: eine Zelle = ein Pixel, leichte Farbvariation für Struktur
    groundCanvas.width = groundCanvas.height = w.n;
    const g = groundCanvas.getContext('2d'), img = g.createImageData(w.n, w.n);
    for (let i = 0; i < w.n * w.n; i++) {
      const [r, gr, b] = BIOME_COLORS[+w.biomes[i]];
      const v = 1 + (hash2(i % w.n, Math.floor(i / w.n)) - 0.5) * 0.08;
      img.data[i * 4] = r * v; img.data[i * 4 + 1] = gr * v; img.data[i * 4 + 2] = b * v; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  // Deterministischer Zufall pro Rasterzelle (für Deko, die beim Scrollen nicht flackert)
  function hash2(x, y) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  const biomeAt = (x, y) => {
    const i = Math.max(0, Math.min(world.n - 1, Math.floor(x / world.G))), j = Math.max(0, Math.min(world.n - 1, Math.floor(y / world.G)));
    return +world.biomes[j * world.n + i];
  };

  function makeResource([id, type, x, y, r, frac], born) {
    return { id, type, x, y, r, frac, shake: -9, hitT: -9, bornT: born ? now : -9, pts: rockShape(id, r) };
  }

  // Aktuelle Größe: schrumpft mit dem Vorrat, wächst beim Nachwachsen kurz auf
  function resScale(r) {
    if (r.type === 'crate') return 1;
    const min = cfg.RESOURCE_MIN_SCALE;
    const grow = Math.min(1, (now - r.bornT) / 0.8);
    return (min + (1 - min) * r.frac) * (grow < 1 ? 1 - Math.pow(1 - grow, 3) : 1);
  }

  function applyResourceUpdate(ru) {
    for (let i = 0; i < ru.c.length; i += 2) {
      const r = resById.get(ru.c[i]);
      if (r) r.frac = ru.c[i + 1];
    }
    for (const a of ru.a) {
      const r = makeResource(a, true);
      resources.push(r);
      resById.set(r.id, r);
    }
    if (ru.r.length) {
      const gone = new Set(ru.r);
      for (const id of gone) resById.delete(id);
      resources = resources.filter((r) => !gone.has(r.id));
    }
  }

  function sync(map, list, parse) {
    const seen = new Set();
    for (const a of list) {
      const d = parse(a);
      seen.add(d.id);
      const e = map.get(d.id);
      if (!e) {
        d.dx = d.x; d.dy = d.y; d.da = d.angle || 0; d.swingT = -9;
        map.set(d.id, d);
      } else {
        const prev = e.swings;
        Object.assign(e, d);
        if (d.swings !== undefined && d.swings !== prev) e.swingT = now;
      }
    }
    for (const id of map.keys()) if (!seen.has(id)) map.delete(id);
  }

  function applyState(m) {
    const firstState = !me;
    me = m.me;
    tm = m.tm;
    projectiles = m.pr;
    if (m.lb) { lb = m.lb; online = m.on; }
    if (m.ru) applyResourceUpdate(m.ru);
    sync(players, m.pl, (a) => ({ id: a[0], x: a[1], y: a[2], angle: a[3], hp: a[4], maxHp: a[5], name: a[6], swings: a[7], look: a[8], sprint: a[9], prot: a[10] }));
    sync(zombies, m.zs, (a) => ({ id: a[0], type: a[1], x: a[2], y: a[3], angle: a[4], hp: a[5], maxHp: a[6], swings: a[7], aggro: a[8] }));
    if (m.mm) minimap = m.mm;
    sync(structs, m.ss, (a) => ({ id: a[0], type: a[1], x: a[2], y: a[3], level: a[4], hp: a[5], maxHp: a[6], owner: a[7], angle: a[8] }));
    sync(groundItems, m.it, (a) => ({ id: a[0], item: a[1], n: a[2], x: a[3], y: a[4] }));
    if (firstState) { cam.x = me.x; cam.y = me.y; }
    if (drag && !me.inv[drag.slot]) drag = null;

    for (const e of m.ev) {
      const [x, y, k] = e;
      if (k === 'g') {
        const r = resById.get(e[4]);
        if (r) { r.shake = now; r.hitT = now; }
        // Kisten geben pro Schlag nichts (Menge 0) – nur Splitter, die Beute fällt beim Aufbrechen
        if (e[5] === 'crate') burst(x, y, '#a8743f', 6, 110);
        else if (e[6] === myId && e[3] > 0) floatText(x, y - (r ? r.r : 30), `+${e[3]} ${RES_ICON[e[5]]}`, '#ffffff');
      } else if (k === 'hit') {
        burst(x, y + 20, '#9b2f2f', 5, 120);
        damageNumber(x, y, e[3], '#ff4a3d');
      }
      else if (k === 'die') burst(x, y, '#3f5f2b', 16, 180);
      else if (k === 'hurt') {
        burst(x, y + 20, '#d22c2c', 6, 140);
        damageNumber(x, y, e[3], e[4] === myId ? '#b3001b' : '#ff4a3d');
      } else if (k === 'lvl') {
        burst(x, y, '#ffd76a', 30, 260);
        burst(x, y, '#fff3b8', 14, 160);
        floats.push({ x, y: y - 60, text: `Level ${e[3]}!`, color: '#ffd76a', life: 1.8, big: true });
      }
      else if (k === 'boom') burst(x, y, '#7a6650', 22, 220);
      else if (k === 'fix') burst(x, y, '#7fd36a', 6, 90);
      else if (k === 'up') { burst(x, y, '#ffd84a', 18, 200); floatText(x, y - 30, 'Upgrade!', '#ffd84a'); }
      else if (k === 'mine' && e[4] === myId) floatText(x, y - 20, `+${e[3]} 🪙`, '#ffd84a');
      else if (k === 'pick' && e[5] === myId) floatText(x, y - 20, `+${e[3]} ${RES_ICON[e[4]]}`, '#9fe870');
      else if (k === 'bonus' && e[5] === myId) {
        const txt = Object.entries(e[4]).map(([item, n]) => `+${n} ${RES_ICON[item]}`).join(' ');
        floatText(x, y - 50, `Abbau-Bonus! ${txt}`, '#ffd76a');
      } else if (k === 'shot') {
        flashes.push({ x, y, a: e[3], t: now });
        burst(x, y, '#ffd25a', 5, 160);
      } else if (k === 'deplete') {
        const col = { tree: '#3b8535', rock: '#8b9196', gold: '#f4c63d' }[e[4]];
        burst(x, y, col, 26, 260);
        burst(x, y, '#6b4a2a', 10, 160);
      } else if (k === 'eat') { burst(x, y, '#7fd36a', 8, 90); if (e[4] === myId) floatText(x, y - 40, `+${e[3]} ❤`, '#7fd36a'); }
    }
  }

  // ---------- Effekte ----------

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * (0.3 + Math.random() * 0.7);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5, max: 0.5, color, size: 3 + Math.random() * 4 });
    }
  }
  function floatText(x, y, text, color) { floats.push({ x, y, text, color, life: 1.1 }); }
  // Rote Schadenszahl über dem Getroffenen, leicht versetzt und mit kurzem "Pop"
  function damageNumber(x, y, n, color) {
    if (!n) return;
    floats.push({ x: x + (Math.random() - 0.5) * 24, y: y - 8, text: String(n), color, life: 0.9, dmg: true, born: now });
  }
  function toast(text) {
    const same = toasts.find((t) => t.text === text);
    if (same) { same.life = 3.5; return; }
    toasts.push({ text, life: 3.5 });
    if (toasts.length > 4) toasts.shift();
  }

  // ---------- Eingabe ----------

  addEventListener('keydown', (e) => {
    if (!me || document.activeElement === nameInput) return;
    if (e.code === 'Tab') e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'Tab') {
      invOpen = !invOpen;
      forgeOpen = buildOpen = false;
    } else if (e.code === 'KeyC') {
      charOpen = !charOpen;
      forgeOpen = buildOpen = false;
      drag = null;
      mouse.down = false;
      drag = null;
      mouse.down = false;
    } else if (e.code === 'KeyF') {
      if (forgeOpen) forgeOpen = false;
      else if (nearForge()) {
        forgeOpen = true;
        invOpen = buildOpen = charOpen = false;
        drag = null;
        mouse.down = false;
      } else toast(me.forge ? 'Geh näher an deine Schmiede.' : 'Du brauchst eine Schmiede (Baumenü [B]).');
    } else if (e.code === 'KeyK') {
      skillOpen = !skillOpen;
      if (skillOpen) { invOpen = forgeOpen = buildOpen = charOpen = mapOpen = false; drag = null; mouse.down = false; }
    } else if (e.code === 'Escape' && skillOpen) {
      skillOpen = false;
    } else if (e.code === 'KeyR') {
      if (me.stats.ranged) send({ t: 'ammo' });
    } else if (e.code === 'KeyM') {
      mapOpen = !mapOpen;
      if (mapOpen) { invOpen = forgeOpen = buildOpen = charOpen = false; drag = null; mouse.down = false; }
    } else if (e.code === 'Escape' && mapOpen) {
      mapOpen = false;
    } else if (e.code === 'KeyB') {
      toggleBuildMenu();
    } else if (e.code === 'KeyH') {
      send({ t: 'eat' });
    } else if (e.code === 'Escape' && (invOpen || forgeOpen || buildOpen || charOpen)) {
      invOpen = forgeOpen = buildOpen = charOpen = false;
      drag = null;
    } else if (/^Digit[1-9]$/.test(e.code) && +e.code.slice(5) <= cfg.HOTBAR_SIZE) {
      const i = +e.code.slice(5) - 1;
      // Inventar offen und Maus über einem Item: Item auf diesen Slot legen, sonst Slot benutzen
      const s = invSlotAt(mouse.x, mouse.y);
      if (s >= 0 && me.inv[s]) {
        send({ t: 'hb', i, item: me.inv[s][0] });
      } else {
        selected = 0;
        send({ t: 'use', i });
      }
    } else if (e.code === 'KeyQ' || e.code === 'Escape') selected = 0;
    else if (e.code === 'KeyE' && hovered && hovered.owner === myId) send({ t: 'u', id: hovered.id });
    else if (e.code === 'KeyX' && hovered && hovered.owner === myId) {
      if (hovered.type === 'core' && now - coreDemolishT > 2) {
        coreDemolishT = now;
        toast('Nochmal [X]: Kern abreißen zerstört die GANZE Basis!');
      } else send({ t: 'x', id: hovered.id });
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); mouse.down = false; });

  canvas.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (mouse.down && selected > 0) tryBuild(true);
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!me) return;
    if (e.button === 2) {
      // Rechtsklick: Essen / Ausrüsten im Inventar, Ablegen im Charakterfenster
      const s = invSlotAt(e.clientX, e.clientY), eq = eqSlotAt(e.clientX, e.clientY);
      const item = s >= 0 && me.inv[s] && me.inv[s][0];
      const hb = hotbarRects().findIndex((r) => inRect(e.clientX, e.clientY, r));
      if (hb >= 0 && hb < cfg.HOTBAR_SIZE) { send({ t: 'hb', i: hb, item: null }); return; } // Slot leeren
      if (item && cfg.ITEMS.food[item]) send({ t: 'eat', slot: s });
      else if (item && cfg.EQUIPMENT[item]) send({ t: 'equip', slot: s });
      else if (eq && me.eq[eq]) send({ t: 'unequip', eq });
      else if (!invOpen && !charOpen) selected = 0;
      return;
    }
    if (e.button !== 0) return;
    if (mapOpen) return; // Karte offen: Klicks gehen nicht ins Spiel
    const slot = hotbarRects().findIndex((r) => inRect(e.clientX, e.clientY, r));
    if (slot >= 0 && slot < cfg.HOTBAR_SIZE) { selected = 0; send({ t: 'use', i: slot }); return; }
    if (slot === cfg.HOTBAR_SIZE) {
      if (buildType && selected !== 1 && !buildOpen) selected = 1;
      else toggleBuildMenu();
      return;
    }
    if (skillOpen) {
      const L = skillLayout();
      const card = L.cards.find((c) => inRect(e.clientX, e.clientY, c.btn));
      if (card) send({ t: 'skill', id: card.id });
      else if (!inRect(e.clientX, e.clientY, L.panel)) skillOpen = false;
      return;
    }
    if (buildOpen) {
      const L = buildLayout();
      const tab = L.tabs.find((t) => inRect(e.clientX, e.clientY, t.rect));
      const card = L.cards.find((c) => inRect(e.clientX, e.clientY, c.rect));
      if (tab) buildCat = tab.id;
      else if (card) {
        buildType = card.type;
        selected = 1;
        buildOpen = false;
      } else if (!inRect(e.clientX, e.clientY, L.panel)) buildOpen = false;
      return;
    }
    if (forgeOpen) {
      const L = forgeLayout();
      const tab = L.tabs.find((t) => inRect(e.clientX, e.clientY, t.rect));
      const card = L.cards.find((c) => inRect(e.clientX, e.clientY, c.btn));
      if (tab) forgeTab = tab.id;
      else if (card) send({ t: 'craft', id: card.id });
      return;
    }
    if (invOpen || charOpen) {
      // Bei offenem Inventar/Charakterfenster steuert die Maus nur die Fenster
      const s = invSlotAt(e.clientX, e.clientY), eq = eqSlotAt(e.clientX, e.clientY);
      if (s >= 0 && me.inv[s]) drag = { slot: s, half: e.shiftKey };
      else if (eq && me.eq[eq]) drag = { eq };
      return;
    }
    mouse.down = true;
    lastBuildKey = '';
    if (selected > 0) tryBuild(false);
  });
  addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    mouse.down = false;
    if (drag) endDrag(e.clientX, e.clientY);
  });

  function endDrag(sx, sy) {
    const d = drag;
    drag = null;
    if (!me) return;
    const invT = invSlotAt(sx, sy), eqT = eqSlotAt(sx, sy);
    const overPanel = (invOpen && inRect(sx, sy, invLayout().panel)) || (charOpen && inRect(sx, sy, charLayout().panel));
    const wm = screenToWorld(sx, sy);
    if (d.eq) {
      if (!me.eq[d.eq]) return;
      if (invT >= 0) send({ t: 'unequip', eq: d.eq, to: invT });
      else if (!overPanel) send({ t: 'unequip', eq: d.eq, drop: true, x: wm.x, y: wm.y });
      return;
    }
    const stack = me.inv[d.slot];
    if (!stack) return;
    // Auf einen Hotbar-Slot gezogen: Item dort ablegen (bleibt im Inventar)
    const hbT = hotbarRects().findIndex((r) => inRect(sx, sy, r));
    if (hbT >= 0 && hbT < cfg.HOTBAR_SIZE) { send({ t: 'hb', i: hbT, item: stack[0] }); return; }
    if (invT >= 0) {
      if (invT !== d.slot) send({ t: 'mv', from: d.slot, to: invT });
    } else if (eqT) {
      const def = cfg.EQUIPMENT[stack[0]];
      if (def && def.slot === eqT) send({ t: 'equip', slot: d.slot });
      else toast('Das passt nicht in diesen Slot.');
    } else if (!overPanel) {
      // Aus dem Fenster gezogen: an der Mausposition in die Welt werfen
      send({ t: 'drop', slot: d.slot, n: d.half ? Math.ceil(stack[1] / 2) : 0, x: wm.x, y: wm.y });
    }
  }
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', () => {
    if (me && buildType && !buildOpen) selected = selected ? 0 : 1;
  }, { passive: true });

  function toggleBuildMenu() {
    buildOpen = !buildOpen;
    invOpen = forgeOpen = charOpen = skillOpen = false;
    drag = null;
    mouse.down = false;
    if (buildOpen && buildType) buildCat = cfg.STRUCTURES[buildType].category;
  }

  function tryBuild(dragging) {
    const type = buildType;
    if (!type) return;
    const wm = screenToWorld(mouse.x, mouse.y);
    const g = snap(type, wm.x, wm.y);
    const key = `${type}:${g.x}:${g.y}`;
    if (key === lastBuildKey) return;
    // Beim Ziehen nur gültige Plätze senden (z.B. Mauerreihen ziehen)
    if (dragging && placementError(type, g)) return;
    lastBuildKey = key;
    send({ t: 'b', type, x: wm.x, y: wm.y });
  }

  function sendInput() {
    let k = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) k |= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) k |= 2;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) k |= 4;
    if (keys.has('KeyD') || keys.has('ArrowRight')) k |= 8;
    if ((keys.has('ShiftLeft') || keys.has('ShiftRight')) && !drag) k |= 16; // Sprint
    const self = players.get(myId);
    const wm = screenToWorld(mouse.x, mouse.y);
    if (self) myAngle = Math.atan2(wm.y - self.dy, wm.x - self.dx);
    const m = mouse.down && selected === 0;
    const da = Math.abs(myAngle - lastInput.a);
    if (k !== lastInput.k || m !== lastInput.m || (da > 0.03 && now - lastInput.t > 0.05)) {
      lastInput.k = k; lastInput.m = m; lastInput.a = myAngle; lastInput.t = now;
      send({ t: 'i', k, a: +myAngle.toFixed(3), m });
    }
  }

  // ---------- Hilfsfunktionen ----------

  const screenToWorld = (sx, sy) => ({ x: cam.x + (sx - W / 2) / scale, y: cam.y + (sy - H / 2) / scale });
  const worldToScreen = (wx, wy) => ({ x: (wx - cam.x) * scale + W / 2, y: (wy - cam.y) * scale + H / 2 });
  const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const lerpAngle = (a, b, t) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return a + d * t;
  };
  const fmtCost = (cost) => Object.entries(cost).map(([k, v]) => `${v}${RES_ICON[k]}`).join(' ');
  const canAfford = (cost) => me && Object.entries(cost).every(([k, v]) => (me.res[k] || 0) >= v);
  const coreRadius = () => (me && me.core ? me.core[4] : 0);

  function snap(type, x, y) {
    const T = cfg.TILE, off = (cfg.STRUCTURES[type].size * T) / 2;
    return { x: Math.round((x - off) / T) * T + off, y: Math.round((y - off) / T) * T + off, half: off };
  }

  // Vereinfachte Client-Prüfung nur für die Vorschau – der Server entscheidet
  function placementError(type, g) {
    const def = cfg.STRUCTURES[type];
    if (!me || me.dead) return 'tot';
    if (Math.hypot(g.x - me.x, g.y - me.y) > cfg.PLAYER.buildRange) return 'weit';
    if (type === 'core') {
      if (me.core) return 'kern';
    } else {
      if (!me.core) return 'kein kern';
      if (Math.hypot(g.x - me.core[1], g.y - me.core[2]) > coreRadius()) return 'radius';
      if (me.count >= me.max) return 'limit';
      if (type === 'forge' && me.forge) return 'limit';
      if (type === 'mine' && me.mines >= def.limit) return 'limit';
    }
    if (!canAfford(def.levels[0].cost)) return 'kosten';
    if (world.cities.some((c) => Math.hypot(c.x - g.x, c.y - g.y) < c.r + cfg.MAP.noBuildMargin + g.half)) return 'stadt';
    for (const [x, y, r] of world.lakes) {
      const cx = Math.max(g.x - g.half, Math.min(x, g.x + g.half)), cy = Math.max(g.y - g.half, Math.min(y, g.y + g.half));
      if (Math.hypot(x - cx, y - cy) < r) return 'wasser';
    }
    for (const s of structs.values()) {
      const sh = (cfg.STRUCTURES[s.type].size * cfg.TILE) / 2;
      if (Math.abs(s.x - g.x) < sh + g.half - 1 && Math.abs(s.y - g.y) < sh + g.half - 1) return 'belegt';
    }
    for (const r of resources) {
      if (Math.abs(r.x - g.x) > 200 || Math.abs(r.y - g.y) > 200) continue;
      const cx = Math.max(g.x - g.half, Math.min(r.x, g.x + g.half));
      const cy = Math.max(g.y - g.half, Math.min(r.y, g.y + g.half));
      if (Math.hypot(r.x - cx, r.y - cy) < r.r * 0.75 * resScale(r)) return 'belegt';
    }
    return null;
  }

  function invLayout() {
    const cols = 5, rows = Math.ceil(cfg.INVENTORY.slots / cols), size = 60, gap = 8, pad = 18, head = 40, foot = 34;
    const w = pad * 2 + cols * size + (cols - 1) * gap;
    const h = head + pad + rows * size + (rows - 1) * gap + foot;
    const x = Math.round(charOpen ? W / 2 - w - 8 : W / 2 - w / 2), y = Math.round(Math.max(80, H / 2 - h / 2 - 40));
    const slots = [];
    for (let i = 0; i < cfg.INVENTORY.slots; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      slots.push({ x: x + pad + c * (size + gap), y: y + head + r * (size + gap), w: size, h: size });
    }
    return { panel: { x, y, w, h }, slots };
  }

  function invSlotAt(sx, sy) {
    if (!invOpen || !cfg) return -1;
    return invLayout().slots.findIndex((r) => inRect(sx, sy, r));
  }

  // Item-Symbol, zentriert auf (x, y) mit Größe s
  function drawItemIcon(item, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    const k = s / 40;
    ctx.scale(k, k);
    if (cfg.EQUIPMENT[item]) drawEquipShape(cfg.EQUIPMENT[item]);
    else if (item.startsWith('arrow')) {
      const [tip, tipDark] = ARROW_TIPS[cfg.AMMO.arrow.types.find((t) => t.item === item).look];
      ctx.rotate(-0.75);
      for (const oy of [-5, 5]) {
        rrect(-17, oy - 1.5, 30, 3, 1.5, '#a0784a', '#5a3d1e', 1);
        ctx.beginPath();
        ctx.moveTo(12, oy - 5); ctx.lineTo(21, oy); ctx.lineTo(12, oy + 5);
        ctx.closePath();
        ctx.fillStyle = tip; ctx.fill();
        ctx.strokeStyle = tipDark; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = '#e8e2d0';
        ctx.fillRect(-18, oy - 4, 6, 3);
        ctx.fillRect(-18, oy + 1, 6, 3);
      }
    } else if (item === 'bullet') {
      ctx.rotate(-0.6);
      for (const oy of [-7, 0, 7]) {
        rrect(-12, oy - 3, 16, 6, 1.5, '#c9a13a', '#7a5d14', 1.5);
        ctx.beginPath();
        ctx.moveTo(4, oy - 3); ctx.quadraticCurveTo(13, oy, 4, oy + 3);
        ctx.closePath();
        ctx.fillStyle = '#a8a8a8';
        ctx.fill();
      }
    } else if (item === 'shell') {
      ctx.rotate(-0.6);
      for (const oy of [-6, 6]) {
        rrect(-14, oy - 5, 22, 10, 2, '#c8352c', '#7a1a14', 2);
        rrect(6, oy - 5, 8, 10, 2, '#d4b04a', '#7a5d14', 2);
      }
    } else if (item === 'wood') {
      ctx.rotate(-0.5);
      for (const [ox, oy] of [[-3, 7], [3, -7]]) {
        rrect(-17 + ox, -6 + oy, 34, 12, 6, '#a8743f', '#5e3b1c', 2.5);
        circle(17 + ox, oy, 5.5, '#e2bb84', '#5e3b1c', 2.5);
        circle(17 + ox, oy, 2, '#a8743f');
      }
    } else if (item === 'stone') {
      poly([[-16, 4], [-10, -12], [4, -15], [16, -6], [15, 9], [2, 15], [-12, 12]]);
      ctx.fillStyle = '#9aa1a8';
      ctx.fill();
      ctx.strokeStyle = '#5a6065';
      ctx.lineWidth = 3;
      ctx.stroke();
      poly([[-7, -2], [-3, -8], [5, -8], [6, 0], [-1, 3]]);
      ctx.fillStyle = '#b9bfc4';
      ctx.fill();
    } else if (item === 'bone') {
      ctx.rotate(-0.6);
      rrect(-12, -4, 24, 8, 3, '#efe8d6', '#8f8670', 2.5);
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) circle(sx * 13, sy * 5, 6, '#efe8d6', '#8f8670', 2.5);
      }
      rrect(-12, -2.5, 24, 5, 2, '#efe8d6');
    } else if (item === 'scrap') {
      ctx.rotate(0.3);
      circle(-4, 2, 12, '#7b8189', '#3f444a', 3);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        rrect(-4 + Math.cos(a) * 12 - 3, 2 + Math.sin(a) * 12 - 3, 6, 6, 1, '#7b8189', '#3f444a', 2);
      }
      circle(-4, 2, 4.5, '#2a2d31');
      rrect(4, -15, 14, 6, 2, '#a0662d', '#5a3510', 2);
    } else if (item === 'fur') {
      poly([[-15, -10], [-4, -15], [12, -12], [17, 0], [13, 13], [-2, 15], [-16, 9], [-12, 0]]);
      ctx.fillStyle = '#9a7650';
      ctx.fill();
      ctx.strokeStyle = '#5a4128';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = '#7d5d3c';
      ctx.lineWidth = 2;
      for (const [x1, y1] of [[-8, -6], [0, -2], [-4, 5], [6, 4]]) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + 6, y1 + 3);
        ctx.stroke();
      }
    } else if (item === 'meat') {
      ctx.rotate(-0.5);
      rrect(8, -3, 14, 6, 3, '#f3ead8', '#8f8670', 2);
      circle(22, -3, 4, '#f3ead8', '#8f8670', 2);
      circle(22, 3, 4, '#f3ead8', '#8f8670', 2);
      ellipse(-3, 0, 15, 12, '#c8463c', '#7a2620', 3);
      ellipse(-6, -3, 6, 4, '#e07a6e');
    } else if (item === 'gold') {
      for (const [ox, oy, r] of [[-7, 5, 9], [7, 6, 8], [0, -6, 9]]) circle(ox, oy, r, '#f4c63d', '#a67c12', 3);
      circle(-2, -9, 3, '#fff3b8');
    }
    ctx.restore();
  }

  function rockShape(seed, r) {
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const n = 8, pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd() * 0.3, rr = r * (0.82 + rnd() * 0.2);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    return pts;
  }

  function poly(pts, k = 1) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
    ctx.closePath();
  }

  function circle(x, y, r, fill, stroke, lw) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
  }

  function rrect(x, y, w, h, r, fill, stroke, lw) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
  }

  function hpBar(x, y, w, frac, color) {
    rrect(x - w / 2, y, w, 8, 4, 'rgba(0,0,0,0.55)');
    rrect(x - w / 2 + 1.5, y + 1.5, Math.max(0, (w - 3) * frac), 5, 2.5, color);
  }

  function darkness() {
    const [, night, p] = tm;
    if (!night) return p > 0.9 ? ((p - 0.9) / 0.1) * 0.35 : 0;
    let d = 0.35 + 0.35 * Math.min(1, p / 0.1);
    if (p > 0.9) d *= (1 - p) / 0.1;
    return d;
  }

  // ---------- Welt zeichnen ----------

  function drawGround(x0, y0, x1, y1) {
    const WS = cfg.WORLD_SIZE, T = cfg.TILE;
    ctx.fillStyle = '#26321d';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    // Biome: kleines Bild mit Glättung auf die Weltgröße gestreckt -> weiche Übergänge
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(groundCanvas, 0, 0, world.n, world.n, 0, 0, WS, WS);
    drawGroundDecor(x0, y0, x1, y1);
    drawRoads();
    drawCities(x0, y0, x1, y1);
    drawLakes(x0, y0, x1, y1);
    // Baugitter nur beim Platzieren eines Gebäudes, und nur rund um die Maus
    if (selected === 1 && buildType && !buildOpen && !me.dead) {
      const wm = screenToWorld(mouse.x, mouse.y), R = 260;
      const gx0 = Math.max(0, Math.floor((wm.x - R) / T) * T), gx1 = Math.min(WS, wm.x + R);
      const gy0 = Math.max(0, Math.floor((wm.y - R) / T) * T), gy1 = Math.min(WS, wm.y + R);
      const fade = ctx.createRadialGradient(wm.x, wm.y, 0, wm.x, wm.y, R);
      fade.addColorStop(0, 'rgba(255,255,255,0.22)');
      fade.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = fade;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = gx0; x <= gx1; x += T) { ctx.moveTo(x, gy0); ctx.lineTo(x, gy1); }
      for (let y = gy0; y <= gy1; y += T) { ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, WS, WS);
  }

  // Grasbüschel, Blumen, Kiesel – pro Zelle deterministisch
  function drawGroundDecor(x0, y0, x1, y1) {
    const G = world.G;
    for (let j = Math.max(0, Math.floor(y0 / G)); j <= Math.min(world.n - 1, Math.floor(y1 / G)); j++) {
      for (let i = Math.max(0, Math.floor(x0 / G)); i <= Math.min(world.n - 1, Math.floor(x1 / G)); i++) {
        const b = +world.biomes[j * world.n + i];
        if (b === 5) continue;
        for (let k = 0; k < 3; k++) {
          const hx = hash2(i * 3 + k, j), hy = hash2(j * 3 + k, i + 7), ht = hash2(i + k * 13, j + 3);
          const x = i * G + hx * G, y = j * G + hy * G;
          if (b === 3 || b === 2) { // Kiesel
            if (ht < 0.5) circle(x, y, 2 + ht * 4, b === 3 ? 'rgba(150,130,90,0.45)' : 'rgba(80,85,70,0.4)');
          } else if (b === 4 && ht < 0.45) { // Blumen
            circle(x, y, 3, ['#f3e27a', '#f2f2f2', '#e88ab0', '#9fb8ff'][Math.floor(ht * 9) % 4]);
            circle(x, y, 1.2, '#c48a1a');
          } else if (ht < 0.7) { // Grasbüschel
            ctx.strokeStyle = b === 1 ? 'rgba(25,60,20,0.5)' : 'rgba(45,95,30,0.5)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (const dx of [-4, 0, 4]) { ctx.moveTo(x + dx * 0.5, y + 4); ctx.lineTo(x + dx, y - 5); }
            ctx.stroke();
          }
        }
      }
    }
  }

  // Weg als geglättete Linie durch die Stützpunkte
  function roadPath(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mxp = (pts[i][0] + pts[i + 1][0]) / 2, myp = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mxp, myp);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
  }

  function drawRoads() {
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const pts of world.roads) {
      roadPath(pts);
      ctx.strokeStyle = 'rgba(110,88,55,0.55)';
      ctx.lineWidth = 86;
      ctx.stroke();
      ctx.strokeStyle = '#a58c62';
      ctx.lineWidth = 66;
      ctx.stroke();
      ctx.setLineDash([26, 40]);
      ctx.strokeStyle = 'rgba(80,62,38,0.25)';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.lineCap = ctx.lineJoin = 'butt';
  }

  function drawCities(x0, y0, x1, y1) {
    const T = cfg.TILE;
    for (const c of world.cities) {
      if (c.x + c.r < x0 || c.x - c.r > x1 || c.y + c.r < y0 || c.y - c.r > y1) continue;
      // Gepflasterte Straßen im Raster, Marktplatz in der Mitte
      const sw = cfg.MAP.streetMargin * 1.5;
      ctx.lineCap = 'square';
      for (const [w, color] of [[sw + 10, 'rgba(70,64,52,0.5)'], [sw, '#8f8775']]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.beginPath();
        for (const [[ax, ay], [bx, by]] of c.streets) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(60,55,45,0.18)';
      ctx.lineWidth = 2;
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      for (const [[ax, ay], [bx, by]] of c.streets) {
        for (const off of [-sw / 4, sw / 4]) {
          const v = ax === bx;
          ctx.moveTo(ax + (v ? off : 0), ay + (v ? 0 : off));
          ctx.lineTo(bx + (v ? off : 0), by + (v ? 0 : off));
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineCap = 'butt';
      circle(c.x, c.y, sw * 1.1, '#968e7b', 'rgba(70,64,52,0.5)', 5);
      // Hausböden mit Fliesen
      for (const [bx, by, bw, bh] of c.buildings) {
        ctx.fillStyle = '#8d8472';
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = 'rgba(70,62,50,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = bx; x <= bx + bw; x += T / 2) { ctx.moveTo(x, by); ctx.lineTo(x, by + bh); }
        for (let y = by; y <= by + bh; y += T / 2) { ctx.moveTo(bx, y); ctx.lineTo(bx + bw, y); }
        ctx.stroke();
      }
      // Ortsname auf dem Boden
      ctx.font = 'bold 54px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(40,34,25,0.22)';
      ctx.fillText(c.name.toUpperCase(), c.x, c.y - c.r + 70);
    }
  }

  // Seen: Sandufer, Wasser, hellere Mitte und langsam wandernde Wellen
  function drawLakes(x0, y0, x1, y1) {
    const vis = world.lakes.filter(([x, y, r]) => x + r + 40 > x0 && x - r - 40 < x1 && y + r + 40 > y0 && y - r - 40 < y1);
    if (!vis.length) return;
    const layer = (grow, color) => {
      ctx.beginPath();
      for (const [x, y, r] of vis) { ctx.moveTo(x + r + grow, y); ctx.arc(x, y, r + grow, 0, TAU); }
      ctx.fillStyle = color;
      ctx.fill();
    };
    layer(34, '#d2bf88');
    layer(6, '#2f6a9c');
    layer(0, '#3c7fb6');
    layer(-40, '#4a8fc6');
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    for (const [x, y, r] of vis) {
      for (let k = 0; k < 3; k++) {
        const a = hash2(x + k, y) * TAU + now * 0.15, d = r * (0.25 + 0.5 * hash2(y + k, x));
        const wx = x + Math.cos(a) * d, wy = y + Math.sin(a) * d;
        ctx.beginPath();
        ctx.arc(wx, wy, 14, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    }
  }

  // Ruinenmauern der Städte
  function drawRuins(x0, y0, x1, y1) {
    const h = cfg.TILE / 2;
    for (const [x, y, v] of world.ruinTiles) {
      if (x + h < x0 || x - h > x1 || y + h < y0 || y - h > y1) continue;
      rrect(x - h + 1, y - h + 1, h * 2 - 2, h * 2 - 2, 4, ['#8a8378', '#817a6e', '#938b7e', '#7a7468'][v], '#4f4a42', 3);
      ctx.strokeStyle = 'rgba(60,55,48,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - h + 4, y); ctx.lineTo(x + h - 4, y);
      ctx.moveTo(x + (v % 2 ? -6 : 6), y - h + 4); ctx.lineTo(x + (v % 2 ? -6 : 6), y);
      if (v === 3) { ctx.moveTo(x - 10, y + 4); ctx.lineTo(x - 2, y + 14); ctx.lineTo(x + 6, y + 9); }
      ctx.stroke();
    }
  }

  function drawCrate(r) {
    const o = shakeOffset(r), h = r.r;
    ctx.save();
    ctx.translate(r.x + o, r.y);
    rrect(-h, -h, h * 2, h * 2, 4, '#a8743f', '#5a3a1c', 3);
    ctx.strokeStyle = '#6b4524';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-h + 3, -h + 3); ctx.lineTo(h - 3, h - 3);
    ctx.moveTo(-h, 0); ctx.lineTo(h, 0);
    ctx.stroke();
    // Risse, je weniger Haltbarkeit übrig ist
    if (r.frac < 0.9) {
      ctx.strokeStyle = '#2a1a0c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-h * 0.6, -h * 0.8); ctx.lineTo(-h * 0.2, -h * 0.2); ctx.lineTo(-h * 0.5, h * 0.3);
      if (r.frac < 0.5) { ctx.moveTo(h * 0.7, -h * 0.5); ctx.lineTo(h * 0.2, h * 0.1); ctx.lineTo(h * 0.6, h * 0.8); }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBaseZone() {
    if (!me.core) return;
    const [, x, y, , r] = me.core;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = selected > 0 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.035)';
    ctx.fill();
    ctx.setLineDash([18, 14]);
    ctx.strokeStyle = selected > 0 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function shakeOffset(r) {
    const t = now - r.shake;
    if (t > 0.18) return 0;
    return Math.sin(t * 90) * 6 * (1 - t / 0.18);
  }

  // Kleine Vorratsleiste über kürzlich abgebauten Ressourcen
  function drawResBar(r) {
    const t = now - r.hitT;
    if (t > 2.5) return;
    ctx.globalAlpha = Math.min(1, (2.5 - t) * 2);
    const col = { tree: '#7ed957', rock: '#c5cbd1', gold: '#f4c63d' }[r.type];
    hpBar(r.x, r.y - r.r * resScale(r) - 18, 54, r.frac, col);
    ctx.globalAlpha = 1;
  }

  function drawRock(r) {
    const o = shakeOffset(r), k = resScale(r);
    ctx.save();
    ctx.translate(r.x + o, r.y);
    ctx.scale(k, k);
    poly(r.pts);
    ctx.fillStyle = r.type === 'gold' ? '#7a7166' : '#8b9196';
    ctx.fill();
    ctx.strokeStyle = r.type === 'gold' ? '#4f483f' : '#5a6065';
    ctx.lineWidth = 5;
    ctx.stroke();
    poly(r.pts, 0.55);
    ctx.fillStyle = r.type === 'gold' ? '#958b7f' : '#a6acb1';
    ctx.fill();
    if (r.type === 'gold') {
      for (let i = 0; i < 4; i++) {
        const [px, py] = r.pts[i * 2];
        circle(px * 0.45, py * 0.45, r.r * 0.18, '#f4c63d', '#a67c12', 3);
      }
    }
    ctx.restore();
  }

  function drawTree(r) {
    const o = shakeOffset(r), k = resScale(r);
    ctx.save();
    ctx.translate(r.x + o, r.y);
    ctx.scale(k, k);
    circle(0, 0, r.r, '#2e6b2b', '#21501f', 5);
    circle(-r.r * 0.12, -r.r * 0.12, r.r * 0.72, '#3b8535');
    circle(-r.r * 0.22, -r.r * 0.22, r.r * 0.42, '#4b9c41');
    ctx.restore();
  }

  function drawStruct(s, ghost) {
    const def = cfg.STRUCTURES[s.type];
    const h = (def.size * cfg.TILE) / 2;
    const c = LEVEL_COLORS[s.level], d = LEVEL_DARK[s.level];
    ctx.save();
    ctx.translate(s.x, s.y);
    switch (s.type) {
      case 'wall':
        rrect(-h + 2, -h + 2, h * 2 - 4, h * 2 - 4, 6, c, d, 4);
        ctx.strokeStyle = d;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-h + 4, 0); ctx.lineTo(h - 4, 0);
        ctx.moveTo(0, -h + 4); ctx.lineTo(0, 0);
        ctx.moveTo(-h / 2, 0); ctx.lineTo(-h / 2, h - 4);
        ctx.moveTo(h / 2, 0); ctx.lineTo(h / 2, h - 4);
        ctx.stroke();
        break;
      case 'spike': {
        rrect(-h + 8, -h + 8, h * 2 - 16, h * 2 - 16, 4, d);
        ctx.beginPath();
        const n = 8;
        for (let i = 0; i < n * 2; i++) {
          const a = (i / (n * 2)) * TAU, rr = i % 2 ? h * 0.45 : h * 1.02;
          ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fillStyle = c;
        ctx.fill();
        ctx.strokeStyle = d;
        ctx.lineWidth = 3;
        ctx.stroke();
        circle(0, 0, h * 0.25, d);
        break;
      }
      case 'turret':
        rrect(-h + 3, -h + 3, h * 2 - 6, h * 2 - 6, 8, d, '#2a2a2a', 3);
        ctx.rotate(s.angle || 0);
        rrect(0, -6, h + 8, 12, 3, '#3a3a3a', '#1f1f1f', 3);
        circle(0, 0, h * 0.62, c, d, 4);
        circle(0, 0, h * 0.25, d);
        break;
      case 'mine':
        rrect(-h + 2, -h + 2, h * 2 - 4, h * 2 - 4, 6, c, d, 4);
        circle(0, 0, h * 0.55, '#2b2118');
        ctx.rotate(ghost ? 0 : now * 1.5);
        ctx.strokeStyle = '#f4c63d';
        ctx.lineWidth = 4;
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 4);
          ctx.beginPath();
          ctx.moveTo(-h * 0.45, 0);
          ctx.lineTo(h * 0.45, 0);
          ctx.stroke();
        }
        break;
      case 'door': {
        // Schwelle + zwei Pfosten; das Türblatt schwingt auf, wenn der Besitzer davorsteht
        rrect(-h + 2, -h + 10, h * 2 - 4, h * 2 - 20, 4, 'rgba(60,44,30,0.55)');
        rrect(-h + 2, -9, 9, 18, 3, d, '#1f1f1f', 2);
        rrect(h - 11, -9, 9, 18, 3, d, '#1f1f1f', 2);
        const self = players.get(myId);
        const open = !ghost && s.owner === myId && self && Math.hypot(self.dx - s.x, self.dy - s.y) < h + 45;
        s.openAnim = (s.openAnim || 0) + ((open ? 1 : 0) - (s.openAnim || 0)) * 0.2;
        ctx.save();
        ctx.translate(-h + 11, 0);
        ctx.rotate(-s.openAnim * Math.PI * 0.5);
        rrect(0, -6, h * 2 - 22, 12, 3, c, d, 3);
        ctx.strokeStyle = d;
        ctx.lineWidth = 1.5;
        for (const px of [h * 0.5, h]) {
          ctx.beginPath();
          ctx.moveTo(px, -5); ctx.lineTo(px, 5);
          ctx.stroke();
        }
        circle(h * 2 - 30, 0, 2.5, '#2a2a2a');
        ctx.restore();
        break;
      }
      case 'window': {
        // Rahmen in Level-Farbe, Glas mit Sprossen
        rrect(-h + 2, -h + 2, h * 2 - 4, h * 2 - 4, 6, c, d, 4);
        rrect(-h + 10, -h + 10, h * 2 - 20, h * 2 - 20, 3, 'rgba(160,215,255,0.55)', d, 2);
        ctx.strokeStyle = d;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, -h + 10); ctx.lineTo(0, h - 10);
        ctx.moveTo(-h + 10, 0); ctx.lineTo(h - 10, 0);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-h + 14, -6); ctx.lineTo(-6, -h + 14);
        ctx.stroke();
        break;
      }
      case 'forge': {
        rrect(-h + 2, -h + 2, h * 2 - 4, h * 2 - 4, 6, '#4a4440', d, 4);
        // Glut
        const glow = ghost ? 0.8 : 0.65 + Math.sin(now * 7) * 0.2 + Math.sin(now * 13) * 0.1;
        circle(-h * 0.45, -h * 0.45, h * 0.32, `rgba(255,${120 + glow * 60},40,${glow})`, '#2a1d14', 2);
        // Amboss in Level-Farbe
        ctx.beginPath();
        ctx.moveTo(-h * 0.55, -h * 0.05);
        ctx.lineTo(h * 0.7, -h * 0.05);
        ctx.lineTo(h * 0.45, h * 0.2);
        ctx.lineTo(h * 0.2, h * 0.2);
        ctx.lineTo(h * 0.3, h * 0.55);
        ctx.lineTo(-h * 0.35, h * 0.55);
        ctx.lineTo(-h * 0.2, h * 0.2);
        ctx.lineTo(-h * 0.4, h * 0.2);
        ctx.closePath();
        ctx.fillStyle = c;
        ctx.fill();
        ctx.strokeStyle = '#1f1f1f';
        ctx.lineWidth = 3;
        ctx.stroke();
        break;
      }
      case 'core': {
        rrect(-h + 3, -h + 3, h * 2 - 6, h * 2 - 6, 14, d, '#1f1f1f', 4);
        rrect(-h + 14, -h + 14, h * 2 - 28, h * 2 - 28, 10, c);
        const pulse = 1 + Math.sin(now * 3) * 0.06;
        ctx.save();
        ctx.rotate(Math.PI / 4);
        ctx.scale(pulse, pulse);
        rrect(-h * 0.32, -h * 0.32, h * 0.64, h * 0.64, 6, '#86e6ff', '#2a8fb0', 4);
        ctx.restore();
        for (let i = 0; i <= s.level; i++) circle(-h + 22 + i * 14, h - 22, 4.5, '#fff', '#222', 2);
        break;
      }
    }
    ctx.restore();
    if (!ghost) {
      if (s.owner !== myId) {
        ctx.strokeStyle = 'rgba(220,60,60,0.55)';
        ctx.lineWidth = 3;
        ctx.strokeRect(s.x - h, s.y - h, h * 2, h * 2);
      }
      if (s.hp < s.maxHp) hpBar(s.x, s.y - h - 14, Math.max(44, h * 1.6), s.hp / s.maxHp, s.owner === myId ? '#7ed957' : '#e05555');
    }
  }

  function drawZombie(z) {
    const def = cfg.ENEMIES[z.type], r = def.r;
    const at = now - z.swingT;
    const lunge = at < 0.25 ? Math.sin((at / 0.25) * Math.PI) * r * 0.45 : 0;
    ctx.save();
    ctx.translate(z.dx, z.dy);
    ctx.rotate(z.da);
    if (z.type === 'wolf') drawWolf(r, lunge);
    else if (z.type === 'pig') drawPig(r, lunge, z.aggro);
    else if (z.type === 'bear') drawBear(r, lunge);
    else {
      const col = ZCOL[z.type];
      for (const side of [-1, 1]) circle(r * 0.75 + lunge, side * r * 0.62, r * 0.32, col, '#253a19', 3);
      circle(0, 0, r, col, '#253a19', 4);
      const eye = tm[1] ? '#ff3b3b' : '#1d1d1d';
      circle(r * 0.45, -r * 0.3, r * 0.14, eye);
      circle(r * 0.45, r * 0.3, r * 0.14, eye);
    }
    ctx.restore();
    if (z.hp < z.maxHp) hpBar(z.dx, z.dy - r - 14, r * 2, z.hp / z.maxHp, '#e05555');
  }

  function ellipse(x, y, rx, ry, fill, stroke, lw) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
  }

  // Tiere schauen in +x-Richtung
  function drawWolf(r, lunge) {
    const wag = Math.sin(now * 10) * 0.3;
    ctx.save();
    ctx.translate(-r * 1.1, 0);
    ctx.rotate(wag);
    ellipse(-r * 0.4, 0, r * 0.55, r * 0.22, '#6e7378', '#3a3d40', 3);
    ctx.restore();
    ellipse(0, 0, r * 1.15, r * 0.7, '#80868c', '#3a3d40', 4);
    const hx = r * 0.95 + lunge;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hx - r * 0.1, side * r * 0.25);
      ctx.lineTo(hx - r * 0.35, side * r * 0.75);
      ctx.lineTo(hx + r * 0.15, side * r * 0.4);
      ctx.closePath();
      ctx.fillStyle = '#5d6267';
      ctx.fill();
    }
    circle(hx, 0, r * 0.5, '#8d9399', '#3a3d40', 3);
    ellipse(hx + r * 0.45, 0, r * 0.3, r * 0.22, '#b8bdc1', '#3a3d40', 2);
    circle(hx + r * 0.72, 0, r * 0.1, '#1d1d1d');
    circle(hx + r * 0.15, -r * 0.2, r * 0.09, '#ffd23f');
    circle(hx + r * 0.15, r * 0.2, r * 0.09, '#ffd23f');
  }

  function drawPig(r, lunge, angry) {
    ellipse(0, 0, r * 1.1, r * 0.85, '#d98f8a', '#8a4e4a', 4);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.3, side * r * 0.45);
      ctx.lineTo(r * 0.05, side * r * 0.95);
      ctx.lineTo(r * 0.6, side * r * 0.7);
      ctx.closePath();
      ctx.fillStyle = '#c47a75';
      ctx.fill();
      ctx.strokeStyle = '#8a4e4a';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const sx = r * 0.95 + lunge;
    ellipse(sx, 0, r * 0.32, r * 0.4, '#f2b3ae', '#8a4e4a', 3);
    circle(sx + r * 0.05, -r * 0.14, r * 0.08, '#8a4e4a');
    circle(sx + r * 0.05, r * 0.14, r * 0.08, '#8a4e4a');
    // Hauer
    for (const side of [-1, 1]) circle(sx - r * 0.15, side * r * 0.42, r * 0.09, '#fff5e0', '#8a4e4a', 1.5);
    const eye = angry ? '#d81f1f' : '#2a1a18';
    circle(r * 0.45, -r * 0.35, r * 0.1, eye);
    circle(r * 0.45, r * 0.35, r * 0.1, eye);
  }

  function drawBear(r, lunge) {
    for (const side of [-1, 1]) circle(r * 0.7 + lunge, side * r * 0.75, r * 0.3, '#6b4423', '#3a2412', 3);
    circle(0, 0, r, '#7a4e2a', '#3a2412', 5);
    circle(-r * 0.15, 0, r * 0.65, '#86582f');
    const hx = r * 0.55 + lunge * 0.5;
    for (const side of [-1, 1]) circle(hx - r * 0.1, side * r * 0.5, r * 0.2, '#6b4423', '#3a2412', 3);
    circle(hx, 0, r * 0.5, '#7a4e2a', '#3a2412', 3);
    ellipse(hx + r * 0.38, 0, r * 0.24, r * 0.2, '#c9a27a', '#3a2412', 2);
    circle(hx + r * 0.55, 0, r * 0.09, '#1d1d1d');
    circle(hx + r * 0.12, -r * 0.2, r * 0.07, '#1d1d1d');
    circle(hx + r * 0.12, r * 0.2, r * 0.07, '#1d1d1d');
  }

  function drawPlayer(p) {
    const r = cfg.PLAYER.radius, isMe = p.id === myId;
    const st = now - p.swingT;
    const sw = st < 0.28 ? Math.sin((st / 0.28) * Math.PI) : 0;
    ctx.save();
    ctx.translate(p.dx, p.dy);
    ctx.rotate(isMe ? myAngle : p.da);
    const [weapon, head, chest] = p.look || [];
    const wDef = cfg.EQUIPMENT[weapon], hDef = cfg.EQUIPMENT[head], cDef = cfg.EQUIPMENT[chest];
    const kind = wDef ? wDef.kind : 'fist';
    if (kind === 'gun') {
      const recoil = st < 0.12 ? (1 - st / 0.12) * 7 : 0;
      ctx.save();
      ctx.translate(r * 0.55 - recoil, r * 0.18);
      drawGun(wDef.model);
      ctx.restore();
      circle(r * 0.62 - recoil, r * 0.28, r * 0.28, '#f0c8a0', '#8a6a4a', 3);
      if (wDef.model !== 'pistol') circle(r * 1.35 - recoil, r * 0.42, r * 0.26, '#f0c8a0', '#8a6a4a', 3);
      else circle(r * 0.45 - recoil, -r * 0.2, r * 0.26, '#f0c8a0', '#8a6a4a', 3);
    } else if (kind === 'bow') {
      // Bogen vorne mit beiden Händen; nach dem Schuss schnellt die Sehne zurück
      const pull = st < 0.3 ? 1 - st / 0.3 : 0;
      ctx.save();
      ctx.translate(r * 0.95, 0);
      drawWeapon(wDef, pull);
      ctx.restore();
      circle(r * 0.95, -r * 0.3, r * 0.28, '#f0c8a0', '#8a6a4a', 3);
      circle(r * 0.5 - pull * 8, r * 0.25, r * 0.28, '#f0c8a0', '#8a6a4a', 3);
    } else if (kind === 'spear') {
      // Speer: Stoß nach vorne statt Schwung
      const thrust = sw * 26;
      ctx.save();
      ctx.translate(r * 0.2 + thrust, r * 0.7);
      ctx.rotate(-0.08);
      drawWeapon(wDef, 0);
      ctx.restore();
      circle(r * 0.72 + thrust, r * 0.75, r * 0.3, '#f0c8a0', '#8a6a4a', 3);
      circle(r * 0.72, -r * 0.72, r * 0.3, '#f0c8a0', '#8a6a4a', 3);
    } else {
      // Axt, Schwert, Dolch in der rechten Hand, schwingen nach vorne (ohne Waffe: Faustschlag)
      const arc = kind === 'dagger' ? 1.0 : kind === 'sword' ? 1.9 : 1.5;
      ctx.save();
      ctx.rotate(0.35 - sw * arc);
      if (wDef) {
        ctx.save();
        ctx.translate(r * 0.55, r * 0.75);
        drawWeapon(wDef, 0);
        ctx.restore();
      }
      circle(r * 0.72 + (wDef ? 0 : sw * 12), r * 0.75, r * 0.3, '#f0c8a0', '#8a6a4a', 3);
      ctx.restore();
      circle(r * 0.72, -r * 0.72, r * 0.3, '#f0c8a0', '#8a6a4a', 3);
    }
    circle(0, 0, r, isMe ? '#f0c8a0' : '#e8bc92', '#8a6a4a', 4);
    if (cDef) {
      // Shirt/Rüstung als Ring um den Körper
      const [c, d] = ARMOR_COLORS[cDef.tier];
      ctx.beginPath();
      ctx.arc(0, 0, r - 3, 0, TAU);
      ctx.strokeStyle = c;
      ctx.lineWidth = 7;
      ctx.stroke();
      circle(0, 0, r + 1, null, d, 2.5);
    }
    if (hDef) {
      const [c, d] = ARMOR_COLORS[hDef.tier];
      circle(-r * 0.12, 0, r * 0.62, c, d, 3);
      if (hDef.tier === 1) rrect(-r * 0.12 - 3, -r * 0.62, 6, r * 1.24, 2, d);
    }
    ctx.restore();

    ctx.font = 'bold 16px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(p.name, p.dx, p.dy - r - 12);
    ctx.fillStyle = isMe ? '#fff' : '#ffe9b0';
    ctx.fillText(p.name, p.dx, p.dy - r - 12);
    if (p.prot) {
      const pulse = 0.5 + Math.sin(now * 3 + p.id) * 0.5;
      const g = ctx.createRadialGradient(p.dx, p.dy, r * 0.8, p.dx, p.dy, r + 16);
      g.addColorStop(0, 'rgba(130,210,255,0)');
      g.addColorStop(1, `rgba(130,210,255,${0.18 + pulse * 0.12})`);
      circle(p.dx, p.dy, r + 16, g, `rgba(170,230,255,${0.45 + pulse * 0.35})`, 2);
    }
    if (p.hp < p.maxHp) hpBar(p.dx, p.dy + r + 10, 52, p.hp / p.maxHp, '#7ed957');
  }

  // Ring um die eigene Figur: sichtbar, solange Ausdauer fehlt oder gesprintet wird
  function drawStaminaRing() {
    const self = players.get(myId);
    if (!self || me.dead) return;
    const max = me.stats.stamina, frac = me.st / max;
    if (frac >= 1 && !self.sprint) {
      staminaFade = Math.max(0, staminaFade - 0.04);
    } else staminaFade = 1;
    if (staminaFade <= 0) return;
    const r = cfg.PLAYER.radius + 11;
    ctx.globalAlpha = staminaFade;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(self.dx, self.dy, r, 0, TAU);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 6;
    ctx.stroke();
    const col = me.ex ? (Math.sin(now * 14) > 0 ? '#ff4040' : '#a01818') : frac > 0.5 ? '#8fe36a' : frac > 0.25 ? '#f5c84a' : '#ff7a4a';
    ctx.beginPath();
    ctx.arc(self.dx, self.dy, r, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
    ctx.strokeStyle = col;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }

  // Gestrichelte Ziellinie bis zur maximalen Schussweite, wenn ein Bogen ausgerüstet ist
  function drawAimLine() {
    const self = players.get(myId);
    if (!self || me.dead || !me.stats.ranged || selected !== 0 || invOpen || charOpen || forgeOpen || buildOpen) return;
    const r = cfg.PLAYER.radius + 14, len = me.stats.range;
    const pr = cfg.EQUIPMENT[me.eq.weapon].projectile, spread = pr.pellets > 1 ? pr.spread : 0;
    ctx.setLineDash([10, 12]);
    ctx.strokeStyle = (me.res[me.ammo] || 0) > 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,90,90,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const da of spread ? [-spread, spread] : [0]) {
      const a = myAngle + da;
      ctx.moveTo(self.dx + Math.cos(a) * r, self.dy + Math.sin(a) * r);
      ctx.lineTo(self.dx + Math.cos(a) * len, self.dy + Math.sin(a) * len);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawGroundItem(it) {
    const bob = Math.sin(now * 3 + it.id) * 3;
    circle(it.x, it.y + 12, 14, 'rgba(0,0,0,0.18)');
    drawItemIcon(it.item, it.x, it.y + bob, 34);
    ctx.font = 'bold 13px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText(String(it.n), it.x + 14, it.y + 18 + bob);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(it.n), it.x + 14, it.y + 18 + bob);
  }

  function drawInventory() {
    const { panel: P, slots } = invLayout();
    rrect(P.x, P.y, P.w, P.h, 14, 'rgba(18,24,14,0.94)', '#4b5d38', 3);
    text('Inventar', P.x + 18, P.y + 27, { size: 18, bold: true, color: '#f2d27a' });
    const used = me.inv.filter(Boolean).length;
    text(`${used}/${slots.length} Slots · [Tab] schließen`, P.x + P.w - 18, P.y + 27, { size: 13, color: '#a8b597', align: 'right' });
    const hoverSlot = invSlotAt(mouse.x, mouse.y);
    slots.forEach((r, i) => {
      const s = me.inv[i];
      const isDragSrc = drag && drag.slot === i;
      const isHover = hoverSlot === i;
      rrect(r.x, r.y, r.w, r.h, 8, isHover ? 'rgba(255,230,140,0.16)' : 'rgba(0,0,0,0.35)',
        isHover && drag ? '#ffd76a' : 'rgba(255,255,255,0.1)', 2);
      if (!s) return;
      ctx.globalAlpha = isDragSrc ? 0.3 : 1;
      drawItemIcon(s[0], r.x + r.w / 2, r.y + r.h / 2 - 3, 38);
      ctx.font = 'bold 14px Segoe UI, sans-serif';
      ctx.textAlign = 'right';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      if (!cfg.EQUIPMENT[s[0]]) ctx.strokeText(String(s[1]), r.x + r.w - 5, r.y + r.h - 6);
      if (!cfg.EQUIPMENT[s[0]]) {
        ctx.fillStyle = s[1] >= stackMax(s[0]) ? '#ffd76a' : '#fff';
        ctx.fillText(String(s[1]), r.x + r.w - 5, r.y + r.h - 6);
      }
      ctx.globalAlpha = 1;
    });
    text('Ziehen: sortieren / droppen · Shift: Hälfte · Rechtsklick: nutzen',
      P.x + P.w / 2, P.y + P.h - 14, { size: 12, color: '#8f9c80', align: 'center' });

    if (!drag && hoverSlot >= 0 && me.inv[hoverSlot]) {
      const [item, n] = me.inv[hoverSlot];
      if (cfg.EQUIPMENT[item]) itemTooltip(item, [['Rechtsklick: ausrüsten', '#a8b597']]);
      else if (cfg.ITEMS.food[item]) itemTooltip(item, [[`× ${n} · Rechtsklick: essen (+${cfg.ITEMS.food[item]} ❤)`, '#cfd8c0']]);
      else itemTooltip(item, [[`× ${n}  (max ${stackMax(item)})`, '#cfd8c0']]);
    }
  }

  function nearForge() {
    return me && me.forge && !me.dead &&
      Math.hypot(me.forge[1] - me.x, me.forge[2] - me.y) <= cfg.STRUCTURES.forge.useRange;
  }

  // ---------- Ausrüstung & Charakter ----------

  const ARMOR_COLORS = [['#9a7650', '#5a4128'], ['#a3aab1', '#545a60']]; // Fell, Eisen
  const itemName = (item) => (cfg.EQUIPMENT[item] ? cfg.EQUIPMENT[item].name : cfg.ITEMS.names[item] || item);
  const stackMax = (item) => (cfg.EQUIPMENT[item] ? 1 : cfg.INVENTORY.stack[item]);
  const STAT_LABELS = {
    damage: 'Schaden', gather: 'Abbau', armor: 'Rüstung', maxHp: 'Leben', speed: 'Tempo', regen: 'Regeneration', stamina: 'Ausdauer',
  };
  // Waffen: absolute Werte; Kleidung: Boni mit Vorzeichen
  function fmtStats(def) {
    const st = def.stats;
    if (def.slot === 'weapon') {
      const pellets = def.projectile && def.projectile.pellets;
      const parts = [pellets ? `${pellets}×${st.damage} Schaden` : `${st.damage} Schaden`, `${st.attackSpeed || +(1 / cfg.PLAYER.attackCooldown).toFixed(1)}/s`];
      if (st.range) parts.push(`Weite ${st.range}`);
      else parts.push(`Reichw. ${st.reach || cfg.PLAYER.reach}`);
      if (def.ammo) parts.push(cfg.AMMO[def.ammo].label);
      else parts.push(st.gather ? `×${st.gather} Abbau` : 'kein Abbau');
      return parts.join(' · ');
    }
    return Object.entries(st).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${STAT_LABELS[k] || k}`).join(' · ');
  }

  // Waffe entlang der +x-Achse ab Ursprung (Griff). Wird für Icons und in der Hand benutzt.
  function drawWeapon(def, pull) {
    const c = LEVEL_COLORS[def.tier], d = LEVEL_DARK[def.tier];
    if (def.kind === 'gun') return drawGun(def.model);
    switch (def.kind) {
      case 'sword':
        rrect(-6, -3, 16, 6, 2, '#6b4524', '#3a2412', 2);
        rrect(9, -9, 5, 18, 2, d);
        ctx.beginPath();
        ctx.moveTo(14, -4.5); ctx.lineTo(54, -4.5); ctx.lineTo(62, 0); ctx.lineTo(54, 4.5); ctx.lineTo(14, 4.5);
        ctx.closePath();
        ctx.fillStyle = c; ctx.fill();
        ctx.strokeStyle = d; ctx.lineWidth = 2; ctx.stroke();
        break;
      case 'dagger':
        rrect(-4, -2.5, 12, 5, 2, '#6b4524', '#3a2412', 2);
        rrect(7, -6, 4, 12, 2, d);
        ctx.beginPath();
        ctx.moveTo(11, -3.5); ctx.lineTo(28, -3); ctx.lineTo(34, 0); ctx.lineTo(28, 3); ctx.lineTo(11, 3.5);
        ctx.closePath();
        ctx.fillStyle = c; ctx.fill();
        ctx.strokeStyle = d; ctx.lineWidth = 2; ctx.stroke();
        break;
      case 'spear':
        rrect(-30, -2.5, 92, 5, 2, '#8a6236', '#4a3019', 2);
        ctx.beginPath();
        ctx.moveTo(60, -7); ctx.lineTo(80, 0); ctx.lineTo(60, 7);
        ctx.closePath();
        ctx.fillStyle = c; ctx.fill();
        ctx.strokeStyle = d; ctx.lineWidth = 2; ctx.stroke();
        break;
      case 'bow': {
        // Bogen quer zur Blickrichtung, Sehne wird beim Spannen zurückgezogen
        const back = -6 - (pull || 0) * 14;
        ctx.beginPath();
        ctx.moveTo(0, -30);
        ctx.quadraticCurveTo(22, 0, 0, 30);
        ctx.strokeStyle = d; ctx.lineWidth = 7; ctx.stroke();
        ctx.strokeStyle = c; ctx.lineWidth = 4; ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -30); ctx.lineTo(back, 0); ctx.lineTo(0, 30);
        ctx.strokeStyle = 'rgba(240,240,230,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
        break;
      }
      default: // Axt
        rrect(0, -3.5, 46, 7, 3, '#7a5230', '#4a3019', 2);
        rrect(34, -16, 14, 22, 3, c, d, 3);
    }
  }

  // Feuerwaffen von oben, Lauf zeigt in +x, Griff bei 0
  function drawGun(model) {
    const metal = '#3c4046', dark = '#1e2125', wood = '#7a4f2a';
    if (model === 'pistol') {
      rrect(-4, -4, 12, 8, 2, dark);
      rrect(4, -3.5, 26, 7, 2, metal, dark, 2);
      rrect(26, -2, 6, 4, 1, dark);
    } else if (model === 'shotgun') {
      rrect(-22, -5, 26, 10, 4, wood, '#4a2f17', 2);
      rrect(2, -5, 18, 10, 2, metal, dark, 2);
      rrect(18, -4.5, 46, 4, 1.5, '#55595f', dark, 1.5);
      rrect(18, 0.5, 46, 4, 1.5, '#55595f', dark, 1.5);
      rrect(26, 4, 16, 4, 1.5, wood);
    } else {
      rrect(-26, -4.5, 28, 9, 3, wood, '#4a2f17', 2);
      rrect(0, -4, 30, 8, 2, metal, dark, 2);
      rrect(28, -2, 46, 4, 1.5, '#55595f', dark, 1.5);
      rrect(8, -8, 16, 4, 1.5, dark); // Zielfernrohr
    }
  }

  // Symbol für ein Ausrüstungsteil (Koordinaten wie drawItemIcon: Mitte 0/0, Größe 40)
  function drawEquipShape(def) {
    if (def.slot === 'weapon') {
      ctx.save();
      if (def.kind === 'bow') ctx.translate(-6, 0);
      else {
        ctx.rotate(-0.75);
        const len = def.kind === 'gun' ? { pistol: 36, shotgun: 86, rifle: 100 }[def.model] : { sword: 62, dagger: 34, spear: 110 }[def.kind] || 48;
        const k = Math.min(1, 46 / len);
        ctx.scale(k, k);
        ctx.translate(def.kind === 'gun' && def.model !== 'pistol' ? -len / 2 + 22 : -len / 2, 0);
      }
      drawWeapon(def, 0);
      ctx.restore();
      return;
    }
    const [c, d] = ARMOR_COLORS[def.tier] || ARMOR_COLORS[0];
    ctx.fillStyle = c;
    ctx.strokeStyle = d;
    ctx.lineWidth = 3;
    if (def.slot === 'head') {
      ctx.beginPath();
      ctx.arc(0, 4, 14, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      rrect(-18, 2, 36, 7, 3, c, d, 3);
      if (def.tier === 1) rrect(-2.5, -10, 5, 12, 2, d);
    } else if (def.slot === 'chest') {
      poly([[-8, -15], [8, -15], [18, -8], [14, 0], [9, -3], [9, 15], [-9, 15], [-9, -3], [-14, 0], [-18, -8]]);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -15, 4.5, 0, Math.PI);
      ctx.stroke();
    } else if (def.slot === 'legs') {
      poly([[-11, -15], [11, -15], [12, 15], [3, 15], [0, -3], [-3, 15], [-12, 15]]);
      ctx.fill();
      ctx.stroke();
      rrect(-11, -15, 22, 5, 2, d);
    } else if (def.slot === 'feet') {
      for (const ox of [-8, 8]) {
        poly([[ox - 5, -13], [ox + 3, -13], [ox + 3, 6], [ox + 9, 9], [ox + 9, 14], [ox - 5, 14]]);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  function charLayout() {
    const w = 470, h = 410;
    const x = Math.round(invOpen ? W / 2 + 8 : W / 2 - w / 2);
    const y = Math.round(Math.max(80, H / 2 - h / 2 - 40));
    const cx = x + 125, size = 60;
    const slots = {
      head: { x: cx - 30, y: y + 56, w: size, h: size },
      chest: { x: cx - 30, y: y + 126, w: size, h: size },
      legs: { x: cx - 30, y: y + 196, w: size, h: size },
      feet: { x: cx - 30, y: y + 266, w: size, h: size },
      weapon: { x: x + 20, y: y + 126, w: size, h: size },
    };
    return { panel: { x, y, w, h }, slots };
  }

  function eqSlotAt(sx, sy) {
    if (!charOpen || !cfg) return null;
    const { slots } = charLayout();
    return Object.keys(slots).find((k) => inRect(sx, sy, slots[k])) || null;
  }

  // Tooltips werden gesammelt und erst nach allen Fenstern gezeichnet, damit nichts sie verdeckt
  function itemTooltip(item, extra) {
    pendingTooltip = () => drawItemTooltip(item, extra);
  }

  function drawItemTooltip(item, extra) {
    const def = cfg.EQUIPMENT[item];
    const lines = [[itemName(item), '#ffe08a', true]];
    if (def) {
      lines.push([cfg.EQUIP_SLOTS.find((s) => s.id === def.slot).name, '#a8b597']);
      lines.push([fmtStats(def), '#cfd8c0']);
    }
    for (const l of extra || []) lines.push(l);
    ctx.font = '14px Segoe UI, sans-serif';
    const w = Math.max(...lines.map(([t]) => ctx.measureText(t).width)) + 24, h = lines.length * 20 + 12;
    let x = mouse.x + 16, y = mouse.y + 16;
    if (x + w > W) x = mouse.x - w - 10;
    if (y + h > H) y = mouse.y - h - 10;
    panel(x, y, w, h);
    lines.forEach(([t, c, b], i) => text(t, x + 12, y + 22 + i * 20, { size: 14, color: c, bold: b }));
  }

  function drawCharacter() {
    const { panel: P, slots } = charLayout();
    const st = me.stats, B = cfg.PLAYER;
    rrect(P.x, P.y, P.w, P.h, 14, 'rgba(18,24,14,0.95)', '#4b5d38', 3);
    text('🧍 Charakter', P.x + 18, P.y + 29, { size: 18, bold: true, color: '#f2d27a' });
    text(`Level ${me.lvl} · ${me.xp}/${me.xpNext} EP${me.sp ? ` · ${me.sp} Skillpunkt(e) [K]` : ''}`, P.x + 160, P.y + 29, { size: 12, color: me.sp ? '#ffd76a' : '#a8b597' });
    text('[C] schließen', P.x + P.w - 18, P.y + 29, { size: 12, color: '#a8b597', align: 'right' });

    // Silhouette hinter den Slots
    const cx = P.x + 125;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx, P.y + 86); ctx.lineTo(cx, P.y + 296);
    ctx.moveTo(slots.weapon.x + 60, P.y + 156); ctx.lineTo(cx + 80, P.y + 156);
    ctx.stroke();

    const hoverEq = eqSlotAt(mouse.x, mouse.y);
    for (const sl of cfg.EQUIP_SLOTS) {
      const r = slots[sl.id], item = me.eq[sl.id];
      const dragging = drag && drag.eq === sl.id;
      // Beim Ziehen passende Slots hervorheben
      const dragItem = drag && drag.slot !== undefined && me.inv[drag.slot] && me.inv[drag.slot][0];
      const fits = dragItem && cfg.EQUIPMENT[dragItem] && cfg.EQUIPMENT[dragItem].slot === sl.id;
      rrect(r.x, r.y, r.w, r.h, 8, hoverEq === sl.id ? 'rgba(255,230,140,0.16)' : 'rgba(0,0,0,0.4)',
        fits ? '#9fe870' : 'rgba(255,255,255,0.14)', fits ? 3 : 2);
      if (item) {
        ctx.globalAlpha = dragging ? 0.3 : 1;
        drawItemIcon(item, r.x + r.w / 2, r.y + r.h / 2, 40);
        ctx.globalAlpha = 1;
      } else {
        text(sl.name, r.x + r.w / 2, r.y + r.h / 2 + 5, { size: 12, color: 'rgba(255,255,255,0.3)', align: 'center' });
      }
    }
    text('Waffe', slots.weapon.x + 30, slots.weapon.y + 76, { size: 11, color: '#8f9c80', align: 'center' });

    // Werte
    const sx = P.x + 230, sy = P.y + 68;
    text('Werte', sx, sy, { size: 15, bold: true, color: '#e9eedd' });
    const weapon = me.eq.weapon ? itemName(me.eq.weapon) : 'Faust';
    const rows = [
      ['❤', 'Leben', st.maxHp, st.maxHp - B.hp],
      ['🛡', 'Rüstung', `${st.armor}  (−${Math.round(st.reduction * 100)}% Schaden)`, st.armor],
      ['⚔', 'Schaden', `${st.damage}  (${weapon})`, 0],
      ['⛏', 'Abbau', `×${st.gather}`, 0],
      ['👟', 'Tempo', st.speed, st.speed - B.speed],
      ['⏱', 'Angriffe/s', st.attackSpeed, 0],
      ['✚', 'Regeneration', `${st.regen}/s`, +(st.regen - B.regen).toFixed(1)],
      st.ranged ? ['🏹', 'Schussweite', `${st.range}  (${me.res[me.ammo] || 0}× ${itemName(me.ammo)})`, 0] : ['↔', 'Reichweite', st.reach, st.reach - B.reach],
      ['⚡', 'Ausdauer', st.stamina, st.stamina - B.stamina],
    ];
    rows.forEach(([icon, label, val, bonus], i) => {
      const y = sy + 30 + i * 30;
      rrect(sx - 6, y - 19, 222, 26, 6, i % 2 ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.32)');
      text(`${icon}  ${label}`, sx + 2, y, { size: 13, color: '#cfd8c0' });
      text(String(val), sx + 208, y, { size: 13, bold: true, align: 'right', color: bonus > 0 ? '#9fe870' : bonus < 0 ? '#ff8a7a' : '#fff' });
    });
    text('Ziehen oder Rechtsklick: an-/ablegen · rausziehen = droppen', P.x + P.w / 2, P.y + P.h - 14,
      { size: 12, color: '#8f9c80', align: 'center' });

    if (!drag && hoverEq && me.eq[hoverEq]) itemTooltip(me.eq[hoverEq], [['Rechtsklick: ablegen', '#a8b597']]);
  }

  // ---------- Schmiede ----------

  function forgeLayout() {
    const recipes = [
      ...Object.keys(cfg.EQUIPMENT).filter((id) => cfg.EQUIPMENT[id].recipe && cfg.EQUIPMENT[id].tab === forgeTab),
      ...Object.keys(cfg.ITEMS.recipes).filter((id) => cfg.ITEMS.recipes[id].tab === forgeTab),
    ];
    const cols = 2, cw = 270, ch = 96, gap = 8, pad = 18, head = 44, tabH = 34;
    const rows = Math.ceil(recipes.length / cols);
    const w = pad * 2 + cols * cw + gap;
    const h = head + tabH + 12 + rows * (ch + gap) + 10;
    const x = Math.round(W / 2 - w / 2), y = Math.round(Math.max(60, H / 2 - h / 2 - 40));
    const tabs = cfg.FORGE_TABS.map(({ id, name }, i) =>
      ({ id, name, rect: { x: x + pad + i * 108, y: y + head, w: 100, h: tabH } }));
    const cards = recipes.map((id, i) => {
      const rect = { x: x + pad + (i % cols) * (cw + gap), y: y + head + tabH + 12 + Math.floor(i / cols) * (ch + gap), w: cw, h: ch };
      return { id, rect, btn: { x: rect.x + rect.w - 92, y: rect.y + rect.h - 34, w: 82, h: 26 } };
    });
    return { panel: { x, y, w, h }, tabs, cards };
  }

  function drawForge() {
    const { panel: P, tabs, cards } = forgeLayout();
    const forgeLv = me.forge ? me.forge[3] + 1 : 0;
    rrect(P.x, P.y, P.w, P.h, 14, 'rgba(24,18,14,0.96)', '#7a5a34', 3);
    text(`⚒️ Schmiede · Lv ${forgeLv}`, P.x + 18, P.y + 29, { size: 18, bold: true, color: '#f2d27a' });
    text('[F] schließen · höheres Level mit [E] an der Schmiede', P.x + P.w - 18, P.y + 29, { size: 12, color: '#a8977f', align: 'right' });
    for (const t of tabs) {
      const active = t.id === forgeTab;
      rrect(t.rect.x, t.rect.y, t.rect.w, t.rect.h, 8, active ? '#c98a3c' : 'rgba(0,0,0,0.3)', active ? '#8a5a20' : 'rgba(255,255,255,0.1)', 2);
      text(t.name, t.rect.x + t.rect.w / 2, t.rect.y + 22, { size: 14, bold: true, align: 'center', color: active ? '#1f1409' : '#e9e0d0' });
    }
    for (const { id, rect: r, btn } of cards) {
      const stack = !cfg.EQUIPMENT[id];
      const def = stack ? { name: itemName(id), recipe: cfg.ITEMS.recipes[id] } : cfg.EQUIPMENT[id], rc = def.recipe;
      const lvOk = forgeLv >= rc.forge, afford = canAfford(rc.cost), ok = lvOk && afford;
      const owned = !stack && me.eq[def.slot] === id;
      rrect(r.x, r.y, r.w, r.h, 10, 'rgba(0,0,0,0.35)', owned ? '#9fe870' : 'rgba(255,255,255,0.1)', 2);
      ctx.globalAlpha = lvOk ? 1 : 0.4;
      drawItemIcon(id, r.x + 30, r.y + 32, 40);
      ctx.globalAlpha = 1;
      text(def.name, r.x + 58, r.y + 22, { size: 14, bold: true, color: lvOk ? '#fff' : '#999' });
      if (owned) text('angelegt', r.x + r.w - 10, r.y + 22, { size: 11, color: '#9fe870', align: 'right' });
      text(stack ? `${rc.amount}× pro Herstellung · im Inventar: ${me.res[id] || 0}` : fmtStats(def), r.x + 58, r.y + 40, { size: 11, color: '#cfb994' });
      // Kosten mit vorhanden/benötigt-Farbe
      let cx = r.x + 10;
      ctx.font = '12px Segoe UI, sans-serif';
      for (const [k, v] of Object.entries(rc.cost)) {
        const t = `${v}${RES_ICON[k]}`;
        text(t, cx, r.y + 62, { size: 12, color: (me.res[k] || 0) >= v ? '#9fe870' : '#ff8a7a' });
        cx += ctx.measureText(t).width + 8;
      }
      text(lvOk ? '' : `Schmiede Lv ${rc.forge} nötig`, r.x + 10, r.y + r.h - 12, { size: 11, color: '#ff8a7a' });
      const hover = inRect(mouse.x, mouse.y, btn);
      rrect(btn.x, btn.y, btn.w, btn.h, 7, ok ? (hover ? '#92c453' : '#7fae45') : '#4a4a44', ok ? '#5a8130' : '#333', 2);
      text('Herstellen', btn.x + btn.w / 2, btn.y + 18, { size: 12, bold: true, align: 'center', color: ok ? '#13200a' : '#888' });
    }
  }

  function drawDragged() {
    const s = drag.eq ? [me.eq[drag.eq], 1] : me.inv[drag.slot];
    if (!s || !s[0]) return;
    const n = drag.half ? Math.ceil(s[1] / 2) : s[1];
    drawItemIcon(s[0], mouse.x, mouse.y, 42);
    if (!cfg.EQUIPMENT[s[0]]) text(String(n), mouse.x + 18, mouse.y + 22, { size: 14, bold: true });
    const overPanel = (invOpen && inRect(mouse.x, mouse.y, invLayout().panel)) || (charOpen && inRect(mouse.x, mouse.y, charLayout().panel));
    if (!overPanel) {
      text('Loslassen zum Droppen', mouse.x, mouse.y - 30, { size: 13, bold: true, align: 'center', color: '#ffd76a' });
    }
  }

  function drawGhost() {
    if (invOpen || forgeOpen || buildOpen || charOpen) return;
    if (selected === 0 || !buildType || me.dead) return;
    const type = buildType;
    const wm = screenToWorld(mouse.x, mouse.y);
    const g = snap(type, wm.x, wm.y);
    const err = placementError(type, g);
    ctx.globalAlpha = 0.55;
    drawStruct({ type, x: g.x, y: g.y, level: 0, hp: 1, maxHp: 1, owner: myId, angle: -Math.PI / 2 }, true);
    ctx.globalAlpha = 1;
    ctx.fillStyle = err ? 'rgba(255,60,60,0.35)' : 'rgba(90,255,90,0.25)';
    ctx.fillRect(g.x - g.half, g.y - g.half, g.half * 2, g.half * 2);
    if (type === 'turret') {
      ctx.beginPath();
      ctx.arc(g.x, g.y, cfg.STRUCTURES.turret.levels[0].range, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ---------- Schatten ----------

  // Wie "hoch" Objekte sind (bestimmt die Länge der Sonnenschatten).
  // Ressourcen relativ zum Radius, Gebäude in Welteinheiten.
  const RES_HEIGHT = { tree: 1.5, rock: 0.55, gold: 0.5, crate: 1 };
  const RUIN_HEIGHT = 40;
  const STRUCT_HEIGHT = { core: 60, wall: 42, door: 30, window: 42, spike: 10, turret: 55, mine: 28, forge: 38 };

  // Sonnenstand aus der Tageszeit: morgens Schatten lang nach Westen,
  // mittags kurz nach Norden, abends lang nach Osten. Nachts keine Sonne.
  function sunState() {
    const [, night, p] = tm;
    if (night) return null;
    const fade = Math.min(1, p / 0.05) * Math.min(1, (1 - p) / 0.1);
    if (fade <= 0.01) return null;
    const a = Math.PI + p * Math.PI;
    const len = Math.min(1.8, 0.5 / (Math.sin(Math.PI * p) + 0.25));
    return { dx: Math.cos(a) * len, dy: Math.sin(a) * len, alpha: 0.3 * fade };
  }

  // Konvexe Hülle (Monotone Chain) für den Schatten eines Quaders
  function convexHull(pts) {
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  // Alle Sonnenschatten erst deckend auf eine eigene Ebene, dann halbtransparent auf den Boden –
  // so werden sich überlappende Schatten nicht doppelt dunkel.
  function drawSunShadows(x0, y0, x1, y1) {
    const sun = sunState();
    if (!sun || !sunCanvas.width) return;
    const g = sunCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, sunCanvas.width, sunCanvas.height);
    g.setTransform(ctx.getTransform());
    g.fillStyle = g.strokeStyle = '#000';
    g.lineCap = 'round';
    const m = 160;
    const vis = (x, y, r) => x > x0 - m - r && x < x1 + m + r && y > y0 - m - r && y < y1 + m + r;
    // Rundes Objekt: Kreis, der entlang des Sonnenvektors gezogen wird (= dicke Linie mit runden Enden)
    const capsule = (x, y, r, h) => {
      g.lineWidth = r * 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + sun.dx * h + 0.01, y + sun.dy * h);
      g.stroke();
    };
    for (const r of resources) {
      if (!vis(r.x, r.y, r.r)) continue;
      const rr = r.r * resScale(r);
      capsule(r.x, r.y, rr * 0.88, rr * RES_HEIGHT[r.type]);
    }
    // Quader: Hülle aus Grundfläche und um den Sonnenvektor verschobener Grundfläche
    const box = (x, y, h, len) => {
      const ox = sun.dx * len, oy = sun.dy * len, pts = [];
      for (const [cx, cy] of [[-h, -h], [h, -h], [h, h], [-h, h]]) pts.push([x + cx, y + cy], [x + cx + ox, y + cy + oy]);
      const hull = convexHull(pts);
      g.beginPath();
      hull.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.closePath();
      g.fill();
    };
    for (const s of structs.values()) {
      if (vis(s.x, s.y, 60)) box(s.x, s.y, (cfg.STRUCTURES[s.type].size * cfg.TILE) / 2 - 3, STRUCT_HEIGHT[s.type] || 30);
    }
    for (const [x, y] of world.ruinTiles) if (vis(x, y, 30)) box(x, y, cfg.TILE / 2 - 1, RUIN_HEIGHT);
    for (const z of zombies.values()) {
      if (vis(z.dx, z.dy, 40)) { const r = cfg.ENEMIES[z.type].r; capsule(z.dx, z.dy, r * 0.85, r * 1.1); }
    }
    const pr = cfg.PLAYER.radius;
    for (const p of players.values()) if (vis(p.dx, p.dy, 40)) capsule(p.dx, p.dy, pr * 0.85, 32);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = sun.alpha;
    ctx.drawImage(sunCanvas, 0, 0);
    ctx.restore();
  }

  // Schattenpolygone (Weltkoordinaten), die Hindernisse für eine Punktlichtquelle werfen.
  // Fenster lassen Licht durch, die Quelle selbst wirft keinen Schatten.
  function lightShadows(lx, ly, R, source) {
    const out = [], far = R * 3;
    const ray = (x, y) => {
      const a = Math.atan2(y - ly, x - lx);
      return [lx + Math.cos(a) * far, ly + Math.sin(a) * far];
    };
    for (const r of resources) {
      const rr = r.r * resScale(r) * 0.9, dx = r.x - lx, dy = r.y - ly, d = Math.hypot(dx, dy);
      if (d > R + rr || d <= rr + 2) continue;
      // Tangenten vom Licht an den Kreis
      const th = Math.atan2(dy, dx), al = Math.asin(rr / d), t = Math.sqrt(d * d - rr * rr);
      const t1 = [lx + Math.cos(th - al) * t, ly + Math.sin(th - al) * t];
      const t2 = [lx + Math.cos(th + al) * t, ly + Math.sin(th + al) * t];
      out.push([t1, ray(...t1), ray(...t2), t2]);
    }
    // Quadrat: Silhouette = die beiden Ecken mit kleinstem/größtem Winkel (relativ zur Richtung zur Mitte)
    const square = (sx, sy, h) => {
      if (Math.abs(sx - lx) > R + h || Math.abs(sy - ly) > R + h) return;
      if (Math.abs(sx - lx) < h && Math.abs(sy - ly) < h) return; // Licht steht im Hindernis
      const base = Math.atan2(sy - ly, sx - lx);
      let lo = null, hi = null, loA = Infinity, hiA = -Infinity;
      for (const [cx, cy] of [[-h, -h], [h, -h], [h, h], [-h, h]]) {
        const px = sx + cx, py = sy + cy;
        let a = Math.atan2(py - ly, px - lx) - base;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        if (a < loA) { loA = a; lo = [px, py]; }
        if (a > hiA) { hiA = a; hi = [px, py]; }
      }
      out.push([lo, ray(...lo), ray(...hi), hi]);
    };
    for (const s of structs.values()) {
      if (s === source || cfg.STRUCTURES[s.type].shootThrough) continue;
      square(s.x, s.y, (cfg.STRUCTURES[s.type].size * cfg.TILE) / 2 - 2);
    }
    for (const [x, y] of world.ruinTiles) square(x, y, cfg.TILE / 2 - 1);
    return out;
  }

  function drawLighting() {
    const dark = darkness();
    if (dark < 0.01 || !shadow.width || !shadow.height) return;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, shadow.width, shadow.height);
    sctx.fillStyle = `rgba(6,10,32,${dark})`;
    sctx.fillRect(0, 0, shadow.width, shadow.height);
    sctx.globalCompositeOperation = 'destination-out';
    // Jede Lichtquelle wird einzeln gerendert: Lichtkegel minus Schatten der Hindernisse,
    // dann aus der Dunkelheit herausgeschnitten.
    const light = (wx, wy, wr, source) => {
      const p = worldToScreen(wx, wy), s = scale * dpr, r = Math.ceil(wr * s), x = p.x * dpr, y = p.y * dpr;
      if (x < -r || y < -r || x > shadow.width + r || y > shadow.height + r) return;
      if (lightCanvas.width < r * 2 || lightCanvas.height < r * 2) lightCanvas.width = lightCanvas.height = r * 2;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.globalCompositeOperation = 'source-over';
      lctx.clearRect(0, 0, r * 2, r * 2);
      const g = lctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.75)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = g;
      lctx.fillRect(0, 0, r * 2, r * 2);
      lctx.globalCompositeOperation = 'destination-out';
      lctx.setTransform(s, 0, 0, s, r - wx * s, r - wy * s);
      lctx.fillStyle = '#000';
      for (const poly of lightShadows(wx, wy, wr, source)) {
        lctx.beginPath();
        poly.forEach(([px, py], i) => (i ? lctx.lineTo(px, py) : lctx.moveTo(px, py)));
        lctx.closePath();
        lctx.fill();
      }
      sctx.drawImage(lightCanvas, 0, 0, r * 2, r * 2, x - r, y - r, r * 2, r * 2);
    };
    for (const p of players.values()) light(p.dx, p.dy, 260, null);
    for (const s of structs.values()) {
      if (s.type === 'core') light(s.x, s.y, 240 + s.level * 30, s);
      else if (s.type === 'turret') light(s.x, s.y, 110, s);
      else if (s.type === 'forge') light(s.x, s.y, 140, s);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(shadow, 0, 0);
  }

  // ---------- Weltkarte (M) ----------

  // Statischer Teil (Boden, Wege, Seen, Städte) wird nur bei Größenänderung neu gezeichnet
  function buildMapCache(S) {
    const px = Math.round(S * dpr);
    mapCache.width = mapCache.height = px;
    const g = mapCache.getContext('2d'), k = px / cfg.WORLD_SIZE;
    g.imageSmoothingEnabled = true;
    g.drawImage(groundCanvas, 0, 0, world.n, world.n, 0, 0, px, px);
    g.lineCap = g.lineJoin = 'round';
    for (const pts of world.roads) {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
      g.strokeStyle = 'rgba(110,88,55,0.7)';
      g.lineWidth = Math.max(3, 86 * k);
      g.stroke();
      g.strokeStyle = '#b39a6c';
      g.lineWidth = Math.max(2, 60 * k);
      g.stroke();
    }
    for (const [grow, color] of [[34, '#d2bf88'], [0, '#3c7fb6'], [-40, '#4a8fc6']]) {
      g.beginPath();
      for (const [x, y, r] of world.lakes) {
        if (r + grow <= 0) continue;
        g.moveTo((x + r + grow) * k, y * k);
        g.arc(x * k, y * k, (r + grow) * k, 0, TAU);
      }
      g.fillStyle = color;
      g.fill();
    }
    for (const c of world.cities) {
      g.fillStyle = 'rgba(70,62,50,0.75)';
      for (const [bx, by, bw, bh] of c.buildings) g.fillRect(bx * k, by * k, Math.max(2, bw * k), Math.max(2, bh * k));
      g.font = `bold ${Math.round(13 * dpr)}px Segoe UI, sans-serif`;
      g.textAlign = 'center';
      g.lineWidth = 3 * dpr;
      g.strokeStyle = 'rgba(0,0,0,0.65)';
      g.strokeText(c.name, c.x * k, (c.y - c.r) * k - 4 * dpr);
      g.fillStyle = '#ffe9b0';
      g.fillText(c.name, c.x * k, (c.y - c.r) * k - 4 * dpr);
    }
    mapCache.size = S;
  }

  function drawWorldMap() {
    const S = Math.floor(Math.min(W - 80, H - 130)), x = Math.round((W - S) / 2), y = Math.round((H - S) / 2 + 12);
    const WS = cfg.WORLD_SIZE, k = S / WS;
    if (mapCache.size !== S || mapCache.width !== Math.round(S * dpr)) buildMapCache(S);
    const mx = (wx) => x + wx * k, my = (wy) => y + wy * k;
    ctx.fillStyle = 'rgba(5,8,4,0.6)';
    ctx.fillRect(0, 0, W, H);
    rrect(x - 14, y - 46, S + 28, S + 60, 14, 'rgba(18,24,14,0.96)', '#4b5d38', 3);
    text('🗺️ Weltkarte', x, y - 18, { size: 18, bold: true, color: '#f2d27a' });
    text('[M] schließen', x + S, y - 18, { size: 12, color: '#a8b597', align: 'right' });
    ctx.drawImage(mapCache, x, y, S, S);

    // Planquadrate A–J / 1–10
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 10; i++) {
      ctx.moveTo(x + (S * i) / 10, y); ctx.lineTo(x + (S * i) / 10, y + S);
      ctx.moveTo(x, y + (S * i) / 10); ctx.lineTo(x + S, y + (S * i) / 10);
    }
    ctx.stroke();
    for (let i = 0; i < 10; i++) {
      text('ABCDEFGHIJ'[i], x + (S * (i + 0.5)) / 10, y + 13, { size: 10, bold: true, align: 'center', color: 'rgba(255,255,255,0.45)' });
      text(String(i + 1), x + 5, y + (S * (i + 0.5)) / 10 + 4, { size: 10, bold: true, color: 'rgba(255,255,255,0.45)' });
    }

    // Eigene Basis & Schmiede
    if (me.core) {
      ctx.beginPath();
      ctx.arc(mx(me.core[1]), my(me.core[2]), Math.max(5, me.core[4] * k), 0, TAU);
      ctx.fillStyle = 'rgba(120,200,255,0.3)';
      ctx.fill();
      rrect(mx(me.core[1]) - 5, my(me.core[2]) - 5, 10, 10, 2, '#86e6ff', '#0b3a4a', 2);
    }
    if (me.forge) rrect(mx(me.forge[1]) - 3.5, my(me.forge[2]) - 3.5, 7, 7, 1.5, '#ff9a3c', '#3a1a00', 1.5);
    // Gegner aus dem Radar-Umkreis, andere Spieler
    const e = minimap.e;
    for (let i = 0; i < e.length; i += 3) circle(mx(e[i] * 10), my(e[i + 1] * 10), e[i + 2] ? 2.5 : 2, e[i + 2] ? '#ff3b3b' : 'rgba(240,170,165,0.8)');
    const pp = minimap.p;
    for (let i = 0; i < pp.length; i += 2) circle(mx(pp[i] * 10), my(pp[i + 1] * 10), 4, '#ffe08a', '#000', 1.5);
    // Eigene Position als Pfeil in Blickrichtung, mit pulsierendem Ring
    const sx = mx(me.x), sy = my(me.y);
    ctx.beginPath();
    ctx.arc(sx, sy, 9 + Math.sin(now * 4) * 3, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(myAngle);
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(-6, -6); ctx.lineTo(-3, 0); ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Fußzeile: eigenes Planquadrat + Planquadrat unter der Maus
    const sector = (wx, wy) => 'ABCDEFGHIJ'[Math.min(9, Math.floor(wx / (WS / 10)))] + (Math.min(9, Math.floor(wy / (WS / 10))) + 1);
    let foot = `Du: ${sector(me.x, me.y)}`;
    if (inRect(mouse.x, mouse.y, { x, y, w: S, h: S })) {
      const wx = (mouse.x - x) / k, wy = (mouse.y - y) / k;
      foot += `  ·  Maus: ${sector(wx, wy)} (${Math.round(Math.hypot(wx - me.x, wy - me.y))} entfernt)`;
    }
    text(foot, x + S / 2, y - 18, { size: 12, align: 'center', color: '#cfd8c0' });
  }

  // ---------- HUD ----------

  // HOTBAR_SIZE Item-Slots und dahinter (mit etwas Abstand) der Bau-Button
  function hotbarRects() {
    const n = cfg ? cfg.HOTBAR_SIZE : 6, size = 60, gap = 6, sep = 18;
    const total = (n + 1) * size + n * gap + sep;
    const x0 = Math.round(W / 2 - total / 2), y = H - size - 30;
    const rects = [];
    for (let i = 0; i < n; i++) rects.push({ x: x0 + i * (size + gap), y, w: size, h: size });
    rects.push({ x: x0 + n * (size + gap) + sep, y, w: size, h: size });
    return rects;
  }

  function panel(x, y, w, h) { rrect(x, y, w, h, 10, 'rgba(10,14,8,0.62)', 'rgba(255,255,255,0.08)', 2); }

  function text(str, x, y, { size = 15, color = '#fff', align = 'left', bold = false } = {}) {
    ctx.font = `${bold ? 'bold ' : ''}${size}px Segoe UI, sans-serif`;
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function drawHotbar() {
    const rects = hotbarRects(), rb = rects[cfg.HOTBAR_SIZE];
    const slotBg = (r, active, border) => rrect(r.x, r.y, r.w, r.h, 10, active ? 'rgba(255,230,140,0.28)' : 'rgba(10,14,8,0.62)',
      border || (active ? '#ffd76a' : 'rgba(255,255,255,0.12)'), active ? 3 : 2);
    const hoverSlot = rects.findIndex((r) => inRect(mouse.x, mouse.y, r));
    const dragging = drag && drag.slot !== undefined;

    for (let i = 0; i < cfg.HOTBAR_SIZE; i++) {
      const r = rects[i], item = me.hb[i];
      const def = item && cfg.EQUIPMENT[item];
      const equipped = def && me.eq[def.slot] === item;
      const count = item ? me.res[item] || 0 : 0;
      const usable = item && (equipped || count > 0);
      // Aktiver Slot = ausgerüstete Waffe bzw. gewählte Munition
      const active = !!item && selected === 0 && (equipped && def.slot === 'weapon' || item === me.ammo);
      slotBg(r, active, dragging && hoverSlot === i ? '#9fe870' : equipped ? '#9fe870' : null);
      text(String(i + 1), r.x + 6, r.y + 15, { size: 11, color: '#ddd', bold: true });
      if (!item) continue;
      ctx.globalAlpha = usable ? 1 : 0.35;
      drawItemIcon(item, r.x + r.w / 2, r.y + r.h / 2 - 3, 36);
      ctx.globalAlpha = 1;
      if (!def) text(String(count), r.x + r.w - 5, r.y + r.h - 6, { size: 12, bold: true, align: 'right', color: count ? '#fff' : '#ff8a7a' });
      else if (equipped) text('E', r.x + r.w - 6, r.y + 15, { size: 11, bold: true, align: 'right', color: '#9fe870' });
      // Fernwaffe: Munitionsvorrat in der Ecke
      if (equipped && def.ammo) {
        const n = me.res[me.ammo] || 0;
        text(String(n), r.x + r.w - 5, r.y + r.h - 6, { size: 11, bold: true, align: 'right', color: n ? '#fff' : '#ff8a7a' });
        drawItemIcon(me.ammo, r.x + 12, r.y + r.h - 11, 13);
      }
      if (hoverSlot === i && !drag) text(itemName(item), r.x + r.w / 2, r.y - 8, { size: 12, bold: true, align: 'center' });
    }
    if (me.stats.ranged) {
      const kinds = cfg.AMMO[me.stats.ammo].types.filter((t) => (me.res[t.item] || 0) > 0).length;
      if (kinds > 1) text(`[R] ${itemName(me.ammo)}`, rects[0].x, rects[0].y - 26, { size: 11, bold: true, color: '#ffd76a' });
    }
    if (invOpen) text('Item auf einen Slot ziehen oder mit Maus drauf 1–6 drücken · Rechtsklick leert', W / 2, rects[0].y - 40, { size: 11, align: 'center', color: '#cfd8c0' });

    slotBg(rb, selected === 1 || buildOpen);
    ctx.save();
    ctx.translate(rb.x + rb.w / 2, rb.y + rb.h / 2 - 4);
    if (buildType) {
      const k = buildType === 'core' ? 0.36 : 0.7;
      ctx.globalAlpha = canAfford(cfg.STRUCTURES[buildType].levels[0].cost) ? 1 : 0.4;
      ctx.scale(k, k);
      drawStruct({ type: buildType, x: 0, y: 0, level: 0, hp: 1, maxHp: 1, owner: myId, angle: -0.8 }, true);
    } else {
      // Hammer-Symbol
      ctx.rotate(-0.6);
      rrect(-3.5, -16, 7, 36, 3, '#7a5230', '#4a3019', 2);
      rrect(-14, -22, 28, 12, 3, '#9aa1a8', '#5c6268', 3);
    }
    ctx.restore();
    text('B', rb.x + 6, rb.y + 15, { size: 11, color: '#ddd', bold: true });
    text(buildType ? cfg.STRUCTURES[buildType].name : 'Bauen', rb.x + rb.w / 2, rb.y + rb.h - 6, { size: 11, align: 'center' });

    if (buildType) {
      const cost = cfg.STRUCTURES[buildType].levels[0].cost;
      text(fmtCost(cost), rb.x + rb.w / 2, rb.y + rb.h + 15, { size: 11, color: canAfford(cost) ? '#e8e8e8' : '#ff8a7a', align: 'center' });
    }
    drawXpBar(rects);
  }

  // EP-Leiste direkt über der Hotbar
  function drawXpBar(rects) {
    const x = rects[0].x, w = rects[cfg.HOTBAR_SIZE].x + rects[cfg.HOTBAR_SIZE].w - x, y = rects[0].y - 14;
    const frac = Math.min(1, me.xp / me.xpNext);
    rrect(x, y, w, 8, 4, 'rgba(0,0,0,0.55)');
    rrect(x + 1.5, y + 1.5, Math.max(0, (w - 3) * frac), 5, 2.5, '#7fc4ff');
    text(`Lv ${me.lvl}`, x - 8, y + 8, { size: 13, bold: true, align: 'right', color: '#ffd76a' });
    text(`${me.xp}/${me.xpNext} EP`, x + w + 8, y + 8, { size: 11, color: '#cfd8c0' });
    if (me.sp > 0) text(`+${me.sp} Skillpunkt${me.sp > 1 ? 'e' : ''} [K]`, x + w / 2, y - 4, { size: 12, bold: true, align: 'center', color: '#ffd76a' });
  }

  // ---------- Fertigkeiten (K) ----------

  function skillLayout() {
    const cols = 2, cw = 330, ch = 78, gap = 10, pad = 18, head = 50;
    const rows = Math.ceil(cfg.SKILLS.length / cols);
    const w = pad * 2 + cols * cw + gap, h = head + rows * (ch + gap) + pad;
    const x = Math.round(W / 2 - w / 2), y = Math.round(Math.max(60, H / 2 - h / 2 - 40));
    const cards = cfg.SKILLS.map((sk, i) => {
      const rect = { x: x + pad + (i % cols) * (cw + gap), y: y + head + Math.floor(i / cols) * (ch + gap), w: cw, h: ch };
      return { id: sk.id, sk, rect, btn: { x: rect.x + rect.w - 44, y: rect.y + rect.h / 2 - 17, w: 34, h: 34 } };
    });
    return { panel: { x, y, w, h }, cards };
  }

  function drawSkills() {
    const { panel: P, cards } = skillLayout();
    rrect(P.x, P.y, P.w, P.h, 14, 'rgba(18,24,14,0.96)', '#4b5d38', 3);
    text('✨ Fertigkeiten', P.x + 18, P.y + 32, { size: 18, bold: true, color: '#f2d27a' });
    text(`Level ${me.lvl} · ${me.sp} Punkt${me.sp === 1 ? '' : 'e'} frei · [K] schließen`, P.x + P.w - 18, P.y + 32,
      { size: 13, color: me.sp ? '#ffd76a' : '#a8b597', align: 'right', bold: !!me.sp });
    for (const { sk, rect: r, btn } of cards) {
      const rank = me.skills[sk.id] || 0, maxed = rank >= sk.max, can = me.sp > 0 && !maxed;
      rrect(r.x, r.y, r.w, r.h, 10, 'rgba(0,0,0,0.32)', rank ? 'rgba(159,232,112,0.45)' : 'rgba(255,255,255,0.1)', 2);
      text(sk.icon, r.x + 26, r.y + 46, { size: 26, align: 'center' });
      text(sk.name, r.x + 52, r.y + 26, { size: 15, bold: true });
      text(sk.desc + ' pro Rang', r.x + 52, r.y + 45, { size: 12, color: '#b9c4aa' });
      for (let k = 0; k < sk.max; k++) {
        rrect(r.x + 52 + k * 22, r.y + 56, 18, 8, 3, k < rank ? '#9fe870' : 'rgba(255,255,255,0.12)');
      }
      const hover = inRect(mouse.x, mouse.y, btn);
      rrect(btn.x, btn.y, btn.w, btn.h, 8, can ? (hover ? '#92c453' : '#7fae45') : 'rgba(255,255,255,0.08)', can ? '#5a8130' : 'rgba(255,255,255,0.1)', 2);
      text(maxed ? '✓' : '+', btn.x + btn.w / 2, btn.y + 25, { size: 20, bold: true, align: 'center', color: can ? '#13200a' : maxed ? '#9fe870' : '#777' });
    }
  }

  // Grund, warum ein Gebäude gerade nicht platziert werden kann (oder null)
  function buildBlocker(type) {
    const def = cfg.STRUCTURES[type];
    if (type === 'core') return me.core ? 'Bereits gebaut' : null;
    if (!me.core) return 'Basis-Kern nötig';
    if (type === 'forge' && me.forge) return 'Limit erreicht (1/1)';
    if (type === 'mine' && me.mines >= def.limit) return `Limit erreicht (${def.limit}/${def.limit})`;
    if (me.count >= me.max) return 'Gebäude-Limit – Kern upgraden';
    return null;
  }

  function buildLayout() {
    const cols = 3, cw = 190, ch = 132, gap = 10, pad = 18, head = 44, tabH = 34;
    const types = Object.keys(cfg.STRUCTURES).filter((t) => cfg.STRUCTURES[t].category === buildCat);
    const rows = Math.max(1, Math.ceil(types.length / cols));
    const w = pad * 2 + cols * cw + (cols - 1) * gap;
    const h = head + tabH + 14 + rows * ch + (rows - 1) * gap + pad + 22;
    const x = Math.round(W / 2 - w / 2), y = Math.round(Math.max(70, H / 2 - h / 2 - 50));
    ctx.font = 'bold 14px Segoe UI, sans-serif';
    let tx = x + pad;
    const tabs = cfg.BUILD_CATEGORIES.map((c) => {
      const tw = ctx.measureText(c.name).width + 28;
      const rect = { x: tx, y: y + head, w: tw, h: tabH };
      tx += tw + 8;
      return { id: c.id, name: c.name, rect };
    });
    const cards = types.map((type, i) => ({
      type,
      rect: { x: x + pad + (i % cols) * (cw + gap), y: y + head + tabH + 14 + Math.floor(i / cols) * (ch + gap), w: cw, h: ch },
    }));
    return { panel: { x, y, w, h }, tabs, cards };
  }

  function wrapText(str, maxW) {
    const words = str.split(' '), lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawBuildMenu() {
    const { panel: P, tabs, cards } = buildLayout();
    rrect(P.x, P.y, P.w, P.h, 14, 'rgba(18,24,14,0.95)', '#4b5d38', 3);
    text('🔨 Baumenü', P.x + 18, P.y + 29, { size: 18, bold: true, color: '#f2d27a' });
    text('[B] schließen · Rechtsklick/[Q] = Bauen abbrechen', P.x + P.w - 18, P.y + 29, { size: 12, color: '#a8b597', align: 'right' });
    for (const t of tabs) {
      const active = t.id === buildCat;
      const hover = inRect(mouse.x, mouse.y, t.rect);
      rrect(t.rect.x, t.rect.y, t.rect.w, t.rect.h, 8, active ? '#7fae45' : hover ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.3)',
        active ? '#5a8130' : 'rgba(255,255,255,0.1)', 2);
      text(t.name, t.rect.x + t.rect.w / 2, t.rect.y + 22, { size: 14, bold: true, align: 'center', color: active ? '#13200a' : '#e9eedd' });
    }
    for (const { type, rect: r } of cards) {
      const def = cfg.STRUCTURES[type], cost = def.levels[0].cost;
      const blocked = buildBlocker(type), afford = canAfford(cost);
      const hover = inRect(mouse.x, mouse.y, r), chosen = type === buildType;
      rrect(r.x, r.y, r.w, r.h, 10, hover ? 'rgba(255,230,140,0.12)' : 'rgba(0,0,0,0.32)',
        chosen ? '#ffd76a' : hover ? 'rgba(255,215,106,0.6)' : 'rgba(255,255,255,0.1)', chosen ? 3 : 2);
      ctx.save();
      ctx.globalAlpha = blocked ? 0.4 : 1;
      ctx.translate(r.x + 34, r.y + 38);
      const k = type === 'core' ? 0.42 : 0.82;
      ctx.scale(k, k);
      drawStruct({ type, x: 0, y: 0, level: 0, hp: 1, maxHp: 1, owner: myId, angle: -0.8 }, true);
      ctx.restore();
      text(def.name, r.x + 66, r.y + 26, { size: 15, bold: true, color: blocked ? '#999' : '#fff' });
      if (def.limit) text(`max ${def.limit}`, r.x + r.w - 10, r.y + 26, { size: 11, color: '#a8b597', align: 'right' });
      ctx.font = '12px Segoe UI, sans-serif';
      wrapText(def.desc || '', r.w - 76).slice(0, 3).forEach((line, i) =>
        text(line, r.x + 66, r.y + 45 + i * 15, { size: 12, color: '#b9c4aa' }));
      text(fmtCost(cost), r.x + 10, r.y + r.h - 30, { size: 13, color: afford ? '#9fe870' : '#ff8a7a' });
      text(blocked || (afford ? 'Klicken zum Auswählen' : 'Zu wenig Ressourcen'), r.x + 10, r.y + r.h - 11,
        { size: 11, color: blocked ? '#ff9a7a' : afford ? '#cfd8c0' : '#c9a69e' });
    }
    text('Tipp: Über ein eigenes Gebäude fahren → [E] upgraden, [X] abreißen', P.x + P.w / 2, P.y + P.h - 12,
      { size: 12, color: '#8f9c80', align: 'center' });
  }

  function drawHud() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Uhr
    const [day, night, prog] = tm;
    panel(W / 2 - 130, 14, 260, 52);
    text(`${night ? '🌙 Nacht' : '☀️ Tag'} ${day}`, W / 2, 38, { size: 17, bold: true, align: 'center', color: night ? '#a9b8ff' : '#ffe08a' });
    rrect(W / 2 - 110, 46, 220, 8, 4, 'rgba(255,255,255,0.12)');
    rrect(W / 2 - 110, 46, 220 * prog, 8, 4, night ? '#6f7fe0' : '#f5c84a');
    let toastY = 96;
    const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    const badge = me.prot > 0 ? [`🛡 Spawnschutz – noch ${mmss(me.prot)}`, 'rgba(40,90,130,0.85)', '#cfeeff']
      : me.calm > 0 ? [`🌙 Ruhige erste Nacht – keine Horde (${mmss(me.calm)})`, 'rgba(50,50,100,0.85)', '#d6d9ff'] : null;
    if (badge) {
      ctx.font = 'bold 13px Segoe UI, sans-serif';
      const bw = ctx.measureText(badge[0]).width + 24;
      rrect(W / 2 - bw / 2, 72, bw, 24, 12, badge[1], 'rgba(255,255,255,0.25)', 1.5);
      text(badge[0], W / 2, 89, { size: 13, bold: true, align: 'center', color: badge[2] });
      toastY = 122;
    }

    // Toasts
    toasts.forEach((t, i) => {
      ctx.globalAlpha = Math.min(1, t.life);
      text(t.text, W / 2, toastY + i * 26, { size: 17, bold: true, align: 'center', color: '#fff' });
      ctx.globalAlpha = 1;
    });

    // Bestenliste
    const lbW = 220, lbH = 40 + lb.length * 22;
    panel(W - lbW - 14, 14, lbW, lbH);
    text(`Bestenliste · ${online} online`, W - lbW, 38, { size: 14, bold: true, color: '#ffe08a' });
    lb.forEach(([id, name, score], i) => {
      const c = id === myId ? '#9fe870' : '#fff';
      text(`${i + 1}. ${name}`, W - lbW, 62 + i * 22, { size: 14, color: c });
      text(String(score), W - 28, 62 + i * 22, { size: 14, color: c, align: 'right' });
    });

    // Status unten links
    panel(14, H - 160, 330, 146);
    text('Leben', 28, H - 134, { size: 13, color: '#cfd8c0' });
    rrect(80, H - 146, 250, 16, 8, 'rgba(0,0,0,0.5)');
    rrect(82, H - 144, 246 * (me.hp / me.maxHp), 12, 6, me.hp / me.maxHp > 0.35 ? '#7ed957' : '#e05555');
    text(`${Math.round(me.hp)}/${me.maxHp}`, 205, H - 134, { size: 11, bold: true, align: 'center' });
    const stFrac = me.st / me.stats.stamina;
    text('Ausdauer', 28, H - 110, { size: 13, color: me.ex ? '#ff8a7a' : '#cfd8c0' });
    rrect(92, H - 120, 238, 12, 6, 'rgba(0,0,0,0.5)');
    rrect(94, H - 118, 234 * stFrac, 8, 4, me.ex ? '#e05555' : '#f5c84a');
    text(me.ex ? 'erschöpft' : '[Shift] sprinten', 330, H - 98, { size: 10, color: me.ex ? '#ff8a7a' : '#8f9c80', align: 'right' });
    const st = me.stats;
    text(`⚔ ${st.damage}  🛡 ${st.armor}  👟 ${st.speed}  ·  [C] Charakter`, 28, H - 86, { size: 13 });
    const forgeHint = me.forge ? ['⚒️ Äxte & Kleidung: an der Schmiede [F]', '#cfd8c0'] : ['⚒️ Baue eine Schmiede [B] für Äxte & Kleidung', '#c9a69e'];
    text(forgeHint[0], 28, H - 66, { size: 13, color: forgeHint[1] });
    if (me.core) text(`🏰 Basis Lv ${me.core[3] + 1} · Gebäude ${me.count}/${me.max} · Minen ${me.mines}/${cfg.STRUCTURES.mine.limit}`, 28, H - 46, { size: 13, color: '#cfd8c0' });
    else text('🏰 Noch keine Basis', 28, H - 46, { size: 13, color: '#ff9a7a' });
    text(`🏆 ${me.score}   💀 ${me.kills}`, 28, H - 26, { size: 13, color: '#cfd8c0' });
    text('[Tab] Inventar', 330, H - 26, { size: 12, color: '#a8b597', align: 'right' });

    drawHotbar();
    drawMinimap();

    if (!me.core && !me.dead) {
      const hint = selected === 1 && buildType === 'core' ? 'Klicke auf einen freien Platz, um deine Basis zu gründen' : 'Öffne das Baumenü [B] und platziere deinen Basis-Kern';
      text(hint, W / 2, H - 150, { size: 17, bold: true, align: 'center', color: '#ffe08a' });
    }
    if (hovered) drawTooltip(hovered);
    if (invOpen && !me.dead) drawInventory();
    if (charOpen && !me.dead) drawCharacter();
    if (drag && (invOpen || charOpen) && !me.dead) drawDragged();
    if (pendingTooltip) {
      pendingTooltip();
      pendingTooltip = null;
    }
    if (forgeOpen && !me.dead) drawForge();
    if (buildOpen && !me.dead) drawBuildMenu();
    if (skillOpen && !me.dead) drawSkills();
    if (mapOpen) drawWorldMap();

    if (me.dead) {
      ctx.fillStyle = 'rgba(40,0,0,0.45)';
      ctx.fillRect(0, 0, W, H);
      text('Du wurdest überrannt!', W / 2, H / 2 - 10, { size: 40, bold: true, align: 'center', color: '#ff6b6b' });
      text(`Respawn in ${Math.ceil(me.rt)}s ${me.core ? 'an deiner Basis' : ''}`, W / 2, H / 2 + 28, { size: 18, align: 'center' });
    }
  }

  function drawMinimap() {
    // Radar um den Spieler: zeigt ±MINIMAP_RANGE Welteinheiten
    const size = 190, x = W - size - 14, y = H - size - 14, R = cfg.MINIMAP_RANGE, k = size / (2 * R);
    const mx = (wx) => x + size / 2 + (wx - me.x) * k, my = (wy) => y + size / 2 + (wy - me.y) * k;
    rrect(x, y, size, size, 10, 'rgba(32,48,24,0.92)', 'rgba(255,255,255,0.15)', 2);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 10);
    ctx.clip();
    // Außerhalb der Welt abdunkeln
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
    if (me.forge) rrect(mx(me.forge[1]) - 2.5, my(me.forge[2]) - 2.5, 5, 5, 1, '#ff9a3c');
    const e = minimap.e;
    for (let i = 0; i < e.length; i += 3) {
      const hostile = e[i + 2];
      circle(mx(e[i] * 10), my(e[i + 1] * 10), hostile ? 2.6 : 2, hostile ? '#ff3b3b' : 'rgba(240,170,165,0.75)');
    }
    const pp = minimap.p;
    for (let i = 0; i < pp.length; i += 2) circle(mx(pp[i] * 10), my(pp[i + 1] * 10), 3, '#ffe08a', '#000', 1);
    circle(x + size / 2, y + size / 2, 4, '#fff', '#000', 1.5);
    ctx.restore();
    text('● Feind  ● Spieler', x + 8, y + size - 8, { size: 10, color: 'rgba(255,255,255,0.55)' });
    ctx.fillStyle = '#ff3b3b';
    ctx.fillText('●', x + 8, y + size - 8);
    ctx.fillStyle = '#ffe08a';
    ctx.fillText('●', x + 8 + ctx.measureText('● Feind  ').width, y + size - 8);
    text('[M] Karte', x + size - 8, y + size - 8, { size: 10, color: 'rgba(255,255,255,0.55)', align: 'right' });
  }

  function drawTooltip(s) {
    const def = cfg.STRUCTURES[s.type], L = def.levels[s.level], N = def.levels[s.level + 1];
    const lines = [];
    lines.push([`${def.name} · Lv ${s.level + 1} (${LEVEL_NAMES[s.level]})`, '#ffe08a', true]);
    lines.push([`HP ${s.hp} / ${s.maxHp}`, '#fff']);
    const stat = (lvl) => {
      if (s.type === 'turret') return `Schaden ${lvl.dmg} · Reichweite ${lvl.range} · ${lvl.rate}/s`;
      if (s.type === 'spike') return `Schaden ${lvl.dmg}`;
      if (s.type === 'mine') return `+${fmtCost(lvl.income)} alle ${def.interval}s`;
      if (s.type === 'core') return `Radius ${lvl.radius} · Limit ${lvl.maxStructures}`;
      if (s.type === 'forge') {
        const lvNum = def.levels.indexOf(lvl) + 1;
        const n = Object.values(cfg.EQUIPMENT).filter((e) => e.recipe && e.recipe.forge <= lvNum).length;
        return `${n} Rezepte freigeschaltet`;
      }
      return null;
    };
    if (stat(L)) lines.push([stat(L), '#cfd8c0']);
    if (s.owner === myId) {
      if (!N) lines.push(['Maximales Level', '#ffe08a']);
      else if (s.type !== 'core' && me.core && s.level + 1 > me.core[3]) lines.push(['Kern upgraden, um weiter zu verbessern', '#ff9a7a']);
      else {
        lines.push([`[E] Upgrade: ${fmtCost(N.cost)}`, canAfford(N.cost) ? '#9fe870' : '#ff9a7a']);
        lines.push([`→ HP ${N.hp}${stat(N) ? ' · ' + stat(N) : ''}`, '#aab6a0']);
      }
      if (s.hp < s.maxHp) lines.push([`Axt-Schlag repariert (${2 + s.level * 2}🪵)`, '#cfd8c0']);
      if (s.type === 'forge') lines.push(['[F] Schmiede öffnen (in der Nähe)', '#ffd76a']);
      lines.push(['[X] Abreißen', '#aab6a0']);
    }
    ctx.font = '14px Segoe UI, sans-serif';
    const w = Math.max(...lines.map(([t]) => ctx.measureText(t).width)) + 24, h = lines.length * 20 + 14;
    let x = mouse.x + 18, y = mouse.y + 18;
    if (x + w > W) x = mouse.x - w - 10;
    if (y + h > H) y = mouse.y - h - 10;
    panel(x, y, w, h);
    lines.forEach(([t, c, b], i) => text(t, x + 12, y + 24 + i * 20, { size: 14, color: c, bold: b }));
  }

  // ---------- Hauptschleife ----------

  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - lastFrame) / 1000);
    lastFrame = t;
    now = t / 1000;

    if (!cfg || !me) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#2b3a20';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const k = Math.min(1, dt * 14);
    for (const map of [players, zombies]) {
      for (const e of map.values()) {
        e.dx += (e.x - e.dx) * k;
        e.dy += (e.y - e.dy) * k;
        e.da = lerpAngle(e.da, e.angle, k);
      }
    }
    const self = players.get(myId);
    const tx = self ? self.dx : me.x, ty = self ? self.dy : me.y;
    cam.x += (tx - cam.x) * Math.min(1, dt * 10);
    cam.y += (ty - cam.y) * Math.min(1, dt * 10);

    sendInput();

    const wm = screenToWorld(mouse.x, mouse.y);
    hovered = null;
    const overUi = hotbarRects().some((r) => inRect(mouse.x, mouse.y, r)) ||
      (invOpen && inRect(mouse.x, mouse.y, invLayout().panel)) || (forgeOpen && inRect(mouse.x, mouse.y, forgeLayout().panel)) || (skillOpen && inRect(mouse.x, mouse.y, skillLayout().panel)) || (charOpen && inRect(mouse.x, mouse.y, charLayout().panel)) || (buildOpen && inRect(mouse.x, mouse.y, buildLayout().panel));
    if (!overUi && !drag) {
      for (const s of structs.values()) {
        const h = (cfg.STRUCTURES[s.type].size * cfg.TILE) / 2;
        if (Math.abs(wm.x - s.x) < h && Math.abs(wm.y - s.y) < h) { hovered = s; break; }
      }
    }

    for (const p of players.values()) {
      const moving = Math.hypot(p.x - p.dx, p.y - p.dy) > 1;
      if (p.sprint && moving && now - (p.dustT || 0) > 0.045) {
        p.dustT = now;
        const back = Math.atan2(p.dy - p.y, p.dx - p.x);
        particles.push({
          x: p.dx + Math.cos(back) * 16 + (Math.random() - 0.5) * 14, y: p.dy + Math.sin(back) * 16 + (Math.random() - 0.5) * 14,
          vx: Math.cos(back) * 40, vy: Math.sin(back) * 40, life: 0.45, max: 0.45, color: 'rgba(214,196,160,0.8)', size: 4 + Math.random() * 4,
        });
      }
    }
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; p.life -= dt; }
    for (const f of floats) { f.y -= 40 * dt; f.life -= dt; }
    for (const tt of toasts) tt.life -= dt;
    for (const arr of [particles, floats, toasts]) {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i].life <= 0) arr.splice(i, 1);
    }

    // Welt
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (W / 2 - cam.x * scale), dpr * (H / 2 - cam.y * scale));
    const x0 = cam.x - W / 2 / scale, y0 = cam.y - H / 2 / scale, x1 = cam.x + W / 2 / scale, y1 = cam.y + H / 2 / scale;
    const visible = (x, y, m) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m;

    drawGround(x0, y0, x1, y1);
    drawSunShadows(x0, y0, x1, y1);
    drawBaseZone();
    drawRuins(x0, y0, x1, y1);
    for (const r of resources) {
      if (r.type === 'tree' || !visible(r.x, r.y, r.r)) continue;
      if (r.type === 'crate') drawCrate(r);
      else drawRock(r);
    }
    for (const s of structs.values()) drawStruct(s);
    for (const it of groundItems.values()) if (visible(it.x, it.y, 40)) drawGroundItem(it);
    drawGhost();
    for (const z of zombies.values()) drawZombie(z);
    for (const p of players.values()) drawPlayer(p);
    drawStaminaRing();
    drawAimLine();
    for (const [bx, by, ba, look] of projectiles) {
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(ba);
      if (look === 1) {
        // Kugel mit Leuchtspur
        const gr = ctx.createLinearGradient(-26, 0, 4, 0);
        gr.addColorStop(0, 'rgba(255,220,120,0)');
        gr.addColorStop(1, 'rgba(255,240,180,0.95)');
        ctx.fillStyle = gr;
        ctx.fillRect(-26, -1.5, 30, 3);
        circle(3, 0, 2.5, '#fff6d0');
      } else {
        // Pfeil: Schaft, Spitze je nach Typ, Federn
        const [tip, tipDark] = ARROW_TIPS[look] || ARROW_TIPS[0];
        rrect(-12, -1.5, 20, 3, 1.5, '#8a6236');
        ctx.beginPath();
        ctx.moveTo(6, -4); ctx.lineTo(13, 0); ctx.lineTo(6, 4);
        ctx.closePath();
        ctx.fillStyle = tip; ctx.fill();
        ctx.strokeStyle = tipDark; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#e8e2d0';
        ctx.fillRect(-13, -3.5, 5, 2.5);
        ctx.fillRect(-13, 1, 5, 2.5);
      }
      ctx.restore();
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const fl = flashes[i], t = (now - fl.t) / 0.08;
      if (t > 1) { flashes.splice(i, 1); continue; }
      ctx.save();
      ctx.translate(fl.x, fl.y);
      ctx.rotate(fl.a);
      ctx.globalAlpha = 1 - t;
      ctx.beginPath();
      ctx.moveTo(-2, -7); ctx.lineTo(22, 0); ctx.lineTo(-2, 7); ctx.closePath();
      ctx.fillStyle = '#ffd25a';
      ctx.fill();
      circle(2, 0, 7, '#fff3c0');
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    for (const r of resources) if (r.type === 'tree' && visible(r.x, r.y, r.r)) drawTree(r);
    for (const r of resources) if (visible(r.x, r.y, r.r)) drawResBar(r);
    if (forgeOpen && !nearForge()) forgeOpen = false;
    if (!forgeOpen && nearForge()) {
      const [, fx, fy] = me.forge;
      const bob = Math.sin(now * 4) * 3;
      ctx.font = 'bold 16px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText('[F] Schmiede', fx, fy - 42 + bob);
      ctx.fillStyle = '#ffd76a';
      ctx.fillText('[F] Schmiede', fx, fy - 42 + bob);
    }
    if (hovered) {
      const h = (cfg.STRUCTURES[hovered.type].size * cfg.TILE) / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeRect(hovered.x - h, hovered.y - h, h * 2, h * 2);
    }
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      circle(p.x, p.y, p.size, p.color);
    }
    ctx.globalAlpha = 1;
    for (const f of floats) {
      ctx.globalAlpha = Math.min(1, f.life * 2);
      const pop = f.dmg ? 1 + Math.max(0, 0.12 - (now - f.born)) * 5 : 1;
      ctx.font = `bold ${Math.round((f.big ? 30 : f.dmg ? 20 : 18) * pop)}px Segoe UI, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    drawLighting();
    drawHud();
  }
  requestAnimationFrame(frame);
})();
