/**
 * Lean body mass = weight × (1 − body-fat%) − creatine-water-weight.
 *
 * The creatine adjustment is applied only when the user has logged
 * Creatine on ≥3 of the last 7 days (see isCreatineActive). The
 * 1.5 kg water-weight figure is an approximation — actual numbers
 * vary but land in the 1–2 kg range for a standard 5 g/day dose.
 */
export const CREATINE_WATER_KG = 1.5;

export function leanMassKg(
  weightKg: number,
  bodyFatPct: number,
  creatineActive: boolean,
): number {
  const lbm = weightKg * (1 - bodyFatPct / 100);
  return Math.max(0, lbm - (creatineActive ? CREATINE_WATER_KG : 0));
}

export function ffmi(leanKg: number, heightCm: number): number {
  return leanKg / Math.pow(heightCm / 100, 2);
}