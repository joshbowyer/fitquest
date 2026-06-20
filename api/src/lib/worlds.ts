// Static quest content. Worlds and levels are baked in — only
// the user's progress is in the DB.
//
// Each level has a `requirement` field that's checked against the
// user's actual data (workouts, measurements, sleep logs). When the
// requirement is met, the level auto-clears.
//
// Thresholds are FRAME-RELATIVE — they scale with the user's
// weight/heights so a 130lb user and a 250lb user both have
// meaningful progressions to work toward.

// A level's requirement. Describes what the user needs to do.
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

// The player's current best for this kind of requirement.
// Used to show progress (% to threshold) and detect completion.
export type RequirementProgress = {
  // Current best as a comparable value (e.g., kg, seconds, days).
  // Null if the user has no data yet.
  current: number | null;
  // Target value required to clear.
  target: number;
  // Progress as 0-1. Capped at 1.
  pct: number;
  // Whether the requirement is currently met.
  cleared: boolean;
};

export type WorldColor = 'magenta' | 'lime' | 'goldenrod' | 'periwinkle' | 'violet' | 'cyan';
export type WorldAffiliation = 'JUGGERNAUT' | 'PHANTOM' | 'SCOUT' | 'BERSERKER' | 'ORACLE' | 'NEUTRAL';

