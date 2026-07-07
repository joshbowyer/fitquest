/**
 * Per-exercise weight + rep plausibility ranges.
 *
 * The blanket cap in flagSuspectSets (500kg) only catches "you typed
 * 1350 instead of 135". Most typo / unit-conversion mistakes land in
 * the 100-400kg range and slip through. This module encodes realistic
 * per-exercise ranges so a Bench Press 600kg 1RM gets flagged
 * (world record is ~355kg) but a Deadlift 400kg 1RM is fine.
 *
 * Three severity tiers:
 *   - 'flag'    : unusual but plausible (intermediate-advanced level).
 *                 Surface as ⚠ on the row; user can dismiss.
 *   - 'block'   : so far beyond any human that it's a typo or unit-
 *                 conversion error. Surface as ⚠ and refuse to mark
 *                 as a PR until the user confirms.
 *   - 'soft'    : within range but on the high side; just a label.
 *
 * Values are in KG. Imperial conversion is `value × 2.20462` at the
 * call site. Ranges assume a SERIOUS recreational lifter — elite
 * powerlifters will still get flagged on the high end, by design.
 * The point is to catch mistakes, not to score lifters.
 */

export type LimitSeverity = 'soft' | 'flag' | 'block';

export type ExerciseLimit = {
  /** Effective-load fraction for the bodyweight exercise, applied
   *  to user.weightKg when computing the per-rep bodyweight volume.
   *  Mirrors BODYWEIGHT_COEFFICIENTS in exerciseVolume.ts. */
  bodyweightCoefficient?: number;
  /** 1RM (Epley) in kg that triggers 'flag'. Above is unusual. */
  flagOneRmKg: number;
  /** 1RM (Epley) in kg that triggers 'block'. Above is a typo. */
  blockOneRmKg: number;
  /** Per-set weight in kg that triggers 'block' regardless of reps.
   *  Used for static holds + bodyweight movements where 1RM math
   *  doesn't apply (planks, l-sits) — expressed as multiplier of
   *  bodyweight when set, else ignored. */
  bodyweightMultiplierBlock?: number;
  /** Cap on reps in a single set. Past this is almost certainly a
   *  typo or a half-logged warmup chain. */
  maxReps: number;
};

/**
 * Master table. Add new exercises here as needed; unknown exercises
 * fall back to the DEFAULT entry below.
 *
 * Sources: openpowerlifting.org / Symmetric Strength / ExRx archives
 * for elite amateur thresholds. Calibrated to flag roughly the top
 * 0.1% of natural lifters as "unusual" without being annoying.
 */
