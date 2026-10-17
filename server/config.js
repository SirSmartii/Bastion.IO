'use strict';
// Zentrale Spielwerte. Alles Balancing passiert hier.

// ---------- Material-Leiter für Waffen, Werkzeuge und Rüstung ----------
//
// tier: Stufe (bestimmt auch, welche Erze ein Werkzeug abbauen kann, RESOURCES[*].tool),
// mult: Werte-Faktor gegenüber Stein, gather/mine: Abbau-Wert von Äxten bzw. Spitzhacken,
// unit: Kosten einer Material-Einheit (Gegenstände brauchen 2–4 Einheiten), forge: nötiges Schmiede-Level.
const MATERIALS = {
  wood: { name: 'Holz', tier: 0, mult: 0.67, gather: 1, mine: 0, color: ['#a8743f', '#6b4524'] },
  stone: { name: 'Stein', tier: 1, mult: 1, gather: 2, mine: 3, color: ['#9aa1a8', '#5c6268'] },
  copper: { name: 'Kupfer', tier: 2, mult: 1.25, gather: 2, mine: 4, color: ['#e08a50', '#8a4520'], unit: { copper: 4 }, forge: 1 },
  bronze: { name: 'Bronze', tier: 3, mult: 1.5, gather: 3, mine: 5, color: ['#d4a24a', '#7a5a20'], unit: { bronze: 4 }, forge: 2 },
  iron: { name: 'Eisen', tier: 4, mult: 1.8, gather: 3, mine: 6, color: ['#c9d1d9', '#5d6670'], unit: { iron: 5 }, forge: 2 },
  steel: { name: 'Stahl', tier: 5, mult: 2.2, gather: 4, mine: 8, color: ['#8fa8bf', '#34404c'], unit: { steel: 5 }, forge: 3 },
  diamond: { name: 'Diamant', tier: 6, mult: 2.7, gather: 5, mine: 10, color: ['#62d6e8', '#2b93a6'], unit: { diamond: 2, steel: 6, gold: 20 }, forge: 4 },
  ruby: { name: 'Rubin', tier: 7, mult: 3.2, gather: 5, mine: 11, color: ['#e0577a', '#8f2a47'], unit: { ruby: 2, steel: 8, gold: 40 }, forge: 4 },
};

// Waffen & Werkzeuge: Werte auf Stein-Stufe (× mult), Material-Einheiten und Zusatzkosten.
// up(m): Stufen über Stein (Holz 0) – Tempo und Reichweite wachsen etwas mit
const up = (m) => Math.max(0, m.tier - 1);
const WEAPON_TYPES = {
  axe: {
    noun: 'axt', tab: 'axes', units: 3, extra: { wood: 30 }, mats: ['wood', 'stone', 'copper', 'bronze', 'iron', 'steel', 'diamond', 'ruby'],
    stats: (m) => ({ damage: Math.round(18 * m.mult), gather: m.gather, tool: m.tier }),
  },
  pick: {
    noun: 'spitzhacke', tab: 'axes', units: 3, extra: { wood: 30 }, mats: ['stone', 'copper', 'bronze', 'iron', 'steel', 'diamond'],
    stats: (m) => ({ damage: Math.round(14 * m.mult), gather: 1, mine: m.mine, tool: m.tier }),
  },
  sword: {
    noun: 'schwert', tab: 'melee', units: 4, extra: { wood: 15, leather: 1 }, mats: ['stone', 'copper', 'bronze', 'iron', 'steel', 'diamond', 'ruby'],
    stats: (m) => ({ damage: Math.round(24 * m.mult), gather: 1, attackSpeed: +(2.2 + 0.03 * up(m)).toFixed(2), reach: Math.round(85 + 1.5 * up(m)) }),
  },
  dagger: {
    noun: 'dolch', tab: 'melee', units: 2, extra: { wood: 10 }, mats: ['stone', 'copper', 'bronze', 'iron', 'steel', 'diamond'],
    stats: (m) => ({ damage: Math.round(10 * m.mult), gather: 1, attackSpeed: +(4.5 + 0.06 * up(m)).toFixed(2), reach: Math.round(58 + 0.5 * up(m)) }),
  },
  spear: {
    noun: 'speer', tab: 'melee', units: 2, extra: { wood: 60 }, mats: ['wood', 'stone', 'copper', 'bronze', 'iron', 'steel'],
    stats: (m) => ({ damage: Math.round(22 * m.mult), gather: 1, attackSpeed: +(1.6 + 0.03 * up(m)).toFixed(2), reach: 125 + 3 * up(m) }),
  },
};
// Holz und Stein: einfache Rezepte (auch unterwegs), ohne Material-Einheiten
const BASIC_RECIPES = {
  axe_wood: { forge: 1, hand: true, cost: { wood: 30 } },
  spear_wood: { forge: 1, hand: true, cost: { wood: 70, bone: 4 } },
  axe_stone: { forge: 1, hand: true, cost: { wood: 80, stone: 50 } },
  pick_stone: { forge: 1, hand: true, cost: { wood: 70, stone: 60 } },
  sword_stone: { forge: 1, cost: { wood: 40, stone: 90 } },
  dagger_stone: { forge: 1, hand: true, cost: { wood: 20, stone: 40 } },
  spear_stone: { forge: 1, hand: true, cost: { wood: 60, stone: 30 } },
};

// Metall-Rüstung: Werte auf Eisen-Stufe (× mult / 1.8), Barren und Leder pro Teil.
// Kupfer, Bronze und Stahl sind leichter als Eisen (weniger Tempo-Malus).
const ARMOR_PARTS = {
  hat: { slot: 'head', noun: 'helm', bars: 12, leather: 1, stats: { armor: 8, maxHp: 10 } },
  shirt: { slot: 'chest', noun: 'rüstung', bars: 25, leather: 3, stats: { armor: 16, maxHp: 40 }, speed: { iron: -15, other: -10 } },
  pants: { slot: 'legs', noun: 'beinschutz', bars: 18, leather: 2, stats: { armor: 11, maxHp: 20 }, speed: { iron: -5, other: -3 } },
  boots: { slot: 'feet', noun: 'stiefel', bars: 10, leather: 1, stats: { armor: 5, stamina: 15 }, speed: { iron: 10, other: 12 } },
};
const ARMOR_MATS = ['copper', 'bronze', 'iron', 'steel'];

function addCosts(...costs) {
  const out = {};
  for (const c of costs) for (const [k, v] of Object.entries(c)) out[k] = (out[k] || 0) + v;
  return out;
}

function buildEquipment(extra) {
  const eq = {};
  for (const [type, T] of Object.entries(WEAPON_TYPES)) {
    for (const mat of T.mats) {
      const m = MATERIALS[mat], id = `${type}_${mat}`;
      const unitCost = m.unit ? Object.fromEntries(Object.entries(m.unit).map(([k, v]) => [k, v * T.units])) : null;
      eq[id] = {
        name: m.name + T.noun, slot: 'weapon', kind: type, tab: T.tab, mat, tier: m.tier, color: m.color, stats: T.stats(m),
        recipe: BASIC_RECIPES[id] || (unitCost && { forge: m.forge, cost: addCosts(unitCost, T.extra) }),
      };
    }
  }
  for (const mat of ARMOR_MATS) {
    const m = MATERIALS[mat], k = m.mult / MATERIALS.iron.mult;
    for (const [part, A] of Object.entries(ARMOR_PARTS)) {
      const stats = {};
      for (const [s, v] of Object.entries(A.stats)) stats[s] = s === 'stamina' ? v : Math.round(v * k);
      if (A.speed) stats.speed = mat === 'iron' ? A.speed.iron : A.speed.other;
      eq[`${mat}_${part}`] = {
        name: m.name + A.noun, slot: A.slot, tab: 'armor', mat, tier: m.tier, style: 'metal', color: m.color, stats,
        recipe: { forge: m.forge, cost: { [Object.keys(m.unit)[0]]: A.bars, leather: A.leather } },
      };
    }
  }
  return { ...eq, ...extra };
}

