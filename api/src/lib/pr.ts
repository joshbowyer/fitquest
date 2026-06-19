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
