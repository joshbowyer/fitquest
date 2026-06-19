/**
 * XP curve: each level requires (level * 100) XP. Soft so level 1→2 needs 100,
 * level 2→3 needs 200, etc. Total XP for level N is N*(N-1)/2 * 100.
 * Caps growth enough to keep late game engaging but reachable.
 */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return ((level - 1) * level) / 2 * 100;
}

export function levelFromXp(xp: number): number {
  // Inverse of xpForLevel. Solving level^2 - level - xp/50 >= 0
  const lvl = Math.floor((1 + Math.sqrt(1 + (xp * 2) / 100)) / 2);
  return Math.max(1, lvl);
}

export function progressInLevel(xp: number, level: number) {
  const currentLevelStart = xpForLevel(level);
  const nextLevelStart = xpForLevel(level + 1);
  const span = nextLevelStart - currentLevelStart;
  const into = xp - currentLevelStart;
  return {
    current: into,
    needed: span,
    pct: Math.max(0, Math.min(1, into / span)),
  };
}

/**
 * XP earned from a workout, scaled by total volume (sum of weight*reps across
 * all completed sets) plus a base participation reward. Calisthenics and
 * cardio use duration and intensity as fallbacks.
 */
export function xpFromWorkout(input: {
  type: 'STRENGTH' | 'HYPERTROPHY' | 'CALISTHENICS' | 'CARDIO' | 'MOBILITY' | 'OTHER';
  totalVolumeKg: number;
  durationMin: number;
  prCount: number;
}): number {
  const base = 20;
  const volumeXp = Math.min(150, Math.round(input.totalVolumeKg / 20));
  const durationXp = Math.min(50, input.durationMin * 0.5);
  const prXp = input.prCount * 25;
  let mult = 1;
  if (input.type === 'STRENGTH' || input.type === 'HYPERTROPHY') mult = 1.1;
  if (input.type === 'CALISTHENICS') mult = 1.0;
  if (input.type === 'CARDIO') mult = 0.9;
  return Math.round((base + volumeXp + durationXp + prXp) * mult);
}

export function goldFromWorkout(input: {
  type: string;
  prCount: number;
  durationMin: number;
}): number {
  return 5 + input.prCount * 10 + Math.floor(input.durationMin / 15);
}