module.exports = {
  PORT: process.env.PORT || 3000,
  TICK_RATE: 60, // Simulationsschritte pro Sekunde
  SEND_RATE: 60, // Zustands-Updates an Clients pro Sekunde

  WORLD_SIZE: 10000,
  TILE: 50,
  VIEW: { w: 1600, h: 900 }, // sichtbarer Weltausschnitt des Clients
  PVP: false, // true = Spieler können sich gegenseitig & fremde Basen angreifen

  DAY_LENGTH: +process.env.DAY_LENGTH || 150, // Sekunden (zum Testen: DAY_LENGTH=10 node server.js)
  NIGHT_LENGTH: 45,

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
    stack: { wood: 250, stone: 250, gold: 150, bone: 100, scrap: 50, fur: 50, meat: 30, iron_ore: 100, coal: 100, iron: 100, can: 20, bandage: 10, berries: 40, apple: 20, carrot: 20, potato: 20, corn: 20, pumpkin: 10, cooked_meat: 20, baked_potato: 20, roasted_corn: 20, bottle: 5, water: 5, whetstone: 20, essence: 10, ward: 5, arrow_wood: 100, arrow_stone: 100, arrow_iron: 100, bullet: 120, shell: 60,
      copper_ore: 100, tin_ore: 100, copper: 100, tin: 100, bronze: 100, steel: 100, diamond: 20, ruby: 20, leather: 50,
      fish: 20, cooked_fish: 20, stew: 10, berry_juice: 10, fish_soup: 10 }, // maximale Stapelgröße pro Slot
  },

  ITEMS: {
    names: { wood: 'Holz', stone: 'Stein', gold: 'Gold', bone: 'Knochen', scrap: 'Schrott', fur: 'Fell', meat: 'Fleisch', iron_ore: 'Eisenerz', coal: 'Kohle', iron: 'Eisenbarren', can: 'Konserve', bandage: 'Verband', berries: 'Beeren', apple: 'Apfel', carrot: 'Karotte', potato: 'Kartoffel', corn: 'Maiskolben', pumpkin: 'Kürbis', cooked_meat: 'Gebratenes Fleisch', baked_potato: 'Ofenkartoffel', roasted_corn: 'Gerösteter Mais', bottle: 'Leere Feldflasche', water: 'Feldflasche (Wasser)', whetstone: 'Wetzstein', essence: 'Dunkle Essenz', ward: 'Schutzsiegel', arrow_wood: 'Holzpfeil', arrow_stone: 'Steinpfeil', arrow_iron: 'Metallpfeil', bullet: 'Patrone', shell: 'Schrotpatrone',
      copper_ore: 'Kupfererz', tin_ore: 'Zinnerz', copper: 'Kupferbarren', tin: 'Zinnbarren', bronze: 'Bronzebarren', steel: 'Stahlbarren',
      diamond: 'Diamant', ruby: 'Rubin', leather: 'Leder', fish: 'Fisch', cooked_fish: 'Gebratener Fisch', stew: 'Eintopf',
      berry_juice: 'Beerensaft', fish_soup: 'Fischsuppe' },
    // Verbrauchbar ([H] oder Rechtsklick): food = Sättigung, water = Durst, hp = Leben (negativ schadet),
    // returns = was danach im Inventar bleibt. Rohes wird am Lagerfeuer gar (STRUCTURES.campfire.cook).
    food: {
      meat: { food: 8, hp: -4 }, // roh – besser braten
      cooked_meat: { food: 35, hp: 10 },
      berries: { food: 5, water: 4 },
      apple: { food: 10, water: 8 },
      carrot: { food: 10, water: 4 },
      potato: { food: 6 },
      baked_potato: { food: 26, hp: 5 },
      corn: { food: 8 },
      roasted_corn: { food: 22, hp: 3 },
      pumpkin: { food: 18, water: 10 },
      can: { food: 30, water: 5, hp: 5 },
      water: { water: 40, returns: 'bottle' },
      bandage: { hp: 45 },
      fish: { food: 10, hp: -2 }, // roh – besser braten
      cooked_fish: { food: 35, water: 5, hp: 8 },
      // buff: Wirkung auf Zeit (t Sekunden) – regen: Faktor auf die Regeneration, staminaRegen: Faktor auf die Ausdauer-Erholung
      stew: { food: 80, water: 30, hp: 15, buff: { regen: 2, t: 60 } },
      berry_juice: { water: 35, food: 10, returns: 'bottle' },
      fish_soup: { food: 60, water: 30, hp: 10, buff: { staminaRegen: 1.15, t: 60 } },
    },
    eatCooldown: 1,
    // Stapelbare Items aus der Schmiede: amount Stück pro Herstellung.
    // hand: auch unterwegs ohne Schmiede herstellbar (Handwerk [G]) – gilt genauso für EQUIPMENT-Rezepte
    // campfire: nur neben einem brennenden Lagerfeuer (eigenes oder vom Team), steht im Handwerk-Fenster.
    //   returns: was dabei zurückkommt (z. B. die leere Feldflasche)
    recipes: {
      arrow_wood: { tab: 'ranged', amount: 10, forge: 1, hand: true, cost: { wood: 12 } },
      arrow_stone: { tab: 'ranged', amount: 10, forge: 1, hand: true, cost: { wood: 10, stone: 8 } },
      bandage: { tab: 'supplies', amount: 1, forge: 1, hand: true, cost: { fur: 2 } },
      bottle: { tab: 'supplies', amount: 1, forge: 1, hand: true, cost: { fur: 2, bone: 1 } }, // am See füllen [F]
      whetstone: { tab: 'supplies', amount: 2, forge: 1, cost: { stone: 30, iron: 1 } }, // zum Verbessern (GEAR.upgrade)
      arrow_iron: { tab: 'ranged', amount: 10, forge: 2, cost: { wood: 10, iron: 1 } },
      // Kohle ist das Schießpulver, Eisen die Hülse
      bullet: { tab: 'guns', amount: 12, forge: 2, cost: { iron: 1, coal: 3 } },
      shell: { tab: 'guns', amount: 8, forge: 3, cost: { iron: 1, coal: 4, gold: 2 } },
      // Kochen mit mehreren Zutaten am Lagerfeuer
      stew: { tab: 'cooking', amount: 1, campfire: true, cost: { cooked_meat: 1, potato: 1, carrot: 1, water: 1 }, returns: { bottle: 1 } },
      berry_juice: { tab: 'cooking', amount: 1, campfire: true, cost: { berries: 5, water: 1 } },
      fish_soup: { tab: 'cooking', amount: 1, campfire: true, cost: { cooked_fish: 1, corn: 1, water: 1 }, returns: { bottle: 1 } },
    },
    pickupRadius: 40,
    despawn: 180, // Sekunden, bis Items am Boden verschwinden
    maxGround: 600,
    maxDropDist: 160, // wie weit man Items vom Körper weg werfen kann
  },

  // Weltgenerator (server/world.js)
  MAP: {
    seed: +process.env.SEED || 0, // 0 = bei jedem Serverstart neue Welt
    biomeCell: 100, // Auflösung des Biom-Rasters
    cities: 6,
    cityRadius: 1120,
    cityBlock: 450, // Zellgröße des Straßenrasters (Vielfaches von TILE)
    streetMargin: 75, // Abstand der Häuser zur Straßenmitte
    citySpacing: 3000,
    ruinDecay: 0.14, // Anteil fehlender Mauerstücke
    lakes: 9,
    cityZombies: 7, // Zombies, die in einer Stadt mit Spielern in der Nähe herumlaufen (nachts 1,5×)
    noBuildMargin: 250, // Abstand zur Stadtgrenze, ab dem gebaut werden darf
    // Gebäudetypen. Jede Stadt bekommt (wenn Platz ist) je eines der Sondergebäude, der Rest nach weight.
    // size: Kantenlänge in Kacheln [min, max] (max 6 = eine ganze Straßenzelle), floor: Bodenfarbe,
    // sign: Symbol auf Schild & Karte, loot: [Kistentyp, min, max] im Inneren, shelves: Regalreihen
    buildings: {
      house: { name: 'Wohnhaus', weight: 10, size: [4, 6], floor: '#8d8472', loot: [['crate', 1, 2]] },
      supermarket: {
        name: 'Supermarkt', special: true, weight: 0.5, size: [6, 6], floor: '#a8a28f', sign: '🛒', shelves: true, loot: [['crate', 0, 1]],
      },
      police: { name: 'Polizei', special: true, weight: 0.4, size: [5, 6], floor: '#6d7887', sign: '🚓', loot: [['weapon_crate', 1, 2], ['crate', 0, 1]] },
      pharmacy: { name: 'Apotheke', special: true, weight: 0.5, size: [4, 5], floor: '#a3b8ad', sign: '✚', loot: [['med_cabinet', 2, 3]] },
      workshop: { name: 'Werkstatt', special: true, weight: 0.7, size: [5, 6], floor: '#7b7262', sign: '🔧', loot: [['toolbox', 1, 2], ['barrel', 1, 2]] },
    },
    cityCars: 9, // Autowracks auf den Straßen jeder Stadt
    cityBarrels: 8, // Fässer am Straßenrand
  },

  // Sichtlinien: Bäume, Felsen, Mauern und Ruinen verdecken, was dahinter steht.
  // Spieler und Gegner hinter Deckung werden nicht an den Client geschickt, Gegner entdecken nur,
  // wen sie sehen. RESOURCES[*].sight = Anteil des Radius, der die Sicht blockiert (0 = durchsichtig),
  // STRUCTURES[*].blocksSight = Gebäude verdeckt die Sicht.
  SIGHT: {
    near: 110, // so nah sieht (und spürt) man alles, auch hinter Deckung
    memory: 4, // Sekunden, die ein Gegner der letzten bekannten Position eines Spielers folgt
    recheck: 3, // Sichtprüfung pro Paar nur alle n Sendungen (dazwischen gilt das letzte Ergebnis)
  },

  // amount: Vorrat [min, max] – leer abgebaut zerfällt die Ressource und wächst nach respawn Sekunden woanders nach.
  // bonus: Extra-Beute für den Spieler, der den letzten Schlag macht
  // biomes: relative Häufigkeit je Biom (grass, forest, rocky, sand, meadow, urban)
  // hard: Gestein – Spitzhacken bauen es mit ihrem mine-Wert ab. tool: nötige Material-Stufe des Werkzeugs
  //   (MATERIALS[*].tier: 1 Stein, 2 Kupfer, 3 Bronze, 4 Eisen, 5 Stahl – sonst kein Ertrag)
  // solid: Anteil des Radius, an dem Spieler abprallen; enemySolid: dasselbe für Gegner (Standard: solid).
  //   Bei Bäumen ist das für Gegner fast die ganze Krone – sie kommen nicht durch dichten Wald, Spieler schon.
  RESOURCES: {
    tree: {
      count: 1000, minR: 42, maxR: 62, solid: 0.7, enemySolid: 0.85, sight: 0.9, gives: 'wood', amount: [60, 110], respawn: 60, bonus: { wood: 10 },
      biomes: { grass: 0.5, forest: 7, rocky: 0.2, sand: 0.1, meadow: 0.25, urban: 0 },
    },
    rock: {
      count: 600, minR: 34, maxR: 50, solid: 0.9, sight: 0.9, hard: true, gives: 'stone', amount: [80, 140], respawn: 90, bonus: { stone: 10 },
      biomes: { grass: 1, forest: 0.5, rocky: 6, sand: 0.4, meadow: 0.6, urban: 0 },
    },
    gold: {
      count: 190, minR: 28, maxR: 38, solid: 0.9, sight: 0.9, hard: true, gives: 'gold', amount: [30, 60], respawn: 150, bonus: { gold: 5 },
      biomes: { grass: 0.4, forest: 0.3, rocky: 5, sand: 0.2, meadow: 0.3, urban: 0 },
    },
    // Kupfer- und Zinnerz: ab Stein-Werkzeug, im Schmelzofen zu Barren; 3 Kupfer + 1 Zinn ergeben Bronze
    copper: {
      count: 200, minR: 30, maxR: 42, solid: 0.9, sight: 0.9, hard: true, tool: 1, gives: 'copper_ore', amount: [40, 70], respawn: 150,
      bonus: { copper_ore: 5 },
      biomes: { grass: 1, forest: 0.4, rocky: 4, sand: 0.6, meadow: 1.2, urban: 0 },
    },
    tin: {
      count: 110, minR: 28, maxR: 38, solid: 0.9, sight: 0.9, hard: true, tool: 1, gives: 'tin_ore', amount: [30, 55], respawn: 180,
      bonus: { tin_ore: 4 },
      biomes: { grass: 0.1, forest: 0, rocky: 5, sand: 0.3, meadow: 0, urban: 0 },
    },
    // Eisenerz: erst ab Bronze-Werkzeug, im Schmelzofen zu Eisenbarren
    iron: {
      count: 170, minR: 30, maxR: 42, solid: 0.9, sight: 0.9, hard: true, tool: 3, gives: 'iron_ore', amount: [40, 70], respawn: 180,
      bonus: { iron_ore: 4 },
      biomes: { grass: 0.8, forest: 0.5, rocky: 5, sand: 1, meadow: 0.4, urban: 0 },
    },
    // Kohle: Brennstoff für den Schmelzofen und Schießpulver für Munition
    coal: {
      count: 220, minR: 30, maxR: 44, solid: 0.9, sight: 0.9, hard: true, gives: 'coal', amount: [50, 90], respawn: 150,
      bonus: { coal: 6 },
      biomes: { grass: 0.8, forest: 2, rocky: 3, sand: 0.2, meadow: 0.6, urban: 0 },
    },
    // Edelsteinader: selten, nur im Felsgebiet, erst ab Stahl-Werkzeug. Gibt Diamanten, mit gem.chance einen Rubin
    gem: {
      count: 22, minR: 26, maxR: 32, solid: 0.9, sight: 0.9, hard: true, tool: 5, gives: 'diamond', amount: [4, 8], respawn: 600,
      fruit: { item: 'ruby', chance: 0.12 },
      biomes: { grass: 0, forest: 0, rocky: 1, sand: 0, meadow: 0, urban: 0 },
    },
    // Pflanzen: pick = Ernten ohne Werkzeug, 1 Stück pro Schlag (egal womit). Abgeerntet wachsen sie woanders nach.
    // Apfelbäume sind Bäume (Holz), die bei jedem Schlag mit fruit.chance einen Apfel fallen lassen.
    // Büsche sind begehbar (solid 0), verdecken aber ein wenig die Sicht – man kann sich darin ducken.
    apple_tree: {
      count: 160, minR: 40, maxR: 52, solid: 0.7, enemySolid: 0.85, sight: 0.9, gives: 'wood', amount: [40, 70], respawn: 90, bonus: { wood: 6, apple: 3 },
      fruit: { item: 'apple', chance: 0.35 },
      biomes: { grass: 2, forest: 0.6, rocky: 0, sand: 0, meadow: 3, urban: 0 },
    },
    berry_bush: {
      count: 280, minR: 22, maxR: 28, solid: 0, sight: 0.7, pick: true, gives: 'berries', amount: [4, 8], respawn: 90,
      biomes: { grass: 1.5, forest: 3, rocky: 0.2, sand: 0, meadow: 2, urban: 0 },
    },
    carrot: {
      count: 90, minR: 15, maxR: 17, solid: 0, sight: 0, pick: true, gives: 'carrot', amount: [2, 3], respawn: 120,
      biomes: { grass: 1.5, forest: 0.2, rocky: 0, sand: 0.1, meadow: 3, urban: 0 },
    },
    potato: {
      count: 90, minR: 15, maxR: 17, solid: 0, sight: 0, pick: true, gives: 'potato', amount: [2, 4], respawn: 120,
      biomes: { grass: 2, forest: 0.3, rocky: 0.5, sand: 0.3, meadow: 2, urban: 0 },
    },
    corn: {
      count: 80, minR: 18, maxR: 20, solid: 0, sight: 0.6, pick: true, gives: 'corn', amount: [2, 3], respawn: 120,
      biomes: { grass: 2, forest: 0, rocky: 0, sand: 0.5, meadow: 2.5, urban: 0 },
    },
    pumpkin: {
      count: 60, minR: 20, maxR: 22, solid: 0, sight: 0, pick: true, gives: 'pumpkin', amount: [1, 2], respawn: 150,
      biomes: { grass: 1.5, forest: 0.5, rocky: 0, sand: 0, meadow: 2, urban: 0 },
    },
    // Kisten & Co. in Städten: count 0 (der Weltgenerator platziert sie), amount = Schläge bis sie brechen,
    // loot wird beim Aufbrechen gewürfelt, danach kommen sie an derselben Stelle wieder
    crate: {
      count: 0, minR: 20, maxR: 20, solid: 0.95, sight: 1, gives: null, amount: [3, 3], respawn: 120,
      loot: [
        { item: 'gold', chance: 0.8, min: 4, max: 12 },
        { item: 'scrap', chance: 0.55, min: 1, max: 3 },
        { item: 'coal', chance: 0.35, min: 3, max: 8 },
        { item: 'iron', chance: 0.15, min: 1, max: 3 },
        { item: 'arrow_wood', chance: 0.35, min: 5, max: 15 },
        { item: 'arrow_stone', chance: 0.2, min: 3, max: 8 },
        { item: 'bullet', chance: 0.3, min: 4, max: 10 },
        { item: 'shell', chance: 0.2, min: 3, max: 6 },
        { item: 'pistol', chance: 0.02, min: 1, max: 1 },
        { item: 'bone', chance: 0.4, min: 2, max: 5 },
        { item: 'meat', chance: 0.3, min: 1, max: 2 },
        { item: 'fur', chance: 0.25, min: 1, max: 3 },
        { item: 'bow_wood', chance: 0.05, min: 1, max: 1 },
        { item: 'dagger_bronze', chance: 0.04, min: 1, max: 1 },
        { item: 'fur_boots', chance: 0.05, min: 1, max: 1 },
        { item: 'iron_hat', chance: 0.02, min: 1, max: 1 },
        { item: 'can', chance: 0.25, min: 1, max: 2 },
        { item: 'water', chance: 0.15, min: 1, max: 1 },
        { item: 'potato', chance: 0.15, min: 1, max: 3 },
      ],
    },
    // Supermarkt-Regal: Konserven & Vorräte
    shelf: {
      count: 0, minR: 22, maxR: 22, solid: 0.95, sight: 1, gives: null, amount: [2, 2], respawn: 150,
      loot: [
        { item: 'can', chance: 0.9, min: 1, max: 3 },
        { item: 'water', chance: 0.45, min: 1, max: 2 },
        { item: 'bottle', chance: 0.2, min: 1, max: 1 },
        { item: 'apple', chance: 0.25, min: 1, max: 3 },
        { item: 'meat', chance: 0.2, min: 1, max: 2 },
        { item: 'bandage', chance: 0.12, min: 1, max: 1 },
        { item: 'fur', chance: 0.15, min: 1, max: 2 },
        { item: 'coal', chance: 0.15, min: 2, max: 4 },
      ],
    },
    // Polizei: Waffen & Munition
    weapon_crate: {
      count: 0, minR: 22, maxR: 22, solid: 0.95, sight: 1, gives: null, amount: [5, 5], respawn: 240,
      loot: [
        { item: 'bullet', chance: 0.75, min: 6, max: 14 },
        { item: 'shell', chance: 0.45, min: 4, max: 8 },
        { item: 'arrow_iron', chance: 0.3, min: 5, max: 10 },
        { item: 'pistol', chance: 0.12, min: 1, max: 1 },
        { item: 'shotgun', chance: 0.05, min: 1, max: 1 },
        { item: 'rifle', chance: 0.02, min: 1, max: 1 },
        { item: 'iron_hat', chance: 0.1, min: 1, max: 1 },
        { item: 'iron_shirt', chance: 0.05, min: 1, max: 1 },
        { item: 'essence', chance: 0.05, min: 1, max: 1 },
        { item: 'ward', chance: 0.02, min: 1, max: 1 },
        { item: 'bandage', chance: 0.25, min: 1, max: 2 },
      ],
    },
    // Apotheke: Verbände
    med_cabinet: {
      count: 0, minR: 18, maxR: 18, solid: 0.95, sight: 0, gives: null, amount: [2, 2], respawn: 180,
      loot: [
        { item: 'bandage', chance: 0.9, min: 1, max: 3 },
        { item: 'can', chance: 0.2, min: 1, max: 1 },
      ],
    },
    // Werkstatt: Schrott, Eisen, Werkzeug
    toolbox: {
      count: 0, minR: 17, maxR: 17, solid: 0.95, sight: 0, gives: null, amount: [3, 3], respawn: 180,
      loot: [
        { item: 'scrap', chance: 0.85, min: 2, max: 5 },
        { item: 'iron', chance: 0.5, min: 1, max: 4 },
        { item: 'coal', chance: 0.35, min: 2, max: 6 },
        { item: 'whetstone', chance: 0.4, min: 1, max: 2 },
        { item: 'pick_stone', chance: 0.06, min: 1, max: 1 },
        { item: 'pick_iron', chance: 0.03, min: 1, max: 1 },
        { item: 'axe_stone', chance: 0.05, min: 1, max: 1 },
      ],
    },
    // Fässer am Straßenrand (wie in Rust: schnell zerschlagen, Kleinkram)
    barrel: {
      count: 0, minR: 16, maxR: 16, solid: 0.95, sight: 0, gives: null, amount: [2, 2], respawn: 120,
      loot: [
        { item: 'scrap', chance: 0.6, min: 1, max: 3 },
        { item: 'coal', chance: 0.45, min: 2, max: 5 },
        { item: 'iron_ore', chance: 0.25, min: 2, max: 4 },
        { item: 'bullet', chance: 0.15, min: 3, max: 6 },
        { item: 'can', chance: 0.15, min: 1, max: 1 },
      ],
    },
    // Autowracks: viele Schläge, viel Schrott & Eisen; man kann sich dahinter verstecken
    car: {
      count: 0, minR: 36, maxR: 36, solid: 0.9, sight: 0.85, gives: null, amount: [7, 7], respawn: 300,
      loot: [
        { item: 'scrap', chance: 1, min: 3, max: 7 },
        { item: 'iron', chance: 0.6, min: 2, max: 5 },
        { item: 'coal', chance: 0.25, min: 2, max: 4 },
        { item: 'bullet', chance: 0.1, min: 3, max: 8 },
      ],
    },
  },
  RESOURCE_MIN_SCALE: 0.55, // so klein wird eine fast leere Ressource

  // Ausrüstung: jedes Teil ist ein eigenes Item (Stapelgröße 1) und passt in genau einen Slot.
  // stats werden auf die Grundwerte addiert; eine Waffe ersetzt damage/gather/attackSpeed/reach/tool der Faust.
  // kind: axe | pick | sword | dagger | spear | bow | gun | torch | rod | backpack. Spitzhacken (pick) bauen
  //   Gestein (RESOURCES[*].hard) mit ihrem mine-Wert ab, alles andere mit gather. tool: Material-Stufe für
  //   Erze mit RESOURCES[*].tool (nur Äxte & Spitzhacken). color: [hell, dunkel] für die Grafik.
  // Fernwaffen: ammo = Munitionsgruppe (siehe AMMO), range = Schussweite,
  //   projectile: speed, pellets (Kugeln pro Schuss), spread (Streuung in rad).
  //   noise: Schüsse locken Gegner in diesem Umkreis an.
  // tab: Reiter in der Schmiede (siehe FORGE_TABS), mat: Material (Auswahl in der Schmiede),
  // tier: Stärke-Stufe wie MATERIALS[*].tier (Vergleich mit der Gegner-Stufe, Verbessern mit Stahl ab GEAR.steelFrom)
  // recipe: in der Schmiede herstellbar ab Schmiede-Level forge (hand: auch unterwegs, amount: Stück pro Herstellung)
  // noRoll: bekommt keine Seltenheit/Boni (Verbrauchsteile wie Fackeln)
  // Waffen, Werkzeuge und Metall-Rüstung entstehen aus MATERIALS × Typ-Vorlage (buildEquipment oben in der Datei).
  EQUIP_SLOTS: [
    { id: 'head', name: 'Mütze' },
    { id: 'chest', name: 'Shirt' },
    { id: 'legs', name: 'Hose' },
    { id: 'feet', name: 'Schuhe' },
    { id: 'back', name: 'Rücken' },
    { id: 'weapon', name: 'Waffe' },
  ],
  MATERIALS,
  EQUIPMENT: buildEquipment({
    // Bögen: Fernkampf, verbrauchen Pfeile, können nichts abbauen
    bow_wood: {
      name: 'Holzbogen', slot: 'weapon', kind: 'bow', tab: 'ranged', tier: 1, color: MATERIALS.wood.color,
      ammo: 'arrow', projectile: { speed: 950 },
      stats: { damage: 14, gather: 0, attackSpeed: 1.3, range: 520 },
      recipe: { forge: 1, hand: true, cost: { wood: 60, fur: 3 } },
    },
    bow_composite: {
      name: 'Kompositbogen', slot: 'weapon', kind: 'bow', tab: 'ranged', tier: 4, color: ['#62d6e8', '#2b93a6'],
      ammo: 'arrow', projectile: { speed: 950 },
      stats: { damage: 28, gather: 0, attackSpeed: 1.7, range: 680 },
      recipe: { forge: 3, cost: { wood: 120, bone: 20, scrap: 6, leather: 4 } },
    },
    // Feuerwaffen: stark, brauchen Munition und sind laut
    pistol: {
      name: 'Pistole', slot: 'weapon', kind: 'gun', model: 'pistol', tab: 'guns', tier: 4,
      ammo: 'bullet', projectile: { speed: 1500, spread: 0.05 }, noise: 600,
      stats: { damage: 24, gather: 0, attackSpeed: 2.4, range: 620 },
      recipe: { forge: 2, cost: { iron: 15, scrap: 3, wood: 20 } },
    },
    shotgun: {
      name: 'Schrotflinte', slot: 'weapon', kind: 'gun', model: 'shotgun', tab: 'guns', tier: 5,
      ammo: 'shell', projectile: { speed: 1300, pellets: 7, spread: 0.3 }, noise: 750,
      stats: { damage: 13, gather: 0, attackSpeed: 1.0, range: 360 },
      recipe: { forge: 3, cost: { steel: 20, scrap: 6, wood: 40 } },
    },
    rifle: {
      name: 'Gewehr', slot: 'weapon', kind: 'gun', model: 'rifle', tab: 'guns', tier: 6,
      ammo: 'bullet', projectile: { speed: 1900, spread: 0.01 }, noise: 900,
      stats: { damage: 62, gather: 0, attackSpeed: 0.85, range: 1000 },
      recipe: { forge: 4, cost: { steel: 35, scrap: 12, wood: 60 } },
    },
    // Fackel: schwache Waffe, leuchtet nachts weit (light) und verscheucht Tiere wie ein Lagerfeuer.
    // Brennt burn Sekunden, solange sie in der Hand ist, dann ist sie verbraucht.
    torch: {
      name: 'Fackel', slot: 'weapon', kind: 'torch', tab: 'supplies', noRoll: true, burn: 240, light: 430,
      stats: { damage: 5, gather: 1, attackSpeed: 2 },
      recipe: { forge: 1, hand: true, amount: 2, cost: { wood: 4, fur: 1, coal: 1 } },
    },
    // Angel: am Seeufer [F] – nach FISHING.wait Sekunden beißt etwas an
    rod: {
      name: 'Angel', slot: 'weapon', kind: 'rod', tab: 'supplies', noRoll: true,
      stats: { damage: 3, gather: 0 },
      recipe: { forge: 1, hand: true, cost: { wood: 30, fur: 2, bone: 1 } },
    },
    // Rucksäcke: slots zusätzliche Inventarplätze (ablegen nur, wenn sie leer sind)
    backpack_fur: {
      name: 'Fellrucksack', slot: 'back', kind: 'backpack', tab: 'armor', mat: 'fur', noRoll: true, slots: 5, color: ['#9a7650', '#5a4128'],
      stats: {}, recipe: { forge: 1, hand: true, cost: { fur: 12, bone: 4 } },
    },
    backpack_leather: {
      name: 'Lederrucksack', slot: 'back', kind: 'backpack', tab: 'armor', mat: 'leather', noRoll: true, slots: 10, color: ['#8a5a32', '#4a2e16'],
      stats: {}, recipe: { forge: 2, cost: { leather: 10, iron: 2 } },
    },
    // Leichte Kleidung: Fell & Leder, ohne Tempo-Malus
    fur_hat: {
      name: 'Fellmütze', slot: 'head', tab: 'armor', mat: 'fur', style: 'soft', stats: { armor: 3, regen: 0.5 },
      recipe: { forge: 1, hand: true, cost: { fur: 4, bone: 2 } },
    },
    fur_shirt: {
      name: 'Fellhemd', slot: 'chest', tab: 'armor', mat: 'fur', style: 'soft', stats: { armor: 6, maxHp: 15 },
      recipe: { forge: 1, cost: { fur: 8, bone: 3 } },
    },
    fur_pants: {
      name: 'Fellhose', slot: 'legs', tab: 'armor', mat: 'fur', style: 'soft', stats: { armor: 4, maxHp: 5 },
      recipe: { forge: 1, cost: { fur: 6, bone: 2 } },
    },
    fur_boots: {
      name: 'Fellstiefel', slot: 'feet', tab: 'armor', mat: 'fur', style: 'soft', stats: { armor: 2, speed: 20, stamina: 25 },
      recipe: { forge: 1, hand: true, cost: { fur: 4, bone: 1 } },
    },
    leather_hat: {
      name: 'Lederkappe', slot: 'head', tab: 'armor', mat: 'leather', style: 'soft', stats: { armor: 5, maxHp: 5, regen: 0.3 },
      recipe: { forge: 1, cost: { leather: 4, bone: 1 } },
    },
    leather_shirt: {
      name: 'Lederweste', slot: 'chest', tab: 'armor', mat: 'leather', style: 'soft', stats: { armor: 10, maxHp: 25 },
      recipe: { forge: 1, cost: { leather: 8, bone: 2 } },
    },
    leather_pants: {
      name: 'Lederhose', slot: 'legs', tab: 'armor', mat: 'leather', style: 'soft', stats: { armor: 7, maxHp: 10 },
      recipe: { forge: 1, cost: { leather: 6, bone: 1 } },
    },
    leather_boots: {
      name: 'Lederstiefel', slot: 'feet', tab: 'armor', mat: 'leather', style: 'soft', stats: { armor: 3, speed: 20, stamina: 20 },
      recipe: { forge: 1, cost: { leather: 4 } },
    },
  }),
  // Alte Item-IDs aus gespeicherten Spielständen → neue (Gold-Waffen wurden zu Bronze)
  ITEM_ALIASES: { axe_gold: 'axe_bronze', sword_gold: 'sword_bronze', dagger_gold: 'dagger_bronze', spear_gold: 'spear_bronze' },

  // Ausrüstungsteile sind Einzelstücke: Seltenheit, Verbesserungsstufe (+1 … +5) und zufällige Boni.
  // rarities: mods = Anzahl Boni, curse = Chance auf einen Fluch. Ein verfluchtes Teil würfelt seine guten Boni
  //   curseBoost-mal so stark – ein Tausch, kein reines Pech.
  // sources: Gewichte der Seltenheiten [Gewöhnlich, Gut, Selten, Episch, Legendär] je nach Herkunft.
  // upgradeBonus: Hauptwert pro Stufe (Waffen: Schaden, Kleidung: Rüstung & Leben).
  // upgrade[n-1]: Verbessern auf +n – odds in % [Erfolg, nichts passiert, Stufe −1, zerstört] und Kosten.
  //   Ein Schutzsiegel (ward) verhindert das Zerstören (dann passiert stattdessen nichts).
  // reforge: einen Bonus neu würfeln (oder den Fluch entfernen – dann verlieren die Boni ihre Verstärkung);
  //   jedes Umschmieden desselben Teils kostet growth × mehr. salvage: Anteil der Rezeptkosten beim Zerlegen.
  GEAR: {
    upgradeBonus: 0.08,
    curseBoost: 1.5,
    rarities: [
      { id: 'common', name: 'Gewöhnlich', color: '#d8d8d8', mods: 0, curse: 0 },
      { id: 'good', name: 'Gut', color: '#7ed957', mods: 1, curse: 0.15 },
      { id: 'rare', name: 'Selten', color: '#5aa9ff', mods: 2, curse: 0.2 },
      { id: 'epic', name: 'Episch', color: '#c77dff', mods: 3, curse: 0.25 },
      { id: 'legendary', name: 'Legendär', color: '#ffa53a', mods: 3, curse: 0 },
    ],
    sources: {
      craft: [75, 22, 3, 0, 0], // selbst hergestellt (Übung im Schmieden hebt die Seltenheit manchmal um eine Stufe)
      loot: [40, 35, 20, 5, 0], // Kisten, Gegner
      boss: [0, 0, 50, 40, 10],
    },
    upgrade: [
      { odds: [100, 0, 0, 0], cost: { iron: 2, whetstone: 1 } },
      { odds: [90, 10, 0, 0], cost: { iron: 4, whetstone: 2 } },
      { odds: [75, 20, 5, 0], cost: { iron: 6, whetstone: 3, gold: 10 } },
      { odds: [60, 28, 10, 2], cost: { iron: 10, whetstone: 4, gold: 25, essence: 1 } },
      { odds: [45, 35, 15, 5], cost: { iron: 15, whetstone: 6, gold: 50, essence: 2 } },
    ],
    steelFrom: 5, // ab dieser Material-Stufe (Stahl) kostet das Verbessern Stahl- statt Eisenbarren
    reforge: { cost: { scrap: 3, gold: 15 }, growth: 0.5 },
    salvage: 0.4,
    breakScrap: [2, 5], // Schrott, wenn ein Teil beim Verbessern zerbricht
  },
  // Mögliche Boni. stat: welcher Wert sich ändert, range: [min, max] (pct: in Prozent, sonst feste Zahl; step: Rundung),
  // slots: 'weapon' und/oder 'armor' (Kleidung), tool: nur Werkzeug-Waffen (Äxte, Spitzhacken).
  MODS: {
    dmg: { name: 'Schaden', stat: 'dmgPct', range: [6, 18], pct: true, slots: ['weapon'] },
    atk: { name: 'Angriffstempo', stat: 'atkPct', range: [5, 14], pct: true, slots: ['weapon'] },
    reach: { name: 'Reichweite', stat: 'reachPct', range: [5, 15], pct: true, slots: ['weapon'] },
    leech: { name: 'Lebensraub', stat: 'lifesteal', range: [2, 6], pct: true, slots: ['weapon'] },
    yield: { name: 'Chance auf +1 Ertrag', stat: 'yield', range: [5, 20], pct: true, slots: ['weapon'], tool: true },
    loot: { name: 'Chance auf doppelte Beute', stat: 'loot', range: [3, 10], pct: true, slots: ['weapon', 'armor'] },
    hp: { name: 'Leben', stat: 'hp', range: [5, 20], slots: ['armor'] },
    armor: { name: 'Rüstung', stat: 'armor', range: [1, 5], slots: ['armor'] },
    speed: { name: 'Tempo', stat: 'speedPct', range: [3, 8], pct: true, slots: ['armor'] },
    regen: { name: 'Regeneration', stat: 'regen', range: [0.2, 0.8], step: 0.1, slots: ['armor'] },
    sprint: { name: 'Sprint-Ausdauer', stat: 'sprintPct', range: [-15, -5], pct: true, slots: ['armor'] },
    thrift: { name: 'Hunger & Durst', stat: 'needsPct', range: [-15, -5], pct: true, slots: ['armor'] },
  },
  // Flüche: immer schlecht, höchstens einer pro Teil
  CURSES: {
    slow: { name: 'Tempo', stat: 'speedPct', range: [-10, -4], pct: true, slots: ['weapon', 'armor'] },
    clumsy: { name: 'Angriffstempo', stat: 'atkPct', range: [-12, -5], pct: true, slots: ['weapon'] },
    hungry: { name: 'Hunger & Durst', stat: 'needsPct', range: [10, 25], pct: true, slots: ['weapon', 'armor'] },
    loud: { name: 'Lärm (Gegner bemerken dich früher)', stat: 'noisePct', range: [15, 30], pct: true, slots: ['weapon', 'armor'] },
    brittle: { name: 'Rüstung', stat: 'armor', range: [-6, -2], slots: ['armor'] },
    sluggish: { name: 'Regeneration', stat: 'regenPct', range: [-30, -15], pct: true, slots: ['weapon', 'armor'] },
  },

  // Munitionsgruppen. types von schwach nach stark; ohne Auswahl ([R]) wird die stärkste vorhandene benutzt.
  // damage: Bonus auf den Waffenschaden, recover: Chance, dass das Geschoss nach einem Treffer
  // (Gegner oder Hindernis) als Item liegen bleibt, look: Aussehen im Client.
  AMMO: {
    arrow: {
      label: 'Pfeile',
      types: [
        { item: 'arrow_wood', damage: 0, recover: 0.3, look: 0 },
        { item: 'arrow_stone', damage: 5, recover: 0.5, look: 2 },
        { item: 'arrow_iron', damage: 12, recover: 0.75, look: 3 },
      ],
    },
    bullet: { label: 'Patronen', types: [{ item: 'bullet', damage: 0, recover: 0, look: 1 }] },
    shell: { label: 'Schrotpatronen', types: [{ item: 'shell', damage: 0, recover: 0, look: 1 }] },
  },

  FORGE_TABS: [
    { id: 'axes', name: 'Werkzeug' },
    { id: 'melee', name: 'Nahkampf' },
    { id: 'ranged', name: 'Bögen' },
    { id: 'guns', name: 'Feuerwaffen' },
    { id: 'armor', name: 'Kleidung' },
    { id: 'supplies', name: 'Vorräte' },
  ],

  BUILD_CATEGORIES: [
    { id: 'base', name: 'Basis' },
    { id: 'defense', name: 'Verteidigung' },
    { id: 'economy', name: 'Wirtschaft' },
  ],

  // levels[0] = Baukosten, levels[n] = Kosten für Upgrade auf Level n+1.
  // Nicht-Kern-Gebäude können maximal das Level des eigenen Kerns erreichen.
  // size: Kantenlänge in Kacheln (Zahl = quadratisch, [Breite, Höhe] = rechteckig). Gebäude lassen sich
  // beim Bauen mit [R] in 90°-Schritten drehen; bei rechteckigen tauschen Breite und Höhe.
  STRUCTURES: {
    core: {
      name: 'Basis-Kern', size: [2, 1], category: 'base', useRange: 190, blocksSight: true,
      desc: 'Herz deiner Basis. Bestimmt Bauradius & Gebäude-Limit. Lager [F] für den Unterhalt.',
      // slots = Plätze im Unterhalts-Lager (nur UPKEEP.items)
      levels: [
        { hp: 1200, radius: 300, maxStructures: 20, slots: 10, cost: { wood: 40, stone: 20 } },
        { hp: 2200, radius: 380, maxStructures: 35, slots: 12, cost: { wood: 200, stone: 150 } },
        { hp: 3500, radius: 460, maxStructures: 50, slots: 15, cost: { wood: 400, stone: 350, gold: 80 } },
        { hp: 5500, radius: 540, maxStructures: 70, slots: 18, cost: { stone: 700, gold: 250, iron: 40 } },
        { hp: 8000, radius: 620, maxStructures: 90, slots: 20, cost: { stone: 1200, gold: 600, iron: 120 } },
      ],
    },
    wall: {
      name: 'Mauer', size: 1, category: 'defense', blocksSight: true,
      desc: 'Hält Gegner auf. Günstig, aber viel HP.',
      levels: [
        { hp: 250, cost: { wood: 10 } },
        { hp: 600, cost: { wood: 10, stone: 15 } },
        { hp: 1200, cost: { stone: 30, gold: 5 } },
        { hp: 2200, cost: { stone: 50, gold: 15, iron: 4 } },
        { hp: 3600, cost: { stone: 80, gold: 30, iron: 10 } },
      ],
    },
    // Tür: nur der Besitzer läuft hindurch. Fenster: niemand läuft hindurch, aber Pfeile fliegen durch.
    door: {
      name: 'Tür', size: 1, category: 'defense', passOwner: true, blocksSight: true,
      desc: 'Nur du kannst hindurchgehen – Gegner müssen sie einschlagen.',
      levels: [
        { hp: 220, cost: { wood: 15 } },
        { hp: 520, cost: { wood: 15, stone: 15 } },
        { hp: 1050, cost: { stone: 30, gold: 5 } },
        { hp: 1900, cost: { stone: 50, gold: 15, iron: 4 } },
        { hp: 3100, cost: { stone: 80, gold: 30, iron: 10 } },
      ],
    },
    window: {
      name: 'Fenster', size: 1, category: 'defense', shootThrough: true,
      desc: 'Blockiert wie eine Mauer, aber man sieht und schießt hindurch.',
      levels: [
        { hp: 160, cost: { wood: 12, stone: 4 } },
        { hp: 420, cost: { wood: 10, stone: 15 } },
        { hp: 850, cost: { stone: 30, gold: 5 } },
        { hp: 1500, cost: { stone: 50, gold: 15, iron: 4 } },
        { hp: 2500, cost: { stone: 80, gold: 30, iron: 10 } },
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
      desc: 'Schießt automatisch auf Gegner, die er sehen kann.',
      levels: [
        { hp: 200, dmg: 8, range: 280, rate: 1.2, cost: { wood: 40, stone: 25 } },
        { hp: 450, dmg: 13, range: 320, rate: 1.5, cost: { wood: 60, stone: 60 } },
        { hp: 800, dmg: 20, range: 360, rate: 1.8, cost: { stone: 100, gold: 25 } },
        { hp: 1300, dmg: 30, range: 400, rate: 2.2, cost: { stone: 150, gold: 40, iron: 15 } },
        { hp: 2000, dmg: 45, range: 450, rate: 2.6, cost: { stone: 220, gold: 80, iron: 35 } },
      ],
    },
    mine: {
      name: 'Mine', size: 1, limit: 4, interval: 5, category: 'economy', blocksSight: true,
      desc: 'Fördert regelmäßig Stein & Gold, ab Stufe 3 auch Kohle und Eisenerz.',
      levels: [
        { hp: 200, income: { stone: 2, gold: 1 }, cost: { wood: 60, stone: 40 } },
        { hp: 400, income: { stone: 3, gold: 2 }, cost: { wood: 100, stone: 80 } },
        { hp: 700, income: { stone: 5, gold: 3, coal: 1 }, cost: { stone: 150, gold: 30 } },
        { hp: 1100, income: { stone: 7, gold: 5, coal: 2, iron_ore: 1 }, cost: { stone: 250, gold: 80 } },
        { hp: 1600, income: { stone: 10, gold: 8, coal: 3, iron_ore: 2 }, cost: { stone: 400, gold: 160, iron: 20 } },
      ],
    },
    forge: {
      name: 'Schmiede', size: 1, limit: 1, useRange: 180, category: 'base', blocksSight: true,
      desc: 'Stelle hier Äxte & Kleidung her [F].',
      levels: [
        { hp: 400, cost: { wood: 80, stone: 60 } },
        { hp: 800, cost: { stone: 120, gold: 20 } },
        { hp: 1300, cost: { stone: 200, gold: 60, bone: 10 } },
        { hp: 2000, cost: { stone: 300, gold: 120, scrap: 5, iron: 30 } },
      ],
    },
    // Schmelzofen: Behälter wie eine Truhe, läuft auch, wenn der Besitzer offline ist.
    // modes: Betriebsarten (im Ofen-Fenster wählbar). Alle time Sekunden wird das erste Rezept der Betriebsart
    // hergestellt, für das Material und Platz da sind (cost → n × out). level: nötiges Ofen-Level.
    // Legierungen sind eigene Betriebsarten, damit der Ofen nicht ungefragt alle Barren weiterverarbeitet.
    furnace: {
      name: 'Schmelzofen', size: 1, limit: 2, useRange: 150, category: 'economy', blocksSight: true,
      desc: 'Schmilzt Erze mit Kohle zu Barren, legiert Bronze und veredelt Stahl. Öffnen mit [F].',
      accepts: ['copper_ore', 'tin_ore', 'iron_ore', 'coal', 'copper', 'tin', 'bronze', 'iron', 'steel'], // nur diese Items passen hinein
      modes: [
        {
          id: 'ore', name: 'Erze schmelzen', recipes: [
            { cost: { copper_ore: 2, coal: 1 }, out: 'copper' },
            { cost: { tin_ore: 2, coal: 1 }, out: 'tin' },
            { cost: { iron_ore: 2, coal: 1 }, out: 'iron' },
          ],
        },
        { id: 'bronze', name: 'Bronze legieren', recipes: [{ cost: { copper: 3, tin: 1, coal: 1 }, out: 'bronze', n: 4 }] },
        { id: 'steel', name: 'Stahl veredeln', level: 3, recipes: [{ cost: { iron: 1, coal: 3 }, out: 'steel' }] },
      ],
      levels: [
        { hp: 400, slots: 6, time: 4, cost: { wood: 40, stone: 120 } },
        { hp: 800, slots: 8, time: 3, cost: { stone: 150, iron: 10 } },
        { hp: 1300, slots: 10, time: 2.2, cost: { stone: 200, gold: 40, iron: 25 } },
        { hp: 2000, slots: 12, time: 1.6, cost: { stone: 300, gold: 80, iron: 50 } },
        { hp: 2800, slots: 14, time: 1.2, cost: { stone: 450, gold: 150, iron: 80 } },
      ],
    },
    // Lagerfeuer: auch unterwegs ohne Basis baubar (anywhere, zählt nicht zum Gebäude-Limit). Brennt, solange
    // Holz darin liegt (1 Holz pro burnTime Sekunden), leuchtet nachts und verscheucht Tiere im Umkreis
    // WILDLIFE.fireScare – nur rasend hungrige nicht. Alle time Sekunden wird ein Stück gar (cook: roh → gar).
    campfire: {
      name: 'Lagerfeuer', size: 1, limit: 2, useRange: 150, category: 'base', anywhere: true,
      desc: 'Brät Fleisch & Gemüse und verscheucht Tiere, solange Holz darin brennt [F].',
      fuel: 'wood', burnTime: 10,
      cook: { meat: 'cooked_meat', potato: 'baked_potato', corn: 'roasted_corn', fish: 'cooked_fish' },
      accepts: ['wood', 'meat', 'potato', 'corn', 'fish', 'cooked_meat', 'baked_potato', 'roasted_corn', 'cooked_fish'],
      levels: [{ hp: 150, slots: 6, time: 5, cost: { wood: 30, stone: 10 } }],
    },
    // Gerbgestell: Behälter wie der Ofen, macht ohne Brennstoff aus Fell Leder (modes wie beim Ofen)
    tanner: {
      name: 'Gerbgestell', size: 1, limit: 1, useRange: 150, category: 'economy',
      desc: 'Gerbt Fell zu Leder (2 Fell → 1 Leder). Öffnen mit [F].',
      accepts: ['fur', 'leather'],
      modes: [{ id: 'leather', name: 'Leder gerben', recipes: [{ cost: { fur: 2 }, out: 'leather' }] }],
      levels: [
        { hp: 250, slots: 6, time: 15, cost: { wood: 40, bone: 6 } },
        { hp: 500, slots: 8, time: 10, cost: { wood: 80, stone: 40 } },
      ],
    },
    // Schlafsack: eigener Respawnpunkt (der Kern ist keiner). Auch außerhalb der Basis (anywhere), nie in fremden
    // Basen oder Städten; begehbar. Nach dem Benutzen cooldown Sekunden gesperrt. Ohne Schlafsack: zufällig in der Welt.
    sleeping_bag: {
      name: 'Schlafsack', size: 1, limit: 2, category: 'base', anywhere: true, walkable: true, shootThrough: true, cooldown: 60,
      desc: 'Hier kannst du nach dem Tod wieder aufwachen (max. 2, Auswahl im Todesbildschirm).',
      levels: [{ hp: 150, cost: { fur: 8, wood: 20 } }],
    },
    // Truhe: Lager für Items. slots = Plätze pro Level; nutzbar für Besitzer und Teammitglieder.
    storage: {
      name: 'Truhe', size: 1, limit: 6, useRange: 150, category: 'base', blocksSight: true,
      desc: 'Lagert Items sicher in deiner Basis. Öffnen mit [F] (auch fürs Team).',
      levels: [
        { hp: 300, slots: 10, cost: { wood: 50, stone: 10 } },
        { hp: 600, slots: 15, cost: { wood: 60, stone: 40 } },
        { hp: 1000, slots: 20, cost: { stone: 100, gold: 20 } },
        { hp: 1500, slots: 25, cost: { stone: 160, gold: 60 } },
        { hp: 2200, slots: 30, cost: { stone: 250, gold: 120 } },
      ],
    },
  },

  // Unterhalt: Der Basis-Kern hat ein Lager. Alle interval Sekunden zahlt jede Basis pro Gebäude
  // cost[Level] (der Kern zählt coreMult-fach) aus diesem Lager und repariert dabei repair × maxHp.
  // Reicht der Vorrat nicht, verfällt die ganze Basis: jedes Gebäude verliert decay × maxHp pro Minute.
  UPKEEP: {
    interval: 300,
    items: ['wood', 'stone', 'gold'], // nur diese Ressourcen passen ins Kern-Lager
    cost: [{ wood: 1 }, { wood: 1, stone: 1 }, { stone: 2 }, { stone: 2, gold: 1 }, { stone: 3, gold: 2 }],
    coreMult: 5,
    repair: 0.1,
    decay: 0.02, // Anteil der max. HP pro Minute → leeres Lager = Basis nach ~50 Min. zerfallen
    startStock: { wood: 40 }, // Vorrat eines neuen Kerns
  },

  // Accounts & Speichern (SQLite-Datei, Pfad per DB_PATH änderbar)
  ACCOUNTS: {
    dbPath: process.env.DB_PATH || 'data/bastion.db',
    autosave: 60, // Sekunden zwischen automatischen Speicherungen
    nameMin: 3,
    nameMax: 16,
    passMin: 4,
    passMax: 64,
    loginCooldown: 1, // Sekunden zwischen Login-Versuchen pro Verbindung
  },

  // Teams: Mitglieder verletzen sich nicht, nutzen gegenseitig Türen & Truhen und sehen sich auf der Karte
  TEAM: {
    maxSize: 4,
    inviteTime: 60, // Sekunden, die eine Einladung gültig ist
  },

  // Chat: normale Nachrichten erreichen nur Spieler in der Nähe, "/t …" geht ans ganze Team
  CHAT: {
    range: 1000,
    maxLength: 120,
    cooldown: 0.7, // Sekunden zwischen zwei Nachrichten
  },

  // Gegner & Tiere.
  // level: feste Stufe (sie wachsen nicht mit den Tagen) ≈ empfohlene Ausrüstung – 1–2 Stein, 3–4 Kupfer/Bronze,
  //   5–6 Eisen, 7–8 Stahl. Werte (hp, dmg …) sind darauf abgestimmt; ein Rudel-Alpha zählt eine Stufe mehr.
  // ai: 'zombie' (Untote, nachts wilder), 'pack' (Rudel, jagt Spieler),
  //     'neutral' (friedlich, wehrt sich), 'territorial' (greift nur in der Nähe an)
  // spawn: Gewichtung tagsüber/nachts. pack: Gruppengröße [min, max]
  // Rudel: Der Erste ist der Alpha (alpha: Faktoren für Leben, Schaden, Größe; dunkles Fell), die anderen folgen ihm.
  // predator: Raubtier mit Hunger von 1 (satt) bis 0, sinkt in hungerTime [min, max] Sekunden. Bei 0 wird es
  //   rasend: Es jagt im Umkreis range das schwächste Wesen, das es sieht – Spieler, Zombies und andere Tiere,
  //   nie die eigene Art, nie Gebäude – und ignoriert Lagerfeuer. Jeder Biss bringt bite, eine erlegte Beute
  //   macht satt; ab calm hört die Raserei auf. Beim Rudel teilen sich alle den Hunger. rageSpeed: Tempo-Faktor beim Rasen.
  // cap: höchstens near Tiere (bzw. Rudel) im Umkreis WILDLIFE.capRadius um einen Spieler und perPlayer pro
  //   Spieler online. habitat: Biome, in denen die Art spawnt.
  // drops: jeder Eintrag wird einzeln gewürfelt (chance 0..1, Menge min..max)
  ENEMIES: {
    normal: {
      name: 'Zombie', level: 2, ai: 'zombie', hp: 70, speed: 85, dmg: 10, sdmg: 14, r: 22, score: 10, xp: 8,
      spawn: { day: 35, night: 55 },
      drops: [
        { item: 'gold', chance: 0.6, min: 1, max: 3 },
        { item: 'bone', chance: 0.35, min: 1, max: 2 },
      ],
    },
    runner: {
      name: 'Läufer', level: 1, ai: 'zombie', hp: 35, speed: 150, dmg: 6, sdmg: 6, r: 18, score: 10, xp: 8,
      spawn: { day: 10, night: 25 },
      drops: [
        { item: 'gold', chance: 0.5, min: 1, max: 2 },
        { item: 'bone', chance: 0.3, min: 1, max: 1 },
      ],
    },
    brute: {
      name: 'Koloss', level: 7, ai: 'zombie', hp: 380, speed: 55, dmg: 24, sdmg: 60, r: 34, score: 40, xp: 30,
      spawn: { day: 0, night: 6 },
	  cap: { near: 2, perPlayer: 2 }, habitat: ['urban'],
      drops: [
        { item: 'gold', chance: 1, min: 5, max: 10 },
        { item: 'bone', chance: 0.8, min: 2, max: 4 },
        { item: 'scrap', chance: 0.5, min: 1, max: 2 },
        { item: 'iron_ore', chance: 0.4, min: 2, max: 4 },
        { item: 'essence', chance: 0.2, min: 1, max: 1 },
        { item: 'ward', chance: 0.03, min: 1, max: 1 },
      ],
    },
    wolf: {
      name: 'Wolf', level: 3, ai: 'pack', hp: 60, speed: 175, dmg: 9, sdmg: 5, r: 20, score: 15, xp: 10, aggro: 480,
      pack: [3, 5], alpha: { hp: 1.6, dmg: 1.3, r: 1.2 }, spawn: { day: 18, night: 12 },
      predator: { hungerTime: [150, 300], range: 750, bite: 0.08, calm: 0.5, rageSpeed: 1.15 },
      cap: { near: 2, perPlayer: 2 }, habitat: ['forest', 'grass', 'meadow'],
      drops: [
        { item: 'fur', chance: 0.7, min: 1, max: 2 },
        { item: 'bone', chance: 0.4, min: 1, max: 1 },
      ],
    },
    pig: {
      name: 'Wildschwein', level: 1, ai: 'neutral', hp: 70, speed: 120, dmg: 9, sdmg: 0, r: 24, score: 5, xp: 5,
      spawn: { day: 25, night: 0 },
      drops: [
        { item: 'meat', chance: 1, min: 1, max: 3 },
      ],
    },
    bear: {
      name: 'Bär', level: 6, ai: 'territorial', hp: 480, speed: 105, dmg: 28, sdmg: 45, r: 36, score: 60, xp: 40,
      aggro: 260, leash: 750, spawn: { day: 5, night: 3 },
      predator: { hungerTime: [200, 400], range: 700, bite: 0.06, calm: 0.5, rageSpeed: 1.3 },
      cap: { near: 1, perPlayer: 1.5 }, habitat: ['forest'],
      drops: [
        { item: 'fur', chance: 1, min: 2, max: 4 },
        { item: 'meat', chance: 1, min: 2, max: 4 },
        { item: 'bone', chance: 0.6, min: 2, max: 3 },
        { item: 'essence', chance: 0.15, min: 1, max: 1 },
      ],
    },
  },
  // Erfahrung: benötigte EP für Level L -> L+1 = round(base * L^exp)
  XP: {
    base: 60,
    exp: 1.45,
    gather: 0.5, // pro abgebauter Einheit
    smelt: 1, // pro Eisenbarren (für den Besitzer des Ofens, wenn er online ist)
    deplete: 4, // Ressource komplett abgebaut
    crate: 6, // Kiste aufgebrochen
    craft: 3,
    build: 1,
  },

  // Fertigkeiten: pro Level-Up 1 Punkt. per = Bonus pro Rang (Prozentwerte als Anteil)
  SKILLS: [
    { id: 'strength', name: 'Stärke', icon: '💪', desc: '+8 % Nahkampfschaden', max: 5, per: { meleeDmg: 0.08 } },
    { id: 'marksman', name: 'Schütze', icon: '🎯', desc: '+8 % Fernkampfschaden', max: 5, per: { rangedDmg: 0.08 } },
    { id: 'vitality', name: 'Vitalität', icon: '❤', desc: '+15 Leben', max: 5, per: { maxHp: 15 } },
    { id: 'endurance', name: 'Kondition', icon: '⚡', desc: '+15 Ausdauer', max: 5, per: { stamina: 15 } },
    { id: 'agility', name: 'Flinkheit', icon: '👟', desc: '+4 % Tempo', max: 5, per: { speedPct: 0.04 } },
    { id: 'toughness', name: 'Zähigkeit', icon: '🛡', desc: '+3 Rüstung', max: 5, per: { armor: 3 } },
    { id: 'recovery', name: 'Erholung', icon: '✚', desc: '+0,6 Leben/s Regeneration', max: 5, per: { regen: 0.6 } },
    { id: 'gatherer', name: 'Sammler', icon: '⛏', desc: '+15 % Chance auf doppelten Ertrag', max: 5, per: { doubleGather: 0.15 } },
  ],

  // Fähigkeiten durch Übung: steigen von selbst, wenn man die Tätigkeit ausübt, und bleiben nach dem Tod.
  // EP für Stufe L → L+1 = round(base × (L+1)^exp), höchstens max. per: Bonus pro Stufe,
  // stats: der Bonus ändert Werte im Charakterfenster (dann werden sie beim Aufstieg neu berechnet).
  // EP: Laufen 1 pro runDistance Einheiten (Sprinten ×1,5), Holzfällen/Bergbau 1 pro Einheit,
  //     Schießen/Nahkampf 2 pro Treffer an Gegnern, Plündern 3 pro aufgebrochener Kiste,
  //     Schmieden: Herstellen 1 + Kosten/40, Verbessern 4 + 2 × Zielstufe, Umschmieden 3, Zerlegen 1.
  PRACTICE: {
    max: 20,
    base: 12,
    exp: 1.4,
    runDistance: 150,
    list: [
      { id: 'running', name: 'Laufen', icon: '🏃', desc: '+1 % Tempo und −3 % Ausdauer beim Sprinten pro Stufe', stats: true, per: { speedPct: 0.01, sprintCost: -0.03 } },
      { id: 'woodcutting', name: 'Holzfällen', icon: '🪓', desc: '+4 % Chance auf +1 Holz pro Schlag', per: { extraWood: 0.04 } },
      { id: 'mining', name: 'Bergbau', icon: '⛏', desc: '+4 % Chance auf +1 Stein/Erz/Kohle pro Schlag', per: { extraOre: 0.04 } },
      { id: 'shooting', name: 'Schießen', icon: '🎯', desc: '+2 % Fernkampf-Schaden und Feuerrate pro Stufe', stats: true, per: { rangedDmg: 0.02, rangedRate: 0.02 } },
      { id: 'melee', name: 'Nahkampf', icon: '⚔', desc: '+2 % Nahkampf-Schaden und Schlagtempo pro Stufe', stats: true, per: { meleeDmg: 0.02, meleeRate: 0.02 } },
      { id: 'looting', name: 'Plündern', icon: '📦', desc: '+3 % Chance auf doppelte Beute aus Kisten', per: { lootTwice: 0.03 } },
      {
        id: 'smithing', name: 'Schmieden', icon: '🔨',
        desc: 'Verbessern: +1 % Erfolg, −3 % Stufenverlust, −4 % Zerstören (relativ) und +1 % Chance auf bessere Seltenheit beim Herstellen pro Stufe',
        per: { smithSuccess: 0.01, smithDrop: -0.03, smithBreak: -0.04, smithLuck: 0.01 },
      },
    ],
  },

  HOTBAR_SIZE: 6,

  // Nahkampf der Gegner: Sie holen windup Sekunden aus; trifft der Schlag erst dann, wenn der Spieler noch
  // innerhalb von Körperradien + reach steht. Wer rechtzeitig wegläuft, weicht aus.
  // idleStructureChance: Gegner ohne Ziel, die an ein Gebäude stoßen, schlagen nur mit dieser Chance zu
  // (pro Versuch, etwa 1×/s) und drehen sonst ab. Mit Ziel wird eingeschlagen, was im Weg steht.
  ENEMY_ATTACK: { windup: 0.15, reach: 16, idleStructureChance: 0.03 },

  ANGER_TIME: 8, // Sekunden, die ein angegriffener Gegner seinen Angreifer verfolgt

  // Tiere: capRadius für ENEMIES[*].cap, fireScare = Umkreis, in dem ein brennendes Lagerfeuer Tiere verscheucht,
  // alphaFlee = Sekunden, die ein Rudel nach dem Tod seines Alphas flieht
  // Angeln: wait = Sekunden bis zum Biss [min, max], catches: was anbeißt (weight = relative Chance, n = Menge oder [min, max])
  FISHING: {
    wait: [3, 8],
    xp: 4,
    catches: [
      { item: 'fish', n: 1, weight: 70 },
      { item: 'fish', n: 2, weight: 15, msg: '🎣 Ein großer Fisch – reicht für zwei!' },
      { item: 'scrap', n: [1, 2], weight: 8, msg: '🎣 Nur rostiger Schrott …' },
      { item: 'can', n: 1, weight: 7, msg: '🎣 Eine Konserve hing am Haken!' },
    ],
  },
  WILDLIFE: { capRadius: 1600, fireScare: 300, torchScare: 220, alphaFlee: 4 }, // torchScare: Umkreis einer Fackel in der Hand

  // Hunger & Durst der Spieler (0 bis max): sinken in hungerTime bzw. thirstTime Sekunden von voll auf leer
  // (beim Sprinten sprintMult-mal so schnell). Ist einer leer, kostet das starveDamage Leben pro Sekunde;
  // unter noRegenBelow heilt man nicht mehr von selbst. Am See trinken: [F] (füllt auch leere Feldflaschen).
  SURVIVAL: {
    max: 100,
    hungerTime: 720,
    thirstTime: 480,
    sprintMult: 1.75,
    starveDamage: 2,
    noRegenBelow: 25,
    warnAt: 20,
    respawnFill: 0.6, // so voll sind Hunger & Durst nach dem Wiederbeleben
    drinkRange: 70, // Abstand zum Seeufer
    drinkAmount: 30,
    drinkCooldown: 0.8,
  },
  DROP_NIGHT_BONUS: 1.5,
  MINIMAP_RANGE: 1800, // Radar-Reichweite der Minimap (Welteinheiten um den Spieler)

  // Nachts gibt es keine Horden auf Basen – die Untoten (ai 'zombie') werden stattdessen wilder:
  // mehr, schneller, sie sehen weiter, schlagen öfter und härter zu.
  SPAWN: {
    maxTotal: 400,
    dayInterval: 3.5, // Sekunden zwischen Spawns pro Spieler
    nightInterval: 0.9,
    dayBase: 4, // gewünschte Zombies in der Nähe tagsüber
    nightBase: 15, // nachts (fest – Gegner wachsen nicht mit den Tagen)
    dayAggro: 420,
    nightAggro: 950,
    nightSpeed: 1.3, // Tempo-Faktor nachts
    nightDamage: 1.25, // Schaden an Spielern nachts
    nightAttackSpeed: 1.35, // Schläge pro Sekunde nachts
    // Morgengrauen: nachts gespawnte Untote zerfallen (ohne Beute). Wer gerade von keinem Spieler gesehen
    // wird, verschwindet sofort; sichtbare qualmen und zerfallen in dawnBurn Sekunden. Solange sie kämpfen
    // (Ziel in der Nähe oder gerade angegriffen), pausiert der Zerfall.
    dawnBurn: 15,
    // Aufräumen: alle cleanupInterval Sekunden werden Gegner, die über dem gewünschten Bestand
    // (+ cleanupSlack) um einen Spieler liegen, entfernt – nur außerhalb jedes Sichtfelds und nur untätige.
    cleanupInterval: 2,
    cleanupSlack: 3,
    cleanupPerPass: 4,
  },
};
