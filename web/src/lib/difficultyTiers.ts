/**
 * Daily difficulty tiers — mirrors Habitica's todo weight system. Users
 * pick a tier (Trivial → Epic) instead of typing raw gold/xp. The tier
 * maps to a fixed (gold, xp) reward that we display in the UI.
 *
 * Shared between /today (general dailies) and /spiritual (spiritual
 * practices) so the weight system is consistent across the app.
 */

export type DifficultyTier = {
  key: 'TRIVIAL' | 'EASY' | 'MEDIUM' | 'HARD' | 'EPIC';
  label: string;
  gold: number;
  xp: number;
  hint: string;
  color: string;
};

export const DIFFICULTY_TIERS: DifficultyTier[] = [
  { key: 'TRIVIAL', label: 'Trivial', gold: 1,  xp: 1,   hint: 'A short moment of grace',          color: '#a8a8b8' },
  { key: 'EASY',    label: 'Easy',    gold: 5,  xp: 5,   hint: 'Brief, like 5 minutes of prayer', color: '#9bff5c' },
  { key: 'MEDIUM',  label: 'Medium',  gold: 15, xp: 20,  hint: 'A focused effort',                 color: '#14d6e8' },
  { key: 'HARD',    label: 'Hard',    gold: 35, xp: 50,  hint: 'A meaningful sacrifice or service', color: '#ffc34d' },
  { key: 'EPIC',    label: 'Epic',    gold: 80, xp: 120, hint: 'A real commitment',               color: '#c45cff' },
];

/**
 * Find the closest tier for an existing (gold, xp) pair. Used when
 * editing an old daily whose rewards were set as raw values before
 * the tier system existed.
 */
export function tierForRewards(gold: number, xp: number): DifficultyTier {
  let best = DIFFICULTY_TIERS[0];
  let bestDist = Infinity;
  for (const t of DIFFICULTY_TIERS) {
    const d = Math.abs(t.gold - gold) + Math.abs(t.xp - xp);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}