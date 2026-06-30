/**
 * Skill test validators. Each test has a `metric` and a
 * `threshold`. The user's submitted result must meet the
 * threshold to unlock the skill. This file maps metric strings
 * to the validation logic; the unlock endpoint uses this to
 * confirm the user's submission.
 *
 * Metric types:
 *   - "reps"                — count of bodyweight reps (pushups,
 *                             pullups, jumps, etc.)
 *   - "reps:each"           — count of per-side reps (archer PU,
 *                             one-arm PU, pistol squats)
 *   - "weight:reps"         — barbell-style (weight × reps),
 *                             weight is measured as a multiplier
 *                             of user.bodyweightKg
 *   - "weighted:reps:each"  — weighted calisthenics (e.g. 5
 *                             weighted 1-arm PU @ 25% BW)
 *   - "duration"            — seconds held / timed event
 *   - "distance"            — meters covered
 *   - "rounds"              — AMRAP rounds completed
 *
 * Threshold shape depends on metric:
 *   - reps:           { reps: 20 }
 *   - reps:each:      { reps: 5, sides: "each" }
 *   - weight:reps:    { reps: 5, weight_kg_mult_of_bw: 1.5 }
 *   - weighted:reps:each: { reps: 5, weight_kg_mult_of_bw: 0.25, sides: "each" }
 *   - duration:       { duration_sec: 30 }
 *   - distance:       { distance_m: 5000 }
 *   - rounds:         { rounds: 15 }
 *
 * The user's submitted body is the raw values (reps, weight_kg,
 * duration_sec, etc.) plus the user's bodyweight for the BW
 * calculations. SkillTestResult is normalized so the server
 * doesn't need to know the schema of every metric.
 */

export type SkillTestMetric =
  | 'reps'
  | 'reps:each'
  | 'weight:reps'
  | 'weighted:reps:each'
  | 'duration'
  | 'distance'
  | 'rounds';

export type SkillTestThreshold = {
  reps?: number;
  sides?: 'each' | 'total';
  weight_kg_mult_of_bw?: number;
  duration_sec?: number;
  distance_m?: number;
  rounds?: number;
};

export type SkillTestSpec = {
  description: string;
  safety: string;
  metric: SkillTestMetric;
  threshold: SkillTestThreshold;
};

export type SkillTestResult = {
  ok: boolean;
  /** Human-readable reason the test failed (omitted when ok). */
  reason?: string;
  /** Echoed-back fields the user submitted (for debugging + UI). */
  submitted?: Record<string, number>;
};

/**
 * Run the user's submitted result against the skill's test
 * threshold. Returns a normalized SkillTestResult.
 *
 * The `userBodyweightKg` is mandatory for `weight:reps` and
 * `weighted:reps:each` (we need it to interpret weight_kg as
 * a multiple of bodyweight). For bodyweight metrics the caller
 * can pass 0 or the actual value; it's unused.
 */
export function validateSkillTest(
  spec: SkillTestSpec,
  submitted: Record<string, number | undefined>,
  userBodyweightKg: number,
): SkillTestResult {
  const echo: Record<string, number> = {};
  for (const [k, v] of Object.entries(submitted)) {
    if (typeof v === 'number' && Number.isFinite(v)) echo[k] = v;
  }
  const result: SkillTestResult = { ok: false, submitted: echo };

  switch (spec.metric) {
    case 'reps': {
      const r = Number(submitted.reps ?? NaN);
      const need = spec.threshold.reps ?? 0;
      if (!Number.isFinite(r) || r < need) {
        result.reason = `Need ≥${need} reps`;
        return result;
      }
      result.ok = true;
      return result;
    }
    case 'reps:each': {
      const r = Number(submitted.reps ?? NaN);
      const need = spec.threshold.reps ?? 0;
      if (!Number.isFinite(r) || r < need) {
        result.reason = `Need ≥${need} reps each side`;
        return result;
      }
      result.ok = true;
      return result;
    }
    case 'weight:reps': {
      const r = Number(submitted.reps ?? NaN);
      const w = Number(submitted.weight_kg ?? NaN);
      const needReps = spec.threshold.reps ?? 0;
      const needMult = spec.threshold.weight_kg_mult_of_bw ?? 0;
      if (!userBodyweightKg || userBodyweightKg <= 0) {
        result.reason = 'Set bodyweight in /profile first';
        return result;
      }
      if (!Number.isFinite(r) || r < needReps) {
        result.reason = `Need ≥${needReps} reps`;
        return result;
      }
      if (!Number.isFinite(w)) {
        result.reason = 'Enter weight (kg)';
        return result;
      }
      const mult = w / userBodyweightKg;
      if (mult < needMult) {
        result.reason = `Need ≥${needMult}×BW (you're at ${mult.toFixed(2)}×)`;
        return result;
      }
      result.ok = true;
      return result;
    }
    case 'weighted:reps:each': {
      const r = Number(submitted.reps ?? NaN);
      const w = Number(submitted.weight_kg ?? NaN);
      const needReps = spec.threshold.reps ?? 0;
      const needMult = spec.threshold.weight_kg_mult_of_bw ?? 0;
      if (!userBodyweightKg || userBodyweightKg <= 0) {
        result.reason = 'Set bodyweight in /profile first';
        return result;
      }
      if (!Number.isFinite(r) || r < needReps) {
        result.reason = `Need ≥${needReps} reps each side`;
        return result;
      }
      if (!Number.isFinite(w)) {
        result.reason = 'Enter added weight (kg)';
        return result;
      }
      const mult = w / userBodyweightKg;
      if (mult < needMult) {
        result.reason = `Need ≥${needMult}×BW added (you're at ${mult.toFixed(2)}×)`;
        return result;
      }
      result.ok = true;
      return result;
    }
    case 'duration': {
      const s = Number(submitted.duration_sec ?? NaN);
      const need = spec.threshold.duration_sec ?? 0;
      if (!Number.isFinite(s) || s < need) {
        result.reason = `Need ≥${need}s`;
        return result;
      }
      result.ok = true;
      return result;
    }
    case 'distance': {
      const m = Number(submitted.distance_m ?? NaN);
      const need = spec.threshold.distance_m ?? 0;
      if (!Number.isFinite(m) || m < need) {
        result.reason = `Need ≥${need}m`;
        return result;
      }
      result.ok = true;
      return result;
    }
    case 'rounds': {
      const r = Number(submitted.rounds ?? NaN);
      const need = spec.threshold.rounds ?? 0;
      if (!Number.isFinite(r) || r < need) {
        result.reason = `Need ≥${need} rounds`;
        return result;
      }
      result.ok = true;
      return result;
    }
    default: {
      // Unknown metric — fail safely with a server-error reason.
      result.reason = `Unknown test metric: ${String((spec as { metric: string }).metric)}`;
      return result;
    }
  }
}