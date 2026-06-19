// Static quest content. Worlds and levels are baked in — only
// the user's progress is in the DB. Keeps the lore testable and
// the API cacheable.

export type WorldColor = 'magenta' | 'lime' | 'goldenrod' | 'periwinkle' | 'violet' | 'cyan';
export type WorldAffiliation = 'JUGGERNAUT' | 'PHANTOM' | 'SCOUT' | 'BERSERKER' | 'ORACLE' | 'NEUTRAL';

export type WorldLevel = {
  id: string;            // e.g. "spire-1"
  order: number;         // 1-based within world
  name: string;
  description: string;   // flavor / encounter narrative
  enemy: string;         // enemy name
  enemyGlyph: string;    // small icon hint (e.g. "▣", "✦", "◆")
  difficulty: number;    // 1-10, gates reward scaling
  xp: number;
  gold: number;
  requiredLevelId: string | null; // previous level id, null = first in world
  playerLevelRequired: number;    // player overall level required to attempt
};

export type World = {
  id: string;            // e.g. "spire"
  name: string;
  theme: string;         // one-word vibe
  color: WorldColor;
  affiliation: WorldAffiliation;
  description: string;
  levelRequired: number; // player level required to see the portal
  icon: string;          // portal icon (e.g. "▣")
  levels: WorldLevel[];
};

