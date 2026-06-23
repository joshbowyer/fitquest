/**
 * Plate calculator. Given a target weight and available plates,
 * returns the optimal plate combination per side.
 *
 * Standard gym plate sets:
 *   Metric: 25, 20, 15, 10, 5, 2.5, 1.25 (kg)
 *   Imperial: 45, 35, 25, 10, 5, 2.5 (lb)
 *
 * The 1.25 kg (2.5 lb) plate is the smallest commonly available, so
 * we round to the nearest achievable half-plate-pair. Anything finer
 * than that is reported as "infeasible" with the exact delta so the
 * user can microplate up or accept the rounding.
 *
 * Pure unit-agnostic: the calculator works in whatever unit the user
 * is currently using (kg for metric, lb for imperial). All inputs
 * and outputs are in that unit.
 *
 * Lives in api/src/lib so it ships with vitest; web imports it via
 * the matching web/src/lib/plateCalc.ts re-export shim.
 */

export type UnitSystem = 'METRIC' | 'IMPERIAL';

const METRIC_BAR_KG = 20;
const IMPERIAL_BAR_LB = 45;
const METRIC_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];
const IMPERIAL_PLATES_LB = [45, 35, 25, 10, 5, 2.5];

export type PlateCalcResult = {
  /** Plates per side, descending. Empty = bar only or invalid. */
  plates: number[];
  /** The exact weight this combination produces (in the target unit). */
  achieved: number;
  /** Difference between target and achieved. Negative = under, positive = over. */
  delta: number;
  /** "infeasible" if the requested target isn't achievable with available plates. */
  status: 'ok' | 'infeasible';
  /** Bar weight used (in target unit). */
  bar: number;
  /** Unit suffix. */
  unit: 'kg' | 'lb';
};

export function calcPlates(
  targetDisplay: number,
  units: UnitSystem,
  barDisplay?: number,
): PlateCalcResult {
  const bar = barDisplay ?? (units === 'IMPERIAL' ? IMPERIAL_BAR_LB : METRIC_BAR_KG);
  const plates = units === 'IMPERIAL' ? IMPERIAL_PLATES_LB : METRIC_PLATES_KG;
  const unit: 'kg' | 'lb' = units === 'IMPERIAL' ? 'lb' : 'kg';

  if (!Number.isFinite(targetDisplay) || targetDisplay < 0) {
    return { plates: [], achieved: 0, delta: 0, status: 'infeasible', bar, unit };
  }
  if (targetDisplay < bar) {
    return { plates: [], achieved: 0, delta: targetDisplay - bar, status: 'infeasible', bar, unit };
  }

  // Greedy: pick largest plate that fits, repeat for each side.
  const perSide = (targetDisplay - bar) / 2;
  if (perSide === 0) {
    return { plates: [], achieved: bar, delta: 0, status: 'ok', bar, unit };
  }

  const out: number[] = [];
  let remaining = perSide;
  for (const p of plates) {
    while (remaining + 1e-6 >= p) {
      out.push(p);
      remaining -= p;
    }
  }

  // Use 1e-3 epsilon for floating-point noise from "remaining -= p"
  // when target is exactly achievable.
  if (Math.abs(remaining) > 1e-3) {
    return {
      plates: out,
      achieved: bar + out.reduce((s, x) => s + x, 0) * 2,
      delta: remaining * 2,
      status: 'infeasible',
      bar,
      unit,
    };
  }

  const achieved = bar + out.reduce((s, x) => s + x, 0) * 2;
  return { plates: out, achieved, delta: 0, status: 'ok', bar, unit };
}

/** Format a plate list as the classic "20 + 5 + 2.5 (per side)" string. */
export function formatPlates(r: PlateCalcResult): string {
  if (r.status === 'infeasible' && r.plates.length === 0) {
    if (r.delta < 0) {
      return `target is ${Math.abs(r.delta).toFixed(2)} ${r.unit} below bar (${r.bar} ${r.unit})`;
    }
    return `bar only (${r.bar} ${r.unit})`;
  }
  if (r.plates.length === 0) {
    return `bar only (${r.bar} ${r.unit})`;
  }
  return r.plates.join(' + ') + ` ${r.unit} per side`;
}