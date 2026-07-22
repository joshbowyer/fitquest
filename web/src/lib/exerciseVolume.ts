/**
 * Bodyweight-aware set volume — mirror of `api/src/lib/exerciseVolume.ts`.
 *
 * Keep both files in sync. The frontend uses this for chart numbers on
 * the Activities page + ActivityDetail, the backend uses its copy for
 * weekly-volume aggregation, morning-report workouts domain, plateau
 * detector, and workout commit (XP / raid damage inputs).
 */

export const BODYWEIGHT_COEFFICIENTS: Record<string, number> = {
  pushup: 0.64,
  'push-up': 0.64,
  pushups: 0.64,
  'push-ups': 0.64,
  dip: 0.85,
  dips: 0.85,
  'weighted dip': 1.0,
  pullup: 1.0,
  'pull-up': 1.0,
  pullups: 1.0,
  'pull-ups': 1.0,
  chinup: 1.0,
  'chin-up': 1.0,
  chinups: 1.0,
  'weighted pullup': 1.0,
  'weighted pull-up': 1.0,
  squat: 0.7,
  'bodyweight squat': 0.7,
  'air squat': 0.7,
  'pistol squat': 0.9,
  'pistol-squat': 0.9,
  'jump squat': 1.2,
  'inverted row': 0.6,
  'inverted-row': 0.6,
  'aussie pullup': 0.7,
  'aussie pull-up': 0.7,
  plank: 0.5,
  'l-sit': 0.6,
  'side plank': 0.5,
  'muscle-up': 1.0,
  'muscle up': 1.0,
  burpee: 0.7,
  'mountain climber': 0.4,
  'nordic curl': 0.85,
  'nordic-curl': 0.85,
  'glute bridge': 0.65,
  'single-leg rdl': 0.55,
  'single leg rdl': 0.55,
  'planche push-up': 1.0,
  'planche push-ups': 1.0,
  'weighted planche push-up': 1.0,
  'weighted planche push-ups': 1.0,
};

export function isBodyweightSet(set: { weight: number | null | undefined }, userWeightKg: number): boolean {
  if (set.weight == null) return false;
  if (set.weight === 0) return true;
  if (userWeightKg > 0 && Math.abs(set.weight - userWeightKg) <= 2) return true;
  return false;
}

export function bodyweightCoefficient(exerciseName: string): number {
  const key = exerciseName.toLowerCase().trim();
  return BODYWEIGHT_COEFFICIENTS[key] ?? 0.65;
}

export function setVolumeKg(
  set: { weight: number | null | undefined; reps: number | null | undefined },
  exerciseName: string,
  userWeightKg: number,
): number {
  const reps = set.reps || 0;
  if (set.weight == null || reps <= 0) return 0;
  if (!isBodyweightSet(set, userWeightKg)) {
    return set.weight * reps;
  }
  return userWeightKg * bodyweightCoefficient(exerciseName) * reps;
}
