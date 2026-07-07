/**
 * Bodyweight-aware set volume + per-exercise plausibility — mirrors
 * of `api/src/lib/exerciseVolume.ts` + `api/src/lib/exerciseLimits.ts`.
 * Keep both files in sync. Used by ActivityDetail to surface ⚠ chips
 * on suspicious PRs / set values.
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

/**
 * Per-exercise plausibility — mirrors the api/src/lib/exerciseLimits.ts
 * table so the ActivityDetail ⚠ chip renders the same verdict the
 * server's validityFlags would.
 */

export type LimitSeverity = 'soft' | 'flag' | 'block';

export type ExerciseLimit = {
  bodyweightCoefficient?: number;
  flagOneRmKg: number;
  blockOneRmKg: number;
  bodyweightMultiplierBlock?: number;
  maxReps: number;
};

export const EXERCISE_LIMITS: Record<string, ExerciseLimit> = {
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
  'Snatch':               { flagOneRmKg: 200, blockOneRmKg: 320, maxReps: 10 },
  'Clean & Jerk':         { flagOneRmKg: 220, blockOneRmKg: 350, maxReps: 10 },
  'Weighted Pull-Up':     { flagOneRmKg: 175, blockOneRmKg: 250, maxReps: 30 },
  'Weighted Pull-Ups':    { flagOneRmKg: 175, blockOneRmKg: 250, maxReps: 30 },
  'Weighted Chin-Up':     { flagOneRmKg: 175, blockOneRmKg: 250, maxReps: 30 },
  'Weighted Chin-Ups':    { flagOneRmKg: 175, blockOneRmKg: 250, maxReps: 30 },
  'Weighted Dip':         { flagOneRmKg: 200, blockOneRmKg: 280, maxReps: 30 },
  'Weighted Dips':        { flagOneRmKg: 200, blockOneRmKg: 280, maxReps: 30 },
  'Weighted Push-Up':     { flagOneRmKg: 175, blockOneRmKg: 250, maxReps: 50 },
  'Weighted Push-Ups':    { flagOneRmKg: 175, blockOneRmKg: 250, maxReps: 50 },
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
  'Plank':                { bodyweightCoefficient: 0.5,  flagOneRmKg: 9998, blockOneRmKg: 9999, maxReps: 1, bodyweightMultiplierBlock: 1.0 },
  'L-Sit':                { bodyweightCoefficient: 0.6,  flagOneRmKg: 9998, blockOneRmKg: 9999, maxReps: 1, bodyweightMultiplierBlock: 1.0 },
  'Side Plank':           { bodyweightCoefficient: 0.5,  flagOneRmKg: 9998, blockOneRmKg: 9999, maxReps: 1, bodyweightMultiplierBlock: 1.0 },
};

const DEFAULT_LIMIT: ExerciseLimit = {
  flagOneRmKg: 300,
  blockOneRmKg: 500,
  maxReps: 100,
};

export function getExerciseLimit(exerciseName: string): ExerciseLimit {
  const key = exerciseName.toLowerCase().trim();
  for (const [name, limit] of Object.entries(EXERCISE_LIMITS)) {
    if (name.toLowerCase() === key) return limit;
  }
  const singular = key.endsWith('s') ? key.slice(0, -1) : key;
  const plural = key.endsWith('s') ? key : key + 's';
  for (const [name, limit] of Object.entries(EXERCISE_LIMITS)) {
    const nl = name.toLowerCase();
    if (nl === singular || nl === plural) return limit;
  }
  return DEFAULT_LIMIT;
}

export type PlausibilityResult = {
  severity: LimitSeverity | null;
  reason: string | null;
  oneRmKg: number | null;
};

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
  if (reps > limit.maxReps) {
    return {
      severity: 'block',
      reason: `${reps} reps exceeds ${limit.maxReps}-rep cap for ${exerciseName}`,
      oneRmKg: null,
    };
  }
  if (limit.bodyweightMultiplierBlock != null && weightKg > 0 && userWeightKg > 0) {
    const limitKg = userWeightKg * limit.bodyweightMultiplierBlock;
    if (weightKg > limitKg * 3) {
      return {
        severity: 'block',
        reason: `${weightKg.toFixed(1)} kg looks too heavy for a ${exerciseName} hold`,
        oneRmKg: null,
      };
    }
  }
  const oneRm = epley1Rm(weightKg, reps);
  if (oneRm > limit.blockOneRmKg) {
    return {
      severity: 'block',
      reason: `${oneRm.toFixed(1)} kg 1RM exceeds the ${limit.blockOneRmKg} kg ceiling for ${exerciseName}`,
      oneRmKg: oneRm,
    };
  }
  if (oneRm > limit.flagOneRmKg) {
    return {
      severity: 'flag',
      reason: `${oneRm.toFixed(1)} kg 1RM is unusually high for ${exerciseName}`,
      oneRmKg: oneRm,
    };
  }
  return { severity: null, reason: null, oneRmKg: null };
}