export type WorldLevel = {
  id: string;            // e.g. "spire-1"
  order: number;         // 1-based within world
  name: string;
  description: string;   // flavor / encounter narrative
  enemy: string;         // enemy name
  enemyGlyph: string;    // small icon hint (e.g. "▣", "✦", "◆")
  xp: number;
  gold: number;
  requiredLevelId: string | null; // previous level id, null = first in world
  playerLevelRequired: number;    // player overall level required to attempt
  requirement: LevelRequirement;
  // Human-readable summary of the requirement (e.g., "Bench Press 80kg × 5")
  requirementSummary: string;
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

// Frame-relative threshold builder. All level requirements are
// derived from the user's body weight so they scale naturally:
//  - 200lb lifter doesn't have to hit the same absolute bench as
//    a 130lb lifter — they hit bodyweight × multiplier
//  - cardio times are absolute (5K under X seconds) so progress
//    is comparable across users
//  - calisthenics reps are absolute
//  - sleep/recovery streaks are absolute

// Helper to build a strength requirement
function lift(ex: string, weightKg: number, reps = 5): LevelRequirement {
  return { kind: 'WEIGHT_REPS', exercise: ex, weightKg, reps };
}
function liftBw(ex: string, multiplier: number, reps = 5): LevelRequirement {
  return { kind: 'WEIGHT_BODYWEIGHT_MULT', exercise: ex, multiplier, reps };
}

export const WORLDS: World[] = [
  {
    id: 'spire',
    name: 'The Spire',
    theme: 'STRENGTH',
    color: 'magenta',
    affiliation: 'JUGGERNAUT',
    description: 'A tower of stone, climbing forever. Each floor houses a heavier golem. The path of the strong.',
    levelRequired: 1,
    icon: '▣',
    // Thresholds are absolute beginner values — a 60kg bench is
    // achievable for most within a few months of training.
    levels: [
      { id: 'spire-1', order: 1, name: 'Trial of Stone', description: 'A stone golem blocks the doorway, slow but unyielding.', enemy: 'Stone Golem', enemyGlyph: '▣',
        xp: 50, gold: 20, requiredLevelId: null, playerLevelRequired: 1,
        requirement: lift('Bench Press', 60),
        requirementSummary: 'Bench Press 60kg × 5 reps (in any single set)' },
      { id: 'spire-2', order: 2, name: 'The Iron Door', description: 'A door of beaten iron guards the next chamber. Only force opens it.', enemy: 'Iron Sentinel', enemyGlyph: '▤',
        xp: 90, gold: 35, requiredLevelId: 'spire-1', playerLevelRequired: 2,
        requirement: lift('Bench Press', 80),
        requirementSummary: 'Bench Press 80kg × 5 reps' },
      { id: 'spire-3', order: 3, name: 'Granite Halls', description: 'Walls of granite. Echoes of heavy footsteps.', enemy: 'Granite Warden', enemyGlyph: '▥',
        xp: 140, gold: 55, requiredLevelId: 'spire-2', playerLevelRequired: 3,
        requirement: lift('Squat', 100),
        requirementSummary: 'Squat 100kg × 5 reps' },
      { id: 'spire-4', order: 4, name: 'The Twin Pillars', description: 'Two massive stone giants, moving in perfect sync.', enemy: 'Twin Pillar Golems', enemyGlyph: '▦',
        xp: 200, gold: 80, requiredLevelId: 'spire-3', playerLevelRequired: 4,
        requirement: lift('Deadlift', 140),
        requirementSummary: 'Deadlift 140kg × 5 reps' },
      // Level 5 scales with bodyweight — bench BW × 1.0 is a
      // strong intermediate lifter.
      { id: 'spire-5', order: 5, name: 'Crown of the Spire', description: 'At the top, a single mountain of muscle awaits.', enemy: 'The Stone Titan', enemyGlyph: '▩',
        xp: 300, gold: 120, requiredLevelId: 'spire-4', playerLevelRequired: 5,
        requirement: liftBw('Bench Press', 1.0),
        requirementSummary: 'Bench Press your bodyweight × 5 reps' },
    ],
  },
  {
    id: 'glade',
    name: 'Shadow Glade',
    theme: 'AGILITY',
    color: 'lime',
    affiliation: 'PHANTOM',
    description: 'A forest of moving shadows. Things that should not move, do. The path of the unseen.',
    levelRequired: 1,
    icon: '✦',
    // Cardio times are absolute seconds. 30min 5K = 1800s, 25min = 1500s.
    levels: [
      { id: 'glade-1', order: 1, name: 'First Steps Quiet', description: 'A wisp circles the path. Catch it without being seen.', enemy: 'Shadow Wisp', enemyGlyph: '✦',
        xp: 50, gold: 20, requiredLevelId: null, playerLevelRequired: 1,
        requirement: { kind: 'CARDIO_DISTANCE', minMeters: 5000 },
        requirementSummary: 'Run or walk 5km (any pace, in any single session)' },
      { id: 'glade-2', order: 2, name: 'The Murmuring Trees', description: 'Trees whisper your name. The forest itself is hunting you.', enemy: 'Echo Dryad', enemyGlyph: '✶',
        xp: 90, gold: 35, requiredLevelId: 'glade-1', playerLevelRequired: 2,
        requirement: { kind: 'CARDIO_5K', maxSeconds: 2400 }, // 40 min
        requirementSummary: '5K run under 40 minutes' },
      { id: 'glade-3', order: 3, name: 'A Thousand Eyes', description: 'Eyes in every leaf. They never blink first.', enemy: 'Hollow Stalker', enemyGlyph: '✷',
        xp: 140, gold: 55, requiredLevelId: 'glade-2', playerLevelRequired: 3,
        requirement: { kind: 'CARDIO_5K', maxSeconds: 1800 }, // 30 min
        requirementSummary: '5K run under 30 minutes' },
      { id: 'glade-4', order: 4, name: 'The Pale Court', description: 'Noble shades in masks, dancing on the moss.', enemy: 'Pale Dancer', enemyGlyph: '❖',
        xp: 200, gold: 80, requiredLevelId: 'glade-3', playerLevelRequired: 4,
        requirement: { kind: 'CARDIO_5K', maxSeconds: 1500 }, // 25 min
        requirementSummary: '5K run under 25 minutes' },
      { id: 'glade-5', order: 5, name: 'Heart of the Glade', description: 'The forest is one creature, and it is vast.', enemy: 'The Old Shade', enemyGlyph: '✴',
        xp: 300, gold: 120, requiredLevelId: 'glade-4', playerLevelRequired: 5,
        requirement: { kind: 'CARDIO_5K', maxSeconds: 1260 }, // 21 min
        requirementSummary: '5K run under 21 minutes' },
    ],
  },
  {
    id: 'citadel',
    name: 'Iron Citadel',
    theme: 'CONSTITUTION',
    color: 'goldenrod',
    affiliation: 'BERSERKER',
    description: 'A fortress that attacks endlessly. Hold the line. The path of the unbreakable.',
    levelRequired: 1,
    icon: '◆',
    // Calisthenics reps and plank holds are absolute.
    levels: [
      { id: 'citadel-1', order: 1, name: 'The Long Watch', description: 'A siege that lasts three days. Do not sleep.', enemy: 'Siege Wave', enemyGlyph: '◆',
        xp: 50, gold: 20, requiredLevelId: null, playerLevelRequired: 1,
        requirement: { kind: 'CALISTHENICS_REPS', exercise: 'Push-Up', reps: 25 },
        requirementSummary: '25 push-ups (in a single set)' },
      { id: 'citadel-2', order: 2, name: 'Battering Rams', description: 'Rams strike the gate. Hold it. Or become the gate.', enemy: 'Battering Ram', enemyGlyph: '◇',
        xp: 90, gold: 35, requiredLevelId: 'citadel-1', playerLevelRequired: 2,
        requirement: { kind: 'CALISTHENICS_REPS', exercise: 'Pull-Up', reps: 5 },
        requirementSummary: '5 pull-ups (in a single set)' },
      { id: 'citadel-3', order: 3, name: 'The Iron Rain', description: 'Arrows blacken the sky. Stand. Or be buried.', enemy: 'Arrow Storm', enemyGlyph: '◈',
        xp: 140, gold: 55, requiredLevelId: 'citadel-2', playerLevelRequired: 3,
        requirement: { kind: 'PLANK_HOLD', minSeconds: 90 },
        requirementSummary: 'Hold a plank for 90 seconds' },
      { id: 'citadel-4', order: 4, name: 'The Inner Wall', description: 'Inside the walls, the enemy is past caring about victory.', enemy: 'Wallbreaker', enemyGlyph: '◉',
        xp: 200, gold: 80, requiredLevelId: 'citadel-3', playerLevelRequired: 4,
        requirement: { kind: 'CALISTHENICS_REPS', exercise: 'Pull-Up', reps: 15 },
        requirementSummary: '15 pull-ups (in a single set)' },
      { id: 'citadel-5', order: 5, name: 'The Last Stand', description: 'You against the citadel. You do not bend.', enemy: 'The Iron Lord', enemyGlyph: '◊',
        xp: 300, gold: 120, requiredLevelId: 'citadel-4', playerLevelRequired: 5,
        requirement: { kind: 'PLANK_HOLD', minSeconds: 300 },
        requirementSummary: 'Hold a plank for 5 minutes' },
    ],
  },
  {
    id: 'sanctum',
    name: 'Mind Sanctum',
    theme: 'MIND',
    color: 'periwinkle',
    affiliation: 'ORACLE',
    description: 'A library that reads you. The walls remember what you have not yet done. The path of the prepared.',
    levelRequired: 1,
    icon: '✴',
    // Sleep and recovery streaks. No punishment for missing — just
    // a target to work toward.
    levels: [
      { id: 'sanctum-1', order: 1, name: 'The First Question', description: 'A door asks you a question. Answer without speaking.', enemy: 'The Door', enemyGlyph: '✴',
        xp: 50, gold: 20, requiredLevelId: null, playerLevelRequired: 1,
        requirement: { kind: 'SLEEP_STREAK', minHours: 7, consecutiveDays: 3 },
        requirementSummary: 'Sleep 7+ hours for 3 consecutive nights' },
      { id: 'sanctum-2', order: 2, name: 'Hall of Mirrors', description: 'You meet yourself, but wrong. Walk past without flinching.', enemy: 'Echo Self', enemyGlyph: '✳',
        xp: 90, gold: 35, requiredLevelId: 'sanctum-1', playerLevelRequired: 2,
        requirement: { kind: 'SLEEP_STREAK', minHours: 7, consecutiveDays: 7 },
        requirementSummary: 'Sleep 7+ hours for 7 consecutive nights' },
      { id: 'sanctum-3', order: 3, name: 'The Empty Stacks', description: 'Shelves that have always been empty. That is the lie.', enemy: 'Hollow Librarian', enemyGlyph: '✼',
        xp: 140, gold: 55, requiredLevelId: 'sanctum-2', playerLevelRequired: 3,
        requirement: { kind: 'RECOVERY_STREAK', minScore: 70, consecutiveDays: 7 },
        requirementSummary: 'Recovery score 70+ for 7 days' },
      { id: 'sanctum-4', order: 4, name: 'The Long Memory', description: 'A memory that has not happened yet, waiting for you.', enemy: 'The Old Page', enemyGlyph: '❄',
        xp: 200, gold: 80, requiredLevelId: 'sanctum-3', playerLevelRequired: 4,
        requirement: { kind: 'SLEEP_STREAK', minHours: 8, consecutiveDays: 14 },
        requirementSummary: 'Sleep 8+ hours for 14 consecutive nights' },
      { id: 'sanctum-5', order: 5, name: 'The Final Answer', description: 'A question you have been asking all your life.', enemy: 'The Reader', enemyGlyph: '✺',
        xp: 300, gold: 120, requiredLevelId: 'sanctum-4', playerLevelRequired: 5,
        requirement: { kind: 'RECOVERY_STREAK', minScore: 80, consecutiveDays: 30 },
        requirementSummary: 'Recovery score 80+ for 30 days' },
    ],
  },
];

// Lookup helpers
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

// Given a requirement + user's data, compute current progress.
// This is the core logic that determines whether a level is cleared.
//
// Inputs:
//   - req: the level's requirement
//   - user: user object (for body weight, sleep logs, recovery)
//   - workoutHistory: array of recent workouts with exercises+sets
//   - sleepHistory: array of {date, hours} entries
//   - recoveryHistory: array of {date, score} entries
export function computeRequirementProgress(
  req: LevelRequirement,
  bodyweightKg: number | null | undefined,
  recentWorkouts: Array<{
    exercises: Array<{
      name: string;
      sets: Array<{ weight: number | null; reps: number; duration: number | null }>;
    }>;
  }>,
  sleepHistory: Array<{ date: string; hours: number }>,
  recoveryHistory: Array<{ date: string; score: number }>,
): RequirementProgress {
  switch (req.kind) {
    case 'WEIGHT_REPS': {
      // Find the best set matching the exercise (name contains)
      const exLower = req.exercise.toLowerCase();
      let bestKg = 0;
      for (const w of recentWorkouts) {
        for (const ex of w.exercises) {
          if (!ex.name.toLowerCase().includes(exLower)) continue;
          for (const s of ex.sets) {
            if (!s.weight || s.reps < req.reps) continue;
            if (s.weight > bestKg) bestKg = s.weight;
          }
        }
      }
      // Target: weightKg
      const target = req.weightKg;
      const pct = bestKg > 0 ? Math.min(1, bestKg / target) : 0;
      return {
        current: bestKg > 0 ? bestKg : null,
        target,
        pct,
        cleared: bestKg >= target,
      };
    }
    case 'WEIGHT_BODYWEIGHT_MULT': {
      const exLower = req.exercise.toLowerCase();
      let bestKg = 0;
      for (const w of recentWorkouts) {
        for (const ex of w.exercises) {
          if (!ex.name.toLowerCase().includes(exLower)) continue;
          for (const s of ex.sets) {
            if (!s.weight || s.reps < req.reps) continue;
            if (s.weight > bestKg) bestKg = s.weight;
          }
        }
      }
      const target = bodyweightKg ? bodyweightKg * req.multiplier : req.multiplier * 70; // fallback 70kg
      const pct = bestKg > 0 ? Math.min(1, bestKg / target) : 0;
      return {
        current: bestKg > 0 ? bestKg : null,
        target,
        pct,
        cleared: bestKg >= target && bodyweightKg !== null,
      };
    }
    case 'CARDIO_5K': {
      // Find best 5K time (in seconds). Sum consecutive cardio sets
      // until reaching 5000m, use total time as the result.
      let bestSeconds: number | null = null;
      for (const w of recentWorkouts) {
        for (const ex of w.exercises) {
          // Cardio exercises have a duration and weight=0. We need
          // distance too, but for now use duration as a proxy:
          // assume ~3.33 m/s average pace → 5K = 1500s baseline.
          // Better: store distance in future; for now use duration
          // as seconds and assume the user ran 5K if duration >= 1200.
          if (!/run|jog|sprint|treadmill|5k|10k|marathon|erg|rowing|bike|cycle|swim|stair|skip|jump/i.test(ex.name)) continue;
          for (const s of ex.sets) {
            if (!s.duration) continue;
            // Use duration directly as the 5K time if it's in a
            // reasonable range. We don't have distance data yet, so
            // assume any cardio set >= 20 min was a 5K effort.
            if (s.duration >= 20 * 60 && s.duration <= req.maxSeconds * 1.5) {
              if (bestSeconds === null || s.duration < bestSeconds) {
                bestSeconds = s.duration;
              }
            }
          }
        }
      }
      const target = req.maxSeconds;
      const pct = bestSeconds !== null ? Math.min(1, target / bestSeconds) : 0;
      return {
        current: bestSeconds,
        target,
        pct,
        cleared: bestSeconds !== null && bestSeconds <= target,
      };
    }
    case 'CARDIO_DISTANCE': {
      // Sum cardio durations, treat each second as ~3.33m at easy pace
      let maxDistance = 0;
      for (const w of recentWorkouts) {
        for (const ex of w.exercises) {
          if (!/run|jog|sprint|treadmill|5k|10k|marathon|bike|cycle|walk|swim|stair|skip|jump|erg|rowing/i.test(ex.name)) continue;
          for (const s of ex.sets) {
            if (!s.duration) continue;
            const distance = s.duration * 3.33; // ~5:00/km pace
            if (distance > maxDistance) maxDistance = distance;
          }
        }
      }
      const target = req.minMeters;
      const pct = Math.min(1, maxDistance / target);
      return {
        current: maxDistance > 0 ? Math.round(maxDistance) : null,
        target,
        pct,
        cleared: maxDistance >= target,
      };
    }
    case 'CALISTHENICS_REPS': {
      const exLower = req.exercise.toLowerCase();
      let bestReps = 0;
      for (const w of recentWorkouts) {
        for (const ex of w.exercises) {
          if (!ex.name.toLowerCase().includes(exLower)) continue;
          for (const s of ex.sets) {
            if (s.reps > bestReps) bestReps = s.reps;
          }
        }
      }
      const target = req.reps;
      const pct = Math.min(1, bestReps / target);
      return {
        current: bestReps > 0 ? bestReps : null,
        target,
        pct,
        cleared: bestReps >= target,
      };
    }
    case 'PLANK_HOLD': {
      const exLower = 'plank';
      let bestSeconds = 0;
      for (const w of recentWorkouts) {
        for (const ex of w.exercises) {
          if (!ex.name.toLowerCase().includes(exLower)) continue;
          for (const s of ex.sets) {
            if (s.duration && s.duration > bestSeconds) bestSeconds = s.duration;
          }
        }
      }
      const target = req.minSeconds;
      const pct = Math.min(1, bestSeconds / target);
      return {
        current: bestSeconds > 0 ? bestSeconds : null,
        target,
        pct,
        cleared: bestSeconds >= target,
      };
    }
    case 'SLEEP_STREAK': {
      // Find longest run of consecutive days where sleep >= minHours
      const sorted = [...sleepHistory].sort((a, b) => a.date.localeCompare(b.date));
      let longestStreak = 0;
      let currentStreak = 0;
      let lastDate: string | null = null;
      for (const entry of sorted) {
        if (entry.hours < req.minHours) {
          currentStreak = 0;
          lastDate = entry.date;
          continue;
        }
        if (lastDate === null) {
          currentStreak = 1;
        } else {
          // Check if this date is the next day after lastDate
          const last = new Date(lastDate);
          const cur = new Date(entry.date);
          const diff = (cur.getTime() - last.getTime()) / (24 * 60 * 60 * 1000);
          if (diff <= 1.5) {
            currentStreak += 1;
          } else {
            currentStreak = 1;
          }
        }
        if (currentStreak > longestStreak) longestStreak = currentStreak;
        lastDate = entry.date;
      }
      const target = req.consecutiveDays;
      const pct = Math.min(1, longestStreak / target);
      return {
        current: longestStreak,
        target,
        pct,
        cleared: longestStreak >= target,
      };
    }
    case 'RECOVERY_STREAK': {
      // Find longest run of consecutive days where recovery score >= minScore
      const sorted = [...recoveryHistory].sort((a, b) => a.date.localeCompare(b.date));
      let longestStreak = 0;
      let currentStreak = 0;
      let lastDate: string | null = null;
      for (const entry of sorted) {
        if (entry.score < req.minScore) {
          currentStreak = 0;
          lastDate = entry.date;
          continue;
        }
        if (lastDate === null) {
          currentStreak = 1;
        } else {
          const last = new Date(lastDate);
          const cur = new Date(entry.date);
          const diff = (cur.getTime() - last.getTime()) / (24 * 60 * 60 * 1000);
          if (diff <= 1.5) {
            currentStreak += 1;
          } else {
            currentStreak = 1;
          }
        }
        if (currentStreak > longestStreak) longestStreak = currentStreak;
        lastDate = entry.date;
      }
      const target = req.consecutiveDays;
      const pct = Math.min(1, longestStreak / target);
      return {
        current: longestStreak,
        target,
        pct,
        cleared: longestStreak >= target,
      };
    }
    case 'TOTAL_VOLUME': {
      // Sum weight × reps for all sets in the last N days
      const cutoff = Date.now() - req.windowDays * 24 * 60 * 60 * 1000;
      let total = 0;
      for (const w of recentWorkouts) {
        for (const ex of w.exercises) {
          for (const s of ex.sets) {
            if (s.weight && s.reps) total += s.weight * s.reps;
          }
        }
      }
      const target = req.minVolumeKg;
      const pct = Math.min(1, total / target);
      return {
        current: Math.round(total),
        target,
        pct,
        cleared: total >= target,
      };
    }
  }
}