export const EXERCISE_LIMITS: Record<string, ExerciseLimit> = {
  // ---- Big lifts ----
  'Bench Press':          { flagOneRmKg: 250, blockOneRmKg: 400, maxReps: 60 },
  'Bench':                { flagOneRmKg: 250, blockOneRmKg: 400, maxReps: 60 },
  'Squat':                { flagOneRmKg: 350, blockOneRmKg: 500, maxReps: 60 },
  'Back Squat':           { flagOneRmKg: 350, blockOneRmKg: 500, maxReps: 60 },
  'Front Squat':          { flagOneRmKg: 280, blockOneRmKg: 400, maxReps: 50 },
  'Deadlift':             { flagOneRmKg: 400, blockOneRmKg: 550, maxReps: 30 },
  'Conventional Deadlift': { flagOneRmKg: 400, blockOneRmKg: 550, maxReps: 30 },
  'Sumo Deadlift':        { flagOneRmKg: 400, blockOneRmKg: 550, maxReps: 30 },
  'Romanian Deadlift':    { flagOneRmKg: 300, blockOneRmKg: 450, maxReps: 30 },
  'Overhead Press':       { flagOneRmKg: 175, blockOneRmKg: 280, maxReps: 50 },
  'OHP':                  { flagOneRmKg: 175, blockOneRmKg: 280, maxReps: 50 },
  'Barbell Row':          { flagOneRmKg: 220, blockOneRmKg: 320, maxReps: 50 },

  // ---- Olympic lifts ----
  'Snatch':               { flagOneRmKg: 200, blockOneRmKg: 320, maxReps: 10 },
  'Clean & Jerk':         { flagOneRmKg: 220, blockOneRmKg: 350, maxReps: 10 },

  // ---- Calisthenics weighted (assume total weight stored = body + belt) ----
  'Weighted Pull-Up':     { flagOneRmKg: 175, blockOneRmKg: 250, maxReps: 30 },
  'Weighted Pull-Ups':    { flagOneRmKg: 175, blockOneRmKg: 250, maxReps: 30 },
  'Weighted Chin-Up':     { flagOneRmKg: 175, blockOneRmKg: 250, maxReps: 30 },
  'Weighted Chin-Ups':    { flagOneRmKg: 175, blockOneRmKg: 250, maxReps: 30 },
  'Weighted Dip':         { flagOneRmKg: 200, blockOneRmKg: 280, maxReps: 30 },
  'Weighted Dips':        { flagOneRmKg: 200, blockOneRmKg: 280, maxReps: 30 },
  'Weighted Push-Up':     { flagOneRmKg: 175, blockOneRmKg: 250, maxReps: 50 },
  'Weighted Push-Ups':    { flagOneRmKg: 175, blockOneRmKg: 250, maxReps: 50 },

  // ---- Bodyweight calisthenics (use bodyweight coefficient) ----
  'Pull-Up':              { bodyweightCoefficient: 1.0,  flagOneRmKg: 200, blockOneRmKg: 300, maxReps: 100 },
  'Pull-Ups':             { bodyweightCoefficient: 1.0,  flagOneRmKg: 200, blockOneRmKg: 300, maxReps: 100 },
  'Chin-Up':              { bodyweightCoefficient: 1.0,  flagOneRmKg: 200, blockOneRmKg: 300, maxReps: 100 },
  'Chin-Ups':             { bodyweightCoefficient: 1.0,  flagOneRmKg: 200, blockOneRmKg: 300, maxReps: 100 },
  'Push-Up':              { bodyweightCoefficient: 0.64, flagOneRmKg: 130, blockOneRmKg: 200, maxReps: 200 },
  'Push-Ups':             { bodyweightCoefficient: 0.64, flagOneRmKg: 130, blockOneRmKg: 200, maxReps: 200 },
  'Pushup':               { bodyweightCoefficient: 0.64, flagOneRmKg: 130, blockOneRmKg: 200, maxReps: 200 },
  'Pushups':              { bodyweightCoefficient: 0.64, flagOneRmKg: 130, blockOneRmKg: 200, maxReps: 200 },
  'Dip':                  { bodyweightCoefficient: 0.85, flagOneRmKg: 175, blockOneRmKg: 260, maxReps: 100 },
  'Dips':                 { bodyweightCoefficient: 0.85, flagOneRmKg: 175, blockOneRmKg: 260, maxReps: 100 },
  'Bodyweight Squat':     { bodyweightCoefficient: 0.7,  flagOneRmKg: 175, blockOneRmKg: 260, maxReps: 100 },
  'Air Squat':            { bodyweightCoefficient: 0.7,  flagOneRmKg: 175, blockOneRmKg: 260, maxReps: 100 },
  'Pistol Squat':         { bodyweightCoefficient: 0.9,  flagOneRmKg: 130, blockOneRmKg: 200, maxReps: 50 },
  'Inverted Row':         { bodyweightCoefficient: 0.6,  flagOneRmKg: 80,  blockOneRmKg: 130, maxReps: 50 },
  'Aussie Pull-Up':       { bodyweightCoefficient: 0.7,  flagOneRmKg: 130, blockOneRmKg: 200, maxReps: 50 },
  'Nordic Curl':          { bodyweightCoefficient: 0.85, flagOneRmKg: 100, blockOneRmKg: 150, maxReps: 30 },
  'Single Leg RDL':       { flagOneRmKg: 100, blockOneRmKg: 200, maxReps: 30 },
  'Glute Bridge':         { bodyweightCoefficient: 0.65, flagOneRmKg: 130, blockOneRmKg: 200, maxReps: 50 },

  // ---- Static holds (use duration, not 1RM) ----
  'Plank':                { bodyweightCoefficient: 0.5,  flagOneRmKg: 9998, blockOneRmKg: 9999, maxReps: 1, bodyweightMultiplierBlock: 1.0 },
  'L-Sit':                { bodyweightCoefficient: 0.6,  flagOneRmKg: 9998, blockOneRmKg: 9999, maxReps: 1, bodyweightMultiplierBlock: 1.0 },
  'Side Plank':           { bodyweightCoefficient: 0.5,  flagOneRmKg: 9998, blockOneRmKg: 9999, maxReps: 1, bodyweightMultiplierBlock: 1.0 },
  'Dead Hang':            { bodyweightCoefficient: 1.0,  flagOneRmKg: 9998, blockOneRmKg: 9999, maxReps: 1, bodyweightMultiplierBlock: 1.0 },
};

