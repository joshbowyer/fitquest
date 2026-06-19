// Quest types — mirrors api/src/lib/worlds.ts

export type WorldColor = 'magenta' | 'lime' | 'goldenrod' | 'periwinkle' | 'violet' | 'cyan';
export type WorldAffiliation = 'JUGGERNAUT' | 'PHANTOM' | 'SCOUT' | 'BERSERKER' | 'ORACLE' | 'NEUTRAL';

export type WorldLevel = {
  id: string;
  order: number;
  name: string;
  description: string;
  enemy: string;
  enemyGlyph: string;
  difficulty: number;
  xp: number;
  gold: number;
  requiredLevelId: string | null;
  playerLevelRequired: number;
  progress: WorldLevelProgress | null;
};

export type WorldLevelProgress = {
  id: string;
  levelId: string;
  completed: boolean;
  attempts: number;
  bestScore: number;
  completedAt: string | null;
};

export type World = {
  id: string;
  name: string;
  theme: string;
  color: WorldColor;
  affiliation: WorldAffiliation;
  description: string;
  levelRequired: number;
  icon: string;
  levels: WorldLevel[];
};

export const WORLD_COLOR_HEX: Record<WorldColor, string> = {
  magenta:    '#f55cc4',
  lime:       '#9bff5c',
  goldenrod:  '#ffc34d',
  periwinkle: '#7d7bff',
  violet:     '#c45cff',
  cyan:       '#14d6e8',
};

// Compact tile positions for the 4 portals on the overworld map.
// (cx, cy) is home base; the portals radiate out at NSEW.
export type PortalTile = {
  world: World;
  cx: number;
  cy: number;
  // Path from home base (8, 4.5) — a series of (x, y) cells
  pathCells: Array<{ x: number; y: number }>;
};

export const MAP_TILES_X = 16;
export const MAP_TILES_Y = 9;
export const HOME_TILE = { x: 8, y: 4 };

export function portalLayoutFor(worlds: World[]): PortalTile[] {
  // N, E, S, W slots — first 4 worlds in array order
  const directions: Array<{ cx: number; cy: number; steps: Array<{ dx: number; dy: number }> }> = [
    { cx: 8, cy: 1, steps: [{ dx: 0, dy: -1 }, { dx: 0, dy: -1 }, { dx: 0, dy: -1 }] },                  // N
    { cx: 14, cy: 4, steps: [{ dx: 1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 1, dy: 0 }] }, // E
    { cx: 8, cy: 8, steps: [{ dx: 0, dy: 1 }, { dx: 0, dy: 1 }, { dx: 0, dy: 1 }, { dx: 0, dy: 1 }] },     // S
    { cx: 1, cy: 4, steps: [{ dx: -1, dy: 0 }, { dx: -1, dy: 0 }, { dx: -1, dy: 0 }, { dx: -1, dy: 0 }, { dx: -1, dy: 0 }, { dx: -1, dy: 0 }, { dx: -1, dy: 0 }] }, // W
  ];
  return worlds.slice(0, 4).map((w, i) => {
    const d = directions[i];
    const cells: Array<{ x: number; y: number }> = [{ x: HOME_TILE.x, y: HOME_TILE.y }];
    let cx = HOME_TILE.x;
    let cy = HOME_TILE.y;
    for (const step of d.steps) {
      cx += step.dx;
      cy += step.dy;
      cells.push({ x: cx, y: cy });
    }
    return { world: w, cx: d.cx, cy: d.cy, pathCells: cells };
  });
}
