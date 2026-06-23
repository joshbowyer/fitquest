/**
 * Bodyweight-aware set volume.
 *
 * For weighted exercises, set volume = weight × reps (the textbook
 * definition). For bodyweight exercises, the user's body is the load
 * but NOT every bodyweight exercise moves 100% of bodyweight —
 * pushups load roughly 64% (Beachle & Earle 2008; EMG studies),
 * dips ~85% (more upright), pullups ~100% (full hang), etc.
 *
 * Without this correction, a 60kg user doing 20 pushups would log
 * 1200kg of volume — overstating actual mechanical work compared to
 * a 60kg squat at the same reps. The coefficient map below encodes
 * the effective-load fraction per exercise so the volume tally is
 * comparable across calisthenics + weighted work.
 *
 * Pure functions only. Mirrored client-side in
 * `web/src/lib/exerciseVolume.ts` so chart numbers match the backend
 * computation (the workout commit + insight generation).
 */

/**
 * Effective-load fraction per bodyweight exercise. Keys are
 * case-insensitive normalized exercise names. Values are 0..1
 * multipliers applied to the user's body weight to compute the
 * "effective weight" the muscle actually loaded.
 *
 * Sources (approximate; ±5%):
 *  - Pushup ~0.64: Beachle & Earle 2008, Ebben et al. 2011
 *  - Dip ~0.85: assumed similar to pushup but more upright
 *  - Pullup / Chinup ~1.0: full hang, full bodyweight lift
 *  - Pistol squat ~0.9: one leg carries the full body
 *  - Squat (unweighted) ~0.7: eccentric/concentric loading depends
 *    on depth; 0.7 is a reasonable mid-range estimate
 *  - Inverted row ~0.6: depends on body angle; 0.6 at horizontal
 *  - Plank / L-sit ~0.5-0.6: static holds — not pure loading
 *
 * Default for unknown bodyweight exercises: 0.65. Conservative
 * middle-of-the-road value that won't wildly inflate calisthenics
 * volume while still crediting the work.
 */
export const BODYWEIGHT_COEFFICIENTS: Record<string, number> = {
  // Pushup variants
  pushup: 0.64,
  'push-up': 0.64,
  pushups: 0.64,
  'push-ups': 0.64,
  // Dip variants
  dip: 0.85,
  dips: 0.85,
  'weighted dip': 1.0,
  // Pull/chin-up variants
  pullup: 1.0,
  'pull-up': 1.0,
  pullups: 1.0,
  'pull-ups': 1.0,
  chinup: 1.0,
  'chin-up': 1.0,
  chinups: 1.0,
  'weighted pullup': 1.0,
  'weighted pull-up': 1.0,
  // Squat variants
  squat: 0.7,
  'bodyweight squat': 0.7,
  'air squat': 0.7,
  'pistol squat': 0.9,
  'pistol-squat': 0.9,
  'jump squat': 1.2,
  // Row/pull variants
  'inverted row': 0.6,
  'inverted-row': 0.6,
  'aussie pullup': 0.7,
  'aussie pull-up': 0.7,
  // Static holds
  plank: 0.5,
  'l-sit': 0.6,
  'side plank': 0.5,
  // Misc
  'muscle-up': 1.0,
  'muscle up': 1.0,
  burpee: 0.7,
  'mountain climber': 0.4,
  // Hamstring-loaded calisthenics
  'nordic curl': 0.85,
  'nordic-curl': 0.85,
  'glute bridge': 0.65,
  'single-leg rdl': 0.55,
  'single leg rdl': 0.55,
};

/**
 * True if a set looks like a bodyweight exercise: weight is 0 OR
 * matches the user's current weight within a 2kg tolerance (so a user
 * who manually entered 60.8kg for pushups still gets the coefficient).
 * Weighted variations (vest, belt) tip the scale above 2kg and fall
 * back to straight weight × reps.
 */
export function isBodyweightSet(
  set: { weight?: number | null },
  userWeightKg: number,
): boolean {
  if (set.weight == null) return false;
  if (set.weight === 0) return true;
  if (userWeightKg > 0 && Math.abs(set.weight - userWeightKg) <= 2) return true;
  return false;
}

/**
 * Look up the effective-load coefficient for a bodyweight exercise.
 * Returns 0.65 as a safe default for unknown exercises.
 */
export function bodyweightCoefficient(exerciseName: string): number {
  const key = exerciseName.toLowerCase().trim();
  return BODYWEIGHT_COEFFICIENTS[key] ?? 0.65;
}

/**
 * Effective volume contribution of a single set, accounting for
 * bodyweight-exercise coefficients. Returns 0 for skipped/invalid
 * sets (no weight or no reps).
 *
 * @param set  { weight, reps, ... } — Set row fields we need
 * @param exerciseName  used for coefficient lookup when set is bodyweight
 * @param userWeightKg  the user's current body weight (kg); 0 if unknown
 */
export function setVolumeKg(
  set: { weight?: number | null; reps?: number | null },
  exerciseName: string,
  userWeightKg: number,
): number {
  const reps = set.reps ?? 0;
  if (set.weight == null || reps <= 0) return 0;
  if (!isBodyweightSet(set, userWeightKg)) {
    return set.weight * reps;
  }
  return userWeightKg * bodyweightCoefficient(exerciseName) * reps;
}
