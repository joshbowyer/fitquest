// Quest types — mirrors api/src/lib/worlds.ts

export type WorldColor = 'red' | 'orange' | 'magenta' | 'lime' | 'goldenrod' | 'periwinkle' | 'violet' | 'cyan';
export type WorldAffiliation = 'JUGGERNAUT' | 'PHANTOM' | 'SCOUT' | 'BERSERKER' | 'ORACLE' | 'NEUTRAL';

// Requirement progress for a single level. The backend computes
// this based on the user's actual data (workouts, sleep, recovery).
export type RequirementProgress = {
  current: number | null;
  target: number;
  pct: number; // 0-1
  cleared: boolean;
};

export type LevelRequirement =
  | { kind: 'WEIGHT_REPS'; exercise: string; weightKg: number; reps: number; }
  | { kind: 'WEIGHT_BODYWEIGHT_MULT'; exercise: string; multiplier: number; reps: number; }
  | { kind: 'CARDIO_5K'; maxSeconds: number; }
  | { kind: 'CARDIO_DISTANCE'; minMeters: number; }
  | { kind: 'CALISTHENICS_REPS'; exercise: string; reps: number; }
  | { kind: 'PLANK_HOLD'; minSeconds: number; }
  | { kind: 'SLEEP_STREAK'; minHours: number; consecutiveDays: number; }
  | { kind: 'RECOVERY_STREAK'; minScore: number; consecutiveDays: number; }
  | { kind: 'TOTAL_VOLUME'; minVolumeKg: number; windowDays: number; };

export type WorldLevel = {
  id: string;
  order: number;
  name: string;
  description: string;
  enemy: string;
  enemyGlyph: string;
  xp: number;
  gold: number;
  requiredLevelId: string | null;
  playerLevelRequired: number;
  requirement: LevelRequirement;
  requirementSummary: string;
  progress: RequirementProgress | null;
  completed: boolean;
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
  boss: {
    name: string;
    glyph: string;
    maxHp: number;
    lore: string;
  };
};

export const WORLD_COLOR_HEX: Record<WorldColor, string> = {
  red:        '#dc2626',
  orange:     '#ff8c00',
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

/**
 * Map a class short-name to the world color it visually pairs with
 * for accent purposes. Mirrors the logic in QuestWorld.tsx but
 * exported so other pages (e.g. inventory class-lock badges) can
 * share the same color assignments without duplicating the mapping.
 */
export type ClassAccent = 'red' | 'magenta' | 'lime' | 'orange' | 'goldenrod' | 'periwinkle';
// 'cyan' = neutral fallback for unknown/unset classes; consumers look
// the value up in WORLD_COLOR_HEX where 'cyan' is a valid key.
export function primaryColorForClass(c: string): ClassAccent | 'cyan' {
  // 1-to-1 mapping — each class gets its own distinctive accent so
  // class-lock badges and sprite stripes don't look identical for
  // different classes. Matches the world color scheme in
  // WORLD_COLOR_HEX above.
  switch (c) {
    case 'JUGGERNAUT': return 'red';
    case 'BERSERKER':  return 'magenta';
    case 'PHANTOM':    return 'lime';
    case 'TRACER':     return 'orange';
    case 'SCOUT':      return 'goldenrod';
    case 'ORACLE':     return 'periwinkle';
    default:          return 'cyan';
  }
}