export const WORLDS: World[] = [
  {
    id: 'spire',
    name: 'The Spire',
    theme: 'STRENGTH',
    color: 'magenta',
    affiliation: 'JUGGERNAUT',
    description:
      'A tower of stone, climbing forever. Each floor houses a heavier golem. The path of the strong.',
    levelRequired: 1,
    icon: '▣',
    levels: [
      { id: 'spire-1', order: 1, name: 'Trial of Stone',    description: 'A stone golem blocks the doorway, slow but unyielding.',                  enemy: 'Stone Golem',     enemyGlyph: '▣', difficulty: 1, xp: 50,  gold: 20,  requiredLevelId: null,      playerLevelRequired: 1 },
      { id: 'spire-2', order: 2, name: 'The Iron Door',     description: 'A door of beaten iron guards the next chamber. Only force opens it.', enemy: 'Iron Sentinel',   enemyGlyph: '▤', difficulty: 2, xp: 90,  gold: 35,  requiredLevelId: 'spire-1', playerLevelRequired: 2 },
      { id: 'spire-3', order: 3, name: 'Granite Halls',     description: 'Walls of granite. Echoes of heavy footsteps.',                          enemy: 'Granite Warden',  enemyGlyph: '▥', difficulty: 3, xp: 140, gold: 55,  requiredLevelId: 'spire-2', playerLevelRequired: 3 },
      { id: 'spire-4', order: 4, name: 'The Twin Pillars',  description: 'Two massive stone giants, moving in perfect sync.',                     enemy: 'Twin Pillar Golems', enemyGlyph: '▦', difficulty: 4, xp: 200, gold: 80, requiredLevelId: 'spire-3', playerLevelRequired: 4 },
      { id: 'spire-5', order: 5, name: 'Crown of the Spire',description: 'At the top, a single mountain of muscle awaits.',                       enemy: 'The Stone Titan', enemyGlyph: '▩', difficulty: 5, xp: 300, gold: 120, requiredLevelId: 'spire-4', playerLevelRequired: 5 },
    ],
  },
  {
    id: 'glade',
    name: 'Shadow Glade',
    theme: 'AGILITY',
    color: 'lime',
    affiliation: 'PHANTOM',
    description:
      'A forest of moving shadows. Things that should not move, do. The path of the unseen.',
    levelRequired: 1,
    icon: '✦',
    levels: [
      { id: 'glade-1', order: 1, name: 'First Steps Quiet', description: 'A wisp circles the path. Catch it without being seen.',         enemy: 'Shadow Wisp',    enemyGlyph: '✦', difficulty: 1, xp: 50,  gold: 20,  requiredLevelId: null,      playerLevelRequired: 1 },
      { id: 'glade-2', order: 2, name: 'The Murmuring Trees',description: 'Trees whisper your name. The forest itself is hunting you.',  enemy: 'Echo Dryad',     enemyGlyph: '✶', difficulty: 2, xp: 90,  gold: 35,  requiredLevelId: 'glade-1', playerLevelRequired: 2 },
      { id: 'glade-3', order: 3, name: 'A Thousand Eyes',   description: 'Eyes in every leaf. They never blink first.',                    enemy: 'Hollow Stalker', enemyGlyph: '✷', difficulty: 3, xp: 140, gold: 55,  requiredLevelId: 'glade-2', playerLevelRequired: 3 },
      { id: 'glade-4', order: 4, name: 'The Pale Court',    description: 'Noble shades in masks, dancing on the moss.',                    enemy: 'Pale Dancer',    enemyGlyph: '❖', difficulty: 4, xp: 200, gold: 80,  requiredLevelId: 'glade-3', playerLevelRequired: 4 },
      { id: 'glade-5', order: 5, name: 'Heart of the Glade',description: 'The forest is one creature, and it is vast.',                   enemy: 'The Old Shade',  enemyGlyph: '✴', difficulty: 5, xp: 300, gold: 120, requiredLevelId: 'glade-4', playerLevelRequired: 5 },
    ],
  },
  {
    id: 'citadel',
    name: 'Iron Citadel',
    theme: 'CONSTITUTION',
    color: 'goldenrod',
    affiliation: 'BERSERKER',
    description:
      'A fortress that attacks endlessly. Hold the line. The path of the unbreakable.',
    levelRequired: 1,
    icon: '◆',
    levels: [
      { id: 'citadel-1', order: 1, name: 'The Long Watch',     description: 'A siege that lasts three days. Do not sleep.',                  enemy: 'Siege Wave',    enemyGlyph: '◆', difficulty: 1, xp: 50,  gold: 20,  requiredLevelId: null,        playerLevelRequired: 1 },
      { id: 'citadel-2', order: 2, name: 'Battering Rams',     description: 'Rams strike the gate. Hold it. Or become the gate.',            enemy: 'Battering Ram', enemyGlyph: '◇', difficulty: 2, xp: 90,  gold: 35,  requiredLevelId: 'citadel-1', playerLevelRequired: 2 },
      { id: 'citadel-3', order: 3, name: 'The Iron Rain',      description: 'Arrows blacken the sky. Stand. Or be buried.',                 enemy: 'Arrow Storm',   enemyGlyph: '◈', difficulty: 3, xp: 140, gold: 55,  requiredLevelId: 'citadel-2', playerLevelRequired: 3 },
      { id: 'citadel-4', order: 4, name: 'The Inner Wall',     description: 'Inside the walls, the enemy is past caring about victory.',    enemy: 'Wallbreaker',  enemyGlyph: '◉', difficulty: 4, xp: 200, gold: 80,  requiredLevelId: 'citadel-3', playerLevelRequired: 4 },
      { id: 'citadel-5', order: 5, name: 'The Last Stand',     description: 'You against the citadel. You do not bend.',                    enemy: 'The Iron Lord',enemyGlyph: '◊', difficulty: 5, xp: 300, gold: 120, requiredLevelId: 'citadel-4', playerLevelRequired: 5 },
    ],
  },
  {
    id: 'sanctum',
    name: 'Mind Sanctum',
    theme: 'MIND',
    color: 'periwinkle',
    affiliation: 'ORACLE',
    description:
      'A library that reads you. The walls remember what you have not yet done. The path of the prepared.',
    levelRequired: 1,
    icon: '✴',
    levels: [
      { id: 'sanctum-1', order: 1, name: 'The First Question',  description: 'A door asks you a question. Answer without speaking.',     enemy: 'The Door',         enemyGlyph: '✴', difficulty: 1, xp: 50,  gold: 20,  requiredLevelId: null,          playerLevelRequired: 1 },
      { id: 'sanctum-2', order: 2, name: 'Hall of Mirrors',     description: 'You meet yourself, but wrong. Walk past without flinching.', enemy: 'Echo Self',      enemyGlyph: '✳', difficulty: 2, xp: 90,  gold: 35,  requiredLevelId: 'sanctum-1',  playerLevelRequired: 2 },
      { id: 'sanctum-3', order: 3, name: 'The Empty Stacks',    description: 'Shelves that have always been empty. That is the lie.',     enemy: 'Hollow Librarian',enemyGlyph: '✼', difficulty: 3, xp: 140, gold: 55,  requiredLevelId: 'sanctum-2',  playerLevelRequired: 3 },
      { id: 'sanctum-4', order: 4, name: 'The Long Memory',     description: 'A memory that has not happened yet, waiting for you.',      enemy: 'The Old Page',   enemyGlyph: '❄', difficulty: 4, xp: 200, gold: 80,  requiredLevelId: 'sanctum-3',  playerLevelRequired: 4 },
      { id: 'sanctum-5', order: 5, name: 'The Final Answer',    description: 'A question you have been asking all your life.',            enemy: 'The Reader',     enemyGlyph: '✺', difficulty: 5, xp: 300, gold: 120, requiredLevelId: 'sanctum-4',  playerLevelRequired: 5 },
    ],
  },
];

// Quick lookups
const _byId = new Map<string, World>();
for (const w of WORLDS) _byId.set(w.id, w);

export function getWorld(id: string): World | undefined {
  return _byId.get(id);
}

export function getLevel(id: string): { world: World; level: WorldLevel } | undefined {
  for (const w of WORLDS) {
    const lvl = w.levels.find((l) => l.id === id);
    if (lvl) return { world: w, level: lvl };
  }
  return undefined;
}

// World color → semantic neon (CSS variable name pattern)
export const WORLD_COLOR_VAR: Record<WorldColor, string> = {
  magenta:    '#f55cc4',
  lime:       '#9bff5c',
  goldenrod:  '#ffc34d',
  periwinkle: '#7d7bff',
  violet:     '#c45cff',
  cyan:       '#14d6e8',
};
