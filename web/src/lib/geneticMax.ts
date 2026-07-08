// ============================================================================
// Genetic-max preview formulas (Casey Butt–calibrated).
// ============================================================================
//
// SINGLE SOURCE OF TRUTH for the FRONTEND preview of a user's genetic
// max ceilings. This must mirror the server formula in
// `api/src/lib/geneticMax.ts` (`computeGeneticMax`) exactly — the
// server is authoritative (it writes the stored GeneticMax rows the
// dashboard reads), and this module is only the client-side "what
// would the formula say?" preview shown on /profile before the frame
// data is saved and the server recomputes.
//
// If you edit a formula here, edit `api/src/lib/geneticMax.ts` at the
// same time (and vice-versa). Three historical drift bugs are the
// reason this is now a shared module rather than an inline copy on
// Profile.tsx:
//   1. NECK returned the user's current neckCircCm (a mirror of the
//      latest measurement) instead of the wrist/height ceiling. Neck
//      can grow (traps), so the genetic max must be a CEILING, not a
//      snapshot — matching the api formula.
//   2. WAIST had a formula (h × 0.161 or w × 1.9) but the api dropped
//      waist from genetic maxes entirely (it's a "lean minimum", not
//      a "growth ceiling" — it belongs in Measurements, not Genetic
//      Maxes). Returns null here.
//   3. BENCH_1RM used w × 1.0 as a bodyweight proxy; the api uses
//      weightKg × 1.5 as a 1.5× bodyweight strength ceiling.
// All three match the api exactly below.

/**
 * previewMax — client-side preview of a metric's genetic-max ceiling
 * from the user's frame inputs. Returns null when the required input
 * is missing (or when the metric has no ceiling, e.g. WAIST).
 *
 * `neckCircCm` is intentionally NOT a parameter — NECK derives from
 * wrist/height, never from the current neck measurement (see note 1).
 */
export function previewMax(
  metric: string,
  wristCm: number | null,
  ankleCm: number | null,
  heightCm: number | null,
  weightKg: number | null,
): number | null {
  const w = wristCm;
  const a = ankleCm;
  const h = heightCm;
  const weight = weightKg;
  switch (metric) {
    case 'BICEP':
    case 'BICEP_FLEXED': return w ? w * 2.7 : (h ? h * 0.228 : null);
    case 'BICEP_RELAXED': return w ? w * 2.7 * 0.92 : (h ? h * 0.228 * 0.92 : null);
    case 'FOREARM':    return w ? w * 2.3 : (h ? h * 0.195 : null);
    case 'CHEST':      return w ? w * 7.5 : (h ? h * 0.634 : null);
    case 'SHOULDER':   return w ? w * 8.5 : (h ? h * 0.718 : null);
    case 'NECK':       return w ? w * 2.9 : (h ? h * 0.245 : null);
    case 'QUAD':       return a ? a * 2.85 : (h ? h * 0.352 : null);
    case 'CALF':       return a ? a * 1.9 : (h ? h * 0.234 : null);
    case 'WAIST':      return null;
    case 'BENCH_1RM':  return weight ? weight * 1.5 : null;
    default: return null;
  }
}

/**
 * The measurement metrics shown in the /profile genetic-max preview
 * grid, in display order. BICEP is split into flexed + relaxed:
 * flexed is the canonical "show off" measurement (matches the Casey
 * Butt formula); relaxed tracks arm size without a pump.
 */
export const PREVIEW_METRICS = [
  { key: 'BICEP_FLEXED', label: 'Bicep (Flexed)', unit: 'cm' },
  { key: 'BICEP_RELAXED', label: 'Bicep (Relaxed)', unit: 'cm' },
  { key: 'FOREARM', label: 'Forearm', unit: 'cm' },
  { key: 'CHEST', label: 'Chest', unit: 'cm' },
  { key: 'SHOULDER', label: 'Shoulders', unit: 'cm' },
  { key: 'NECK', label: 'Neck', unit: 'cm' },
  { key: 'QUAD', label: 'Quad', unit: 'cm' },
  { key: 'CALF', label: 'Calf', unit: 'cm' },
] as const;
