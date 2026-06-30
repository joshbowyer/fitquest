/**
 * Convert a raw set (reps + weight) to an estimated 1RM using Epley's formula:
 *   1RM = weight * (1 + reps/30)
 * For reps=1, returns weight directly.
 */
export function estimateOneRm(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/**
 * Brzycki formula alternative, sometimes preferred for low-rep sets:
 *   1RM = weight * 36 / (37 - reps)
 */
export function brzyckiOneRm(weight: number, reps: number): number {
  if (reps <= 0 || reps >= 37) return weight;
  return (weight * 36) / (37 - reps);
}

export function bestEstimatedOneRm(weight: number, reps: number): number {
  // Epley is more conservative; use it as the default.
  return estimateOneRm(weight, reps);
}

export function isPrCandidate(
  exercise: string,
  newValue: number,
  previousBest: number | null | undefined,
): boolean {
  if (previousBest == null) return newValue > 0;
  return newValue > previousBest;
}

// ---- Static-hold PR detection (Plank, L-Sit, Dead Hang, etc.) ----
//
// These exercises don't fit the weight*reps 1RM model — you hang
// from a bar with bodyweight on, time how long you last, and that's
// the PR. Detection mirrors the ONE_RM loop but picks the longest
// completed set (by `duration` in seconds) and creates a PrType=HOLD
// record instead of PrType=ONE_RM.
//
// Both ONE_RM and HOLD PRs can coexist for the same exercise (e.g.
// someday someone does a weighted dead hang for reps — we'd want the
// 1RM AND the bodyweight-only duration as separate PRs).

/**
 * Exercises whose PR is measured in duration (seconds) rather than
 * weight×reps. Mirrors the static-hold list in exerciseLimits.ts —
 * kept in sync by name. Lookup is case-insensitive + plural-tolerant
 * because the workout form accepts both 'Dead Hang' and 'Dead Hangs'.
 */
const STATIC_HOLD_NAMES = new Set([
  'plank', 'side plank', 'l-sit', 'dead hang', 'deadhang',
  'front lever', 'back lever', 'tuck planche',
]);

export function isStaticHoldExercise(exercise: string): boolean {
  const key = exercise.toLowerCase().trim();
  if (STATIC_HOLD_NAMES.has(key)) return true;
  // Plural-tolerant ('Dead Hangs', 'Planks', etc.)
  const singular = key.endsWith('s') ? key.slice(0, -1) : key;
  return STATIC_HOLD_NAMES.has(singular);
}

/**
 * Find the longest completed set for a static-hold exercise.
 * Returns duration in seconds, or null if no completed hold found.
 */
export function bestHoldDurationSec(
  sets: Array<{ duration?: number | null; completed?: boolean; skipped?: boolean }>,
): number | null {
  let best: number | null = null;
  for (const s of sets) {
    if (!s.completed || s.skipped) continue;
    const d = s.duration ?? 0;
    if (d <= 0) continue;
    if (best == null || d > best) best = d;
  }
  return best;
}
