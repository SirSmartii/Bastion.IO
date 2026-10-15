'use strict';
// Zentrale Spielwerte. Alles Balancing passiert hier.

module.exports = {
  PORT: process.env.PORT || 3000,
  TICK_RATE: 60, // Simulationsschritte pro Sekunde
  SEND_RATE: 30, // Zustands-Updates an Clients pro Sekunde

  WORLD_SIZE: 6000,
  TILE: 50,
  VIEW: { w: 1600, h: 900 }, // sichtbarer Weltausschnitt des Clients
  PVP: false, // true = Spieler können sich gegenseitig & fremde Basen angreifen

  DAY_LENGTH: +process.env.DAY_LENGTH || 150, // Sekunden (zum Testen: DAY_LENGTH=10 node server.js)
  NIGHT_LENGTH: 90,

  PLAYER: {
    radius: 24,
    speed: 230,
    hp: 100,
    regen: 3, // HP/s, wenn 5s kein Schaden
    attackCooldown: 0.38,
    reach: 75,
    buildRange: 320,
    respawnTime: 4,
    deathLoss: 0.3, // Anteil des Inventars, der beim Tod als Beute auf den Boden fällt
    startRes: { wood: 60, stone: 30 },
    startEquip: { weapon: 'axe_wood' },
    fistDamage: 6, // Schaden & Abbau ohne Waffe
    fistGather: 1,
    armorFactor: 50, // Schadensreduktion = Rüstung / (Rüstung + armorFactor)
    stamina: 100, // Ausdauer-Grundwert
    sprintMult: 1.55, // Tempo-Faktor beim Sprinten (Shift)
    sprintCost: 28, // Ausdauer pro Sekunde beim Sprinten
    staminaRegen: 22, // Erholung pro Sekunde
    staminaDelay: 0.8, // Sekunden ohne Sprint, bevor die Erholung startet
    exhaustedUntil: 30, // leer gesprintet: erst ab diesem Wert wieder sprinten
  },

  INVENTORY: {
    slots: 20,
    stack: { wood: 250, stone: 250, gold: 150, bone: 100, scrap: 50, fur: 50, meat: 30, arrow: 100 }, // maximale Stapelgröße pro Slot
  },

  ITEMS: {
    names: { wood: 'Holz', stone: 'Stein', gold: 'Gold', bone: 'Knochen', scrap: 'Schrott', fur: 'Fell', meat: 'Fleisch', arrow: 'Pfeil' },
    food: { meat: 30 }, // essbar: HP-Heilung pro Stück
    eatCooldown: 1,
    // Stapelbare Items aus der Schmiede: amount Stück pro Herstellung
    recipes: {
      arrow: { tab: 'ranged', amount: 10, forge: 1, cost: { wood: 10, stone: 4 } },
    },
    pickupRadius: 40,
    despawn: 180, // Sekunden, bis Items am Boden verschwinden
    maxGround: 600,
    maxDropDist: 160, // wie weit man Items vom Körper weg werfen kann
  },

  // amount: Vorrat [min, max] – leer abgebaut zerfällt die Ressource und wächst nach respawn Sekunden woanders nach
  RESOURCES: {
    tree: { count: 360, minR: 42, maxR: 62, solid: 0.7, gives: 'wood', amount: [60, 110], respawn: 60 },
    rock: { count: 220, minR: 34, maxR: 50, solid: 0.9, gives: 'stone', amount: [80, 140], respawn: 90 },
    gold: { count: 70, minR: 28, maxR: 38, solid: 0.9, gives: 'gold', amount: [30, 60], respawn: 150 },
  },
  RESOURCE_MIN_SCALE: 0.55, // so klein wird eine fast leere Ressource

  // Ausrüstung: jedes Teil ist ein eigenes Item (Stapelgröße 1) und passt in genau einen Slot.
  // stats werden auf die Grundwerte addiert; eine Waffe ersetzt damage/gather/attackSpeed/reach der Faust.
  // kind: axe | sword | dagger | spear | bow (Bögen schießen Pfeile, range = Schussweite).
  // tab: Reiter in der Schmiede (siehe FORGE_TABS)
  // recipe: in der Schmiede herstellbar ab Schmiede-Level forge. tier = Farbstufe (0 Holz/Fell … 4 Rubin)
  EQUIP_SLOTS: [
    { id: 'head', name: 'Mütze' },
    { id: 'chest', name: 'Shirt' },
    { id: 'legs', name: 'Hose' },
    { id: 'feet', name: 'Schuhe' },
    { id: 'weapon', name: 'Waffe' },
  ],
  EQUIPMENT: {
    axe_wood: { name: 'Holzaxt', slot: 'weapon', kind: 'axe', tab: 'axes', tier: 0, stats: { damage: 12, gather: 1 } },
    axe_stone: {
      name: 'Steinaxt', slot: 'weapon', kind: 'axe', tab: 'axes', tier: 1, stats: { damage: 18, gather: 2 },
      recipe: { forge: 1, cost: { wood: 80, stone: 50 } },
    },
    axe_gold: {
      name: 'Goldaxt', slot: 'weapon', kind: 'axe', tab: 'axes', tier: 2, stats: { damage: 26, gather: 3 },
      recipe: { forge: 2, cost: { wood: 150, stone: 150, gold: 40, bone: 10 } },
    },
    axe_diamond: {
      name: 'Diamantaxt', slot: 'weapon', kind: 'axe', tab: 'axes', tier: 3, stats: { damage: 36, gather: 4 },
      recipe: { forge: 3, cost: { stone: 400, gold: 150, bone: 25, scrap: 5, fur: 5 } },
    },
    axe_ruby: {
      name: 'Rubinaxt', slot: 'weapon', kind: 'axe', tab: 'axes', tier: 4, stats: { damage: 50, gather: 5 },
      recipe: { forge: 4, cost: { stone: 700, gold: 400, bone: 50, scrap: 15, fur: 15 } },
    },

    // Schwerter: viel Schaden, schlecht zum Abbauen
    sword_stone: {
      name: 'Steinschwert', slot: 'weapon', kind: 'sword', tab: 'melee', tier: 1,
      stats: { damage: 24, gather: 1, attackSpeed: 2.2, reach: 85 },
      recipe: { forge: 1, cost: { wood: 40, stone: 90 } },
    },
    sword_gold: {
      name: 'Goldschwert', slot: 'weapon', kind: 'sword', tab: 'melee', tier: 2,
      stats: { damage: 36, gather: 1, attackSpeed: 2.3, reach: 88 },
      recipe: { forge: 2, cost: { stone: 120, gold: 60, bone: 10 } },
    },
    sword_diamond: {
      name: 'Diamantschwert', slot: 'weapon', kind: 'sword', tab: 'melee', tier: 3,
      stats: { damage: 52, gather: 1, attackSpeed: 2.4, reach: 92 },
      recipe: { forge: 3, cost: { stone: 250, gold: 150, scrap: 8, bone: 20 } },
    },
    // Dolche: sehr schnell, kurze Reichweite
    dagger_stone: {
      name: 'Steindolch', slot: 'weapon', kind: 'dagger', tab: 'melee', tier: 1,
      stats: { damage: 10, gather: 1, attackSpeed: 4.5, reach: 58 },
      recipe: { forge: 1, cost: { wood: 20, stone: 40 } },
    },
    dagger_gold: {
      name: 'Golddolch', slot: 'weapon', kind: 'dagger', tab: 'melee', tier: 2,
      stats: { damage: 16, gather: 1, attackSpeed: 4.8, reach: 60 },
      recipe: { forge: 2, cost: { stone: 60, gold: 40, bone: 6 } },
    },
    // Speere: große Reichweite
    spear_wood: {
      name: 'Holzspeer', slot: 'weapon', kind: 'spear', tab: 'melee', tier: 0,
      stats: { damage: 15, gather: 1, attackSpeed: 1.6, reach: 125 },
      recipe: { forge: 1, cost: { wood: 70, bone: 4 } },
    },
    spear_gold: {
      name: 'Goldspeer', slot: 'weapon', kind: 'spear', tab: 'melee', tier: 2,
      stats: { damage: 30, gather: 1, attackSpeed: 1.7, reach: 135 },
      recipe: { forge: 2, cost: { wood: 100, gold: 50, bone: 10 } },
    },
    // Bögen: Fernkampf, verbrauchen Pfeile, können nichts abbauen
    bow_wood: {
      name: 'Holzbogen', slot: 'weapon', kind: 'bow', tab: 'ranged', tier: 0,
      stats: { damage: 14, gather: 0, attackSpeed: 1.3, range: 520 },
      recipe: { forge: 1, cost: { wood: 60, fur: 3 } },
    },
    bow_composite: {
      name: 'Kompositbogen', slot: 'weapon', kind: 'bow', tab: 'ranged', tier: 3,
      stats: { damage: 28, gather: 0, attackSpeed: 1.7, range: 680 },
      recipe: { forge: 3, cost: { wood: 120, bone: 20, scrap: 6, fur: 6 } },
    },

    fur_hat: {
      name: 'Fellmütze', slot: 'head', tab: 'armor', tier: 0, stats: { armor: 3, regen: 0.5 },
      recipe: { forge: 1, cost: { fur: 4, bone: 2 } },
    },
    fur_shirt: {
      name: 'Fellhemd', slot: 'chest', tab: 'armor', tier: 0, stats: { armor: 6, maxHp: 15 },
      recipe: { forge: 1, cost: { fur: 8, bone: 3 } },
    },
    fur_pants: {
      name: 'Fellhose', slot: 'legs', tab: 'armor', tier: 0, stats: { armor: 4, maxHp: 5 },
      recipe: { forge: 1, cost: { fur: 6, bone: 2 } },
    },
    fur_boots: {
      name: 'Fellstiefel', slot: 'feet', tab: 'armor', tier: 0, stats: { armor: 2, speed: 20, stamina: 25 },
      recipe: { forge: 1, cost: { fur: 4, bone: 1 } },
    },
    iron_hat: {
      name: 'Eisenhelm', slot: 'head', tab: 'armor', tier: 1, stats: { armor: 8, maxHp: 10 },
      recipe: { forge: 3, cost: { scrap: 6, fur: 2, gold: 30 } },
    },
    iron_shirt: {
      name: 'Eisenrüstung', slot: 'chest', tab: 'armor', tier: 1, stats: { armor: 16, maxHp: 40, speed: -15 },
      recipe: { forge: 3, cost: { scrap: 12, fur: 4, gold: 60 } },
    },
    iron_pants: {
      name: 'Eisenbeinschutz', slot: 'legs', tab: 'armor', tier: 1, stats: { armor: 11, maxHp: 20, speed: -5 },
      recipe: { forge: 3, cost: { scrap: 8, fur: 3, gold: 45 } },
    },
    iron_boots: {
      name: 'Eisenstiefel', slot: 'feet', tab: 'armor', tier: 1, stats: { armor: 5, speed: 10, stamina: 15 },
      recipe: { forge: 3, cost: { scrap: 5, fur: 2, gold: 25 } },
    },
  },

  FORGE_TABS: [
    { id: 'axes', name: 'Äxte' },
    { id: 'melee', name: 'Nahkampf' },
    { id: 'ranged', name: 'Fernkampf' },
    { id: 'armor', name: 'Kleidung' },
  ],
  ARROW_SPEED: 950,

  BUILD_CATEGORIES: [
    { id: 'base', name: 'Basis' },
    { id: 'defense', name: 'Verteidigung' },
    { id: 'economy', name: 'Wirtschaft' },
  ],

  // levels[0] = Baukosten, levels[n] = Kosten für Upgrade auf Level n+1.
  // Nicht-Kern-Gebäude können maximal das Level des eigenen Kerns erreichen.
  STRUCTURES: {
    core: {
      name: 'Basis-Kern', size: 2, category: 'base',
      desc: 'Herz deiner Basis. Bestimmt Bauradius & Gebäude-Limit.',
      levels: [
        { hp: 1200, radius: 300, maxStructures: 20, cost: { wood: 40, stone: 20 } },
        { hp: 2200, radius: 380, maxStructures: 35, cost: { wood: 200, stone: 150 } },
        { hp: 3500, radius: 460, maxStructures: 50, cost: { wood: 400, stone: 350, gold: 80 } },
        { hp: 5500, radius: 540, maxStructures: 70, cost: { stone: 700, gold: 250 } },
        { hp: 8000, radius: 620, maxStructures: 90, cost: { stone: 1200, gold: 600 } },
      ],
    },
    wall: {
      name: 'Mauer', size: 1, category: 'defense',
      desc: 'Hält Gegner auf. Günstig, aber viel HP.',
      levels: [
        { hp: 250, cost: { wood: 10 } },
        { hp: 600, cost: { wood: 10, stone: 15 } },
        { hp: 1200, cost: { stone: 30, gold: 5 } },
        { hp: 2200, cost: { stone: 50, gold: 20 } },
        { hp: 3600, cost: { stone: 80, gold: 50 } },
      ],
    },
    spike: {
      name: 'Stacheln', size: 1, category: 'defense',
      desc: 'Verletzt Gegner, die sie berühren.',
      levels: [
        { hp: 150, dmg: 10, cost: { wood: 20, stone: 10 } },
        { hp: 350, dmg: 18, cost: { stone: 25 } },
        { hp: 700, dmg: 28, cost: { stone: 40, gold: 10 } },
        { hp: 1200, dmg: 40, cost: { stone: 60, gold: 30 } },
        { hp: 2000, dmg: 55, cost: { stone: 90, gold: 60 } },
      ],
    },
    turret: {
      name: 'Turm', size: 1, category: 'defense',
      desc: 'Schießt automatisch auf Gegner in Reichweite.',
      levels: [
        { hp: 200, dmg: 8, range: 280, rate: 1.2, cost: { wood: 40, stone: 25 } },
        { hp: 450, dmg: 13, range: 320, rate: 1.5, cost: { wood: 60, stone: 60 } },
        { hp: 800, dmg: 20, range: 360, rate: 1.8, cost: { stone: 100, gold: 25 } },
        { hp: 1300, dmg: 30, range: 400, rate: 2.2, cost: { stone: 150, gold: 60 } },
        { hp: 2000, dmg: 45, range: 450, rate: 2.6, cost: { stone: 220, gold: 120 } },
      ],
    },
    mine: {
      name: 'Mine', size: 1, limit: 4, interval: 5, category: 'economy',
      desc: 'Fördert regelmäßig Stein & Gold.',
      levels: [
        { hp: 200, income: { stone: 2, gold: 1 }, cost: { wood: 60, stone: 40 } },
        { hp: 400, income: { stone: 3, gold: 2 }, cost: { wood: 100, stone: 80 } },
        { hp: 700, income: { stone: 5, gold: 3 }, cost: { stone: 150, gold: 30 } },
        { hp: 1100, income: { stone: 7, gold: 5 }, cost: { stone: 250, gold: 80 } },
        { hp: 1600, income: { stone: 10, gold: 8 }, cost: { stone: 400, gold: 160 } },
      ],
    },
    forge: {
      name: 'Schmiede', size: 1, limit: 1, useRange: 180, category: 'base',
      desc: 'Stelle hier Äxte & Kleidung her [F].',
      levels: [
        { hp: 400, cost: { wood: 80, stone: 60 } },
        { hp: 800, cost: { stone: 120, gold: 20 } },
        { hp: 1300, cost: { stone: 200, gold: 60, bone: 10 } },
        { hp: 2000, cost: { stone: 300, gold: 120, scrap: 5 } },
      ],
    },
  },

  // Gegner & Tiere.
  // ai: 'zombie' (nachts Basen angreifen), 'pack' (Rudel, jagt Spieler),
  //     'neutral' (friedlich, wehrt sich), 'territorial' (greift nur in der Nähe an)
  // spawn: Gewichtung tagsüber/nachts, + perDay pro Tag (bis max). pack: Gruppengröße [min, max]
  // drops: jeder Eintrag wird einzeln gewürfelt (chance 0..1, Menge min..max)
  ENEMIES: {
    normal: {
      name: 'Zombie', ai: 'zombie', hp: 50, speed: 85, dmg: 8, sdmg: 12, r: 22, score: 10,
      spawn: { day: 35, night: 55 },
      drops: [
        { item: 'gold', chance: 0.6, min: 1, max: 3 },
        { item: 'bone', chance: 0.35, min: 1, max: 2 },
      ],
    },
    runner: {
      name: 'Läufer', ai: 'zombie', hp: 30, speed: 150, dmg: 5, sdmg: 6, r: 18, score: 10,
      spawn: { day: 10, night: 25 },
      drops: [
        { item: 'gold', chance: 0.5, min: 1, max: 2 },
        { item: 'bone', chance: 0.3, min: 1, max: 1 },
      ],
    },
    brute: {
      name: 'Koloss', ai: 'zombie', hp: 260, speed: 55, dmg: 18, sdmg: 50, r: 34, score: 40,
      spawn: { day: 0, night: 4, perDay: 2, max: 25 },
      drops: [
        { item: 'gold', chance: 1, min: 5, max: 10 },
        { item: 'bone', chance: 0.8, min: 2, max: 4 },
        { item: 'scrap', chance: 0.5, min: 1, max: 2 },
      ],
    },
    wolf: {
      name: 'Wolf', ai: 'pack', hp: 45, speed: 175, dmg: 7, sdmg: 5, r: 20, score: 15, aggro: 480,
      pack: [2, 4], spawn: { day: 18, night: 12 },
      drops: [
        { item: 'fur', chance: 0.7, min: 1, max: 2 },
        { item: 'bone', chance: 0.4, min: 1, max: 1 },
      ],
    },
    pig: {
      name: 'Wildschwein', ai: 'neutral', hp: 70, speed: 120, dmg: 9, sdmg: 0, r: 24, score: 5,
      spawn: { day: 25, night: 0 },
      drops: [
        { item: 'meat', chance: 1, min: 1, max: 3 },
      ],
    },
    bear: {
      name: 'Bär', ai: 'territorial', hp: 420, speed: 105, dmg: 26, sdmg: 40, r: 36, score: 60,
      aggro: 260, leash: 750, spawn: { day: 5, night: 3, perDay: 1, max: 10 },
      drops: [
        { item: 'fur', chance: 1, min: 2, max: 4 },
        { item: 'meat', chance: 1, min: 2, max: 4 },
        { item: 'bone', chance: 0.6, min: 2, max: 3 },
      ],
    },
  },
  ANGER_TIME: 8, // Sekunden, die ein angegriffener Gegner seinen Angreifer verfolgt
  DROP_NIGHT_BONUS: 1.5,
  MINIMAP_RANGE: 1800, // Radar-Reichweite der Minimap (Welteinheiten um den Spieler)

  SPAWN: {
    maxTotal: 400,
    dayInterval: 3.5, // Sekunden zwischen Spawns pro Spieler
    nightInterval: 1.4,
    dayBase: 3, // gewünschte Zombies in der Nähe tagsüber (+ Tag/2)
    nightBase: 6, // nachts (+ Tag * nightPerDay)
    nightPerDay: 3,
    hpScale: 0.2, // +20% HP pro Tag
    dayAggro: 420,
    nightAggro: 750,
    nightSpeed: 1.15,
  },
};