/**
 * Default for any exercise not in the table above. Conservative so
 * we err on the side of flagging unknown exercises — better to nag
 * about a typo than to silently accept nonsense.
 */
const DEFAULT_LIMIT: ExerciseLimit = {
  flagOneRmKg: 300,
  blockOneRmKg: 500,
  maxReps: 100,
};

/**
 * Look up the limit for an exercise name (case-insensitive, ignores
 * surrounding whitespace + a trailing 's' for plurals).
 */
export function getExerciseLimit(exerciseName: string): ExerciseLimit {
  const key = exerciseName.toLowerCase().trim();
  // Exact match first
  for (const [name, limit] of Object.entries(EXERCISE_LIMITS)) {
    if (name.toLowerCase() === key) return limit;
  }
  // Plural-tolerant lookup
  const singular = key.endsWith('s') ? key.slice(0, -1) : key;
  const plural = key.endsWith('s') ? key : key + 's';
  for (const [name, limit] of Object.entries(EXERCISE_LIMITS)) {
    const nl = name.toLowerCase();
    if (nl === singular || nl === plural) return limit;
  }
  return DEFAULT_LIMIT;
}

/**
 * Plausibility verdict for one set. Used by both the workout-commit
 * validityFlags (server) and the ActivityDetail row ⚠ chip (client).
 */
export type PlausibilityResult = {
  severity: LimitSeverity | null;
  /** Short human reason ("above 250kg 1RM range for Bench Press"). */
  reason: string | null;
  /** 1RM-equivalent in kg that triggered the flag, if any. */
  oneRmKg: number | null;
};

/**
 * Epley 1RM in kg for a single set.
 */
export function epley1Rm(weightKg: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

export function checkSetPlausibility(
  exerciseName: string,
  weightKg: number,
  reps: number,
  userWeightKg: number = 0,
): PlausibilityResult {
  const limit = getExerciseLimit(exerciseName);
  // Rep cap first — easy check, applies to everything.
  if (reps > limit.maxReps) {
    return {
      severity: 'block',
      reason: `${reps} reps exceeds ${limit.maxReps}-rep cap for ${exerciseName}`,
      oneRmKg: null,
    };
  }
  // Static holds (plank, l-sit) — block on absurd bodyweight.
  if (limit.bodyweightMultiplierBlock != null && weightKg > 0 && userWeightKg > 0) {
    const limitKg = userWeightKg * limit.bodyweightMultiplierBlock;
    if (weightKg > limitKg * 3) {
      return {
        severity: 'block',
        reason: `${weightKg.toFixed(1)} kg looks too heavy for a ${exerciseName} hold (you weigh ${userWeightKg.toFixed(1)} kg)`,
        oneRmKg: null,
      };
    }
  }
  // 1RM check via Epley.
  const oneRm = epley1Rm(weightKg, reps);
  if (oneRm > limit.blockOneRmKg) {
    return {
      severity: 'block',
      reason: `${oneRm.toFixed(1)} kg 1RM exceeds the ${limit.blockOneRmKg} kg ceiling for ${exerciseName} (world-class is ~${(limit.blockOneRmKg * 0.85).toFixed(0)} kg)`,
      oneRmKg: oneRm,
    };
  }
  if (oneRm > limit.flagOneRmKg) {
    return {
      severity: 'flag',
      reason: `${oneRm.toFixed(1)} kg 1RM is unusually high for ${exerciseName} (advanced recreational threshold ${limit.flagOneRmKg} kg)`,
      oneRmKg: oneRm,
    };
  }
  return { severity: null, reason: null, oneRmKg: null };
}
