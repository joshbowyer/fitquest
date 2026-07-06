/**
 * Body-fat percentage formulas. Each method takes the raw inputs
 * the user has and returns a single %BF value. Kept as pure
 * functions with no React or Prisma dependency so they're trivially
 * unit-testable from `web/src/__tests__/bodyfat.test.ts`.
 *
 * Sources:
 *   - Jackson-Pollock 3-site (JP3): original 1978 paper, generalised
 *     by ACSM. Body-density formula per sex (see below) → Siri BF.
 *   - Navy tape method: US Navy Body Composition program (Hodgdon &
 *     Beckett, 1984). Tape measure only.
 *
 * Conventions:
 *   - Caliper skinfolds in millimetres.
 *   - Circumferences in centimetres.
 *   - Heights in centimetres (the api stores cm; display layer
 *     converts to in for IMPERIAL users before calling these).
 *   - Age in whole years.
 *
 * Sex-specific formula branches:
 *   - MALE → JP3: chest + abdomen + thigh.
 *   - FEMALE → JP3: triceps + suprailium + thigh.
 *   - MALE → Navy: waist + neck (no hip).
 *   - FEMALE → Navy: waist + hip + neck.
 *   - OTHER → fall back to male formula but flag in the UI copy so
 *     the user knows to interpret with care. (Most "non-binary"
 *     users will want the male formula unless they're on HRT with
 *     significant body-fat redistribution — that's a personal
 *     call.)
 *
 * Validation: clamp to 2-60% at the boundary so a typo can't store
 * an absurd value. The api's PATCH /me schema also enforces this
 * range as a belt-and-suspenders.
 */
export type Sex = 'MALE' | 'FEMALE' | 'OTHER';

export type BodyfatMethod = 'DEXA' | 'BIA' | 'CALIPERS_3' | 'NAVY';

export type BodyfatInputs =
  | { method: 'DEXA' | 'BIA'; bfPct: number }
  | {
      method: 'CALIPERS_3';
      sex: Sex;
      /** mm. Order: chest/abdomen/thigh (men) or triceps/suprailium/thigh (women). */
      skinfoldsMm: [number, number, number];
      ageYears: number;
    }
  | {
      method: 'NAVY';
      sex: Sex;
      /** cm. */
      waistCm: number;
      /** cm. */
      neckCm: number;
      /** cm. Required for FEMALE; ignored for MALE. */
      hipCm?: number;
      /** cm. */
      heightCm: number;
    };

export type BodyfatResult = {
  /** Computed %BF, clamped to 2-60. */
  bfPct: number;
  /** Method used — matches MeasurementSource enum where applicable. */
  method: BodyfatMethod;
};

/** Clamp a bodyfat reading to the 2-60% range the api accepts. */
function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(2, Math.min(60, v));
}

/** Jackson-Pollock 3-site body-density formula → Siri BF%. */
export function jacksonPollock3(
  sex: Sex,
  skinfoldsMm: [number, number, number],
  ageYears: number,
): number {
  const [a, b, c] = skinfoldsMm;
  const sum = a + b + c;
  const sum2 = sum * sum;
  // Female formula — triceps + suprailium + thigh.
  // Male formula — chest + abdomen + thigh.
  // "OTHER" defaults to male (most non-binary users haven't done a
  // body-fat redistribution; documented in the picker UI).
  const isFemale = sex === 'FEMALE';
  const bodyDensity = isFemale
    ? 1.0994921 - 0.0009929 * sum + 0.0000023 * sum2 - 0.0001392 * ageYears
    : 1.10938   - 0.0008267 * sum + 0.0000016 * sum2 - 0.0002574 * ageYears;
  // Siri (1961) equation. Valid for body density 1.0-1.2 (the realistic
  // human range) — outside that, %BF can go negative or astronomical,
  // which the clampPct above will catch.
  return clampPct((495 / bodyDensity) - 450);
}

/**
 * US Navy tape method. Returns %BF.
 *
 * Men: %BF = 86.010 × log10(waist − neck) − 70.041 × log10(height) + 36.76
 * Women: %BF = 163.205 × log10(waist + hip − neck) − 97.684 × log10(height) − 78.387
 *
 * All log10s require positive arguments. A waist ≤ neck (or waist + hip ≤
 * neck for women) is physiologically impossible — return null so the caller
 * can show "check your measurements" instead of NaN.
 */
export function navyTape(
  sex: Sex,
  waistCm: number,
  neckCm: number,
  heightCm: number,
  hipCm?: number,
): number | null {
  if (!Number.isFinite(waistCm) || !Number.isFinite(neckCm) || !Number.isFinite(heightCm)) return null;
  if (waistCm <= 0 || neckCm <= 0 || heightCm <= 0) return null;
  if (sex === 'FEMALE') {
    if (hipCm == null || !Number.isFinite(hipCm) || hipCm <= 0) return null;
    const arg = waistCm + hipCm - neckCm;
    if (arg <= 0) return null;
    const bf = 163.205 * Math.log10(arg) - 97.684 * Math.log10(heightCm) - 78.387;
    return clampPct(bf);
  }
  const arg = waistCm - neckCm;
  if (arg <= 0) return null;
  const bf = 86.010 * Math.log10(arg) - 70.041 * Math.log10(heightCm) + 36.76;
  return clampPct(bf);
}

/** Top-level dispatcher: takes a BodyfatInputs and returns the computed %BF. */
export function computeBodyfat(inputs: BodyfatInputs): BodyfatResult {
  switch (inputs.method) {
    case 'DEXA':
    case 'BIA':
      return { method: inputs.method, bfPct: clampPct(inputs.bfPct) };
    case 'CALIPERS_3':
      return {
        method: 'CALIPERS_3',
        bfPct: jacksonPollock3(inputs.sex, inputs.skinfoldsMm, inputs.ageYears),
      };
    case 'NAVY': {
      const bf = navyTape(inputs.sex, inputs.waistCm, inputs.neckCm, inputs.heightCm, inputs.hipCm);
      // If Navy returns null (impossible inputs), fall back to NaN-equivalent
      // that the picker treats as "can't compute" — the UI shows the error.
      return { method: 'NAVY', bfPct: bf ?? NaN };
    }
  }
}

/**
 * Map a picker BodyfatMethod to the api-side MeasurementSource enum
 * value (matches what's stored in Measurement.source so the morning
 * report's confidence weighting works). DEXA and BIA map directly;
 * CALIPERS_3 maps to CALIPERS; NAVY maps to NAVY_TAPE.
 */
export function methodToMeasurementSource(m: BodyfatMethod):
  'DEXA' | 'BOD_POD' | 'NAVY_TAPE' | 'CALIPERS' | 'BIA' | 'VISUAL' | 'UNKNOWN' | 'MANUAL' {
  switch (m) {
    case 'DEXA':     return 'DEXA';
    case 'BIA':      return 'BIA';
    case 'CALIPERS_3': return 'CALIPERS';
    case 'NAVY':     return 'NAVY_TAPE';
  }
}