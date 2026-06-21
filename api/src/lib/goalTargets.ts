/**
 * Goal-derived daily targets.
 *
 * Source of truth for the calorie/protein/water numbers shown on
 * /nutrition. All three are computed from:
 *   - User.goal            (CUT / MAINTAIN / BULK)
 *   - User.calorieBaseline (user-set TDEE-ish, default 2200)
 *   - User.weightKg        (drives water + protein floors)
 *
 * Conservative ±250 cal/day offset for cut/bulk. The user can
 * override any of these individually via /settings, but the
 * derived values are the default.
 */

import { CalorieGoal } from '@prisma/client';

export type GoalTargets = {
  goal: CalorieGoal;
  calorieBaseline: number;
  calorieGoal: number;
  calorieDelta: number; // signed: -250, 0, +250
  proteinGoalG: number;
  waterGoalMl: number;
};

const GOAL_OFFSET: Record<CalorieGoal, number> = {
  CUT: -250,
  MAINTAIN: 0,
  BULK: +250,
};

/**
 * Protein target: g of protein per kcal of goal calories.
 * Tuned so that:
 *   - bulk at 2200 cal → 150 g (0.068 g/kcal)
 *   - cut at 1950 cal  → 150 g (0.077 g/kcal)
 *   - maint at 2200    → 141 g (0.064 g/kcal)
 * "Err on the high side" of the literature ranges: cut is highest
 * per-calorie (muscle preservation), then maintain, then bulk
 * (calories are abundant so a bit less protein is fine).
 */
const PROTEIN_RATIO: Record<CalorieGoal, number> = {
  CUT: 0.077,
  MAINTAIN: 0.064,
  BULK: 0.068,
};

/// Water intake: ~35 ml/kg bodyweight is the standard recommendation
/// for sedentary adults. Active users benefit from more.
const WATER_ML_PER_KG = 35;

export function computeGoalTargets(input: {
  goal: CalorieGoal;
  calorieBaseline: number;
  weightKg: number | null;
}): GoalTargets {
  const calorieDelta = GOAL_OFFSET[input.goal];
  const calorieGoal = Math.max(1000, input.calorieBaseline + calorieDelta);
  const proteinGoalG = Math.round(calorieGoal * PROTEIN_RATIO[input.goal]);
  const waterGoalMl = input.weightKg
    ? Math.round(input.weightKg * WATER_ML_PER_KG)
    : 2500; // fallback if no weight on file
  return {
    goal: input.goal,
    calorieBaseline: input.calorieBaseline,
    calorieGoal,
    calorieDelta,
    proteinGoalG,
    waterGoalMl,
  };
}
