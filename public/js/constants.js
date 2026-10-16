// Farben, Symbole und andere feste Werte für die Darstellung.

export const TAU = Math.PI * 2;

// Gebäude-Stufen 1–5: Holz, Stein, Gold, Diamant, Rubin
export const LEVEL_COLORS = ['#a8743f', '#9aa1a8', '#e8b93f', '#62d6e8', '#e0577a'];
export const LEVEL_DARK = ['#6b4524', '#5c6268', '#9a7419', '#2b93a6', '#8f2a47'];
export const LEVEL_NAMES = ['Holz', 'Stein', 'Gold', 'Diamant', 'Rubin'];

export const RES_ICON = {
  wood: '🪵', stone: '🪨', gold: '🪙', bone: '🦴', scrap: '🔩', fur: '🧶', meat: '🍖', iron_ore: '🟤', coal: '⚫', iron: '⛓️', can: '🥫', bandage: '🩹',
  berries: '🫐', apple: '🍎', carrot: '🥕', potato: '🥔', corn: '🌽', pumpkin: '🎃', cooked_meat: '🍗', baked_potato: '🥔', roasted_corn: '🌽',
  bottle: '🫙', water: '💧', whetstone: '🪨', essence: '🔮', ward: '🛡️',
  arrow_wood: '🏹', arrow_stone: '🏹', arrow_iron: '🏹', bullet: '🔸', shell: '🔴',
};

// Pfeilspitzen [hell, dunkel] nach "look" der Munition (1 = Kugel, kein Pfeil)
export const ARROW_TIPS = [['#8a6236', '#4a3019'], null, ['#9aa1a8', '#5c6268'], ['#d4dde6', '#6a7682']];

export const ZOMBIE_COLORS = { normal: '#6d9b48', runner: '#a3c652', brute: '#4b6f37' };
export const ARMOR_COLORS = [['#9a7650', '#5a4128'], ['#a3aab1', '#545a60']]; // Fell, Eisen

// Biome im Bodenbild: Wiese, Wald, Fels, Sand, Blumenwiese, Stadt
export const BIOME_COLORS = [[92, 139, 62], [63, 111, 46], [125, 132, 102], [205, 187, 131], [119, 163, 74], [123, 117, 99]];
export const BIOME = { grass: 0, forest: 1, rocky: 2, sand: 3, meadow: 4, urban: 5 };

// Wie "hoch" Objekte für Sonnenschatten sind. Ressourcen relativ zum Radius, Gebäude in Welteinheiten.
export const RES_HEIGHT = {
  tree: 1.5, rock: 0.55, gold: 0.5, iron: 0.5, coal: 0.45,
  apple_tree: 1.4, berry_bush: 0.6, carrot: 0.25, potato: 0.25, corn: 1.3, pumpkin: 0.5,
  crate: 1, shelf: 1.4, weapon_crate: 0.9, med_cabinet: 1.6, toolbox: 0.7, barrel: 1.4, car: 0.6,
};
export const RUIN_HEIGHT = 40;
export const STRUCT_HEIGHT = { core: 60, wall: 42, door: 30, window: 42, spike: 10, turret: 55, mine: 28, forge: 38, storage: 26, furnace: 44, campfire: 12 };

// Partikel- und Leistenfarbe je Ressource
export const RESOURCE_COLORS = {
  apple_tree: '#3b8535', berry_bush: '#4f8f3a', carrot: '#f08a24', potato: '#b08850', corn: '#f2d24a', pumpkin: '#e8892b',
  tree: '#3b8535', rock: '#8b9196', gold: '#f4c63d', iron: '#c0703e', coal: '#3a3a3d',
  crate: '#a8743f', shelf: '#9aa3ab', weapon_crate: '#4f5e3a', med_cabinet: '#eef2f0', toolbox: '#c0392b', barrel: '#2f6fa3', car: '#7d5a4a',
};

export const FONT = 'Segoe UI, sans-serif';

// Ressourcen mit Baumkrone (werden über den Figuren gezeichnet)
export const TREE_TYPES = new Set(['tree', 'apple_tree']);
