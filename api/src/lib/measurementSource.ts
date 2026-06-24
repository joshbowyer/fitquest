/**
 * Measurement source helpers.
 *
 * Body-fat readings come from many methods with very different
 * accuracy profiles. Rather than treat every reading as equal, we
 * tag each measurement with a `MeasurementSource` and use
 * `confidenceForSource()` to weight trend calculations.
 *
 * The confidence score (0..1) is also surfaced as a chip badge in
 * the UI so the user can see at a glance how much to trust a row.
 *
 * Pure functions only — no DB access. Tested in
 * api/src/__tests__/measurementSource.test.ts.
 */

import { MeasurementSource } from '@prisma/client';

// Re-export so consumers can `import { MeasurementSource } from
// './measurementSource.js'` rather than reaching into @prisma/client.
export { MeasurementSource };

/**
 * Confidence per source. Lab-grade methods top the list, visual
 * estimates / unknown sit at the bottom. UNKNOWN is intentionally
 * conservative — we'd rather under-trust an untagged reading than
 * silently accept it as calibrated.
 */
export const SOURCE_CONFIDENCE: Record<MeasurementSource, number> = {
  DEXA: 0.95,
  BOD_POD: 0.95,
  NAVY_TAPE: 0.85,
  CALIPERS: 0.80,
  BIA: 0.70,
  VISUAL: 0.55,
  MANUAL: 0.60,
  UNKNOWN: 0.60,
};

/** Human-friendly labels for UI rendering. Order = picker order. */
export const SOURCE_LABELS: Record<MeasurementSource, string> = {
  DEXA: 'DEXA',
  BOD_POD: 'BodPod',
  NAVY_TAPE: 'Navy Tape',
  CALIPERS: 'Calipers',
  BIA: 'BIA',
  VISUAL: 'Visual',
  MANUAL: 'Manual',
  UNKNOWN: 'Unknown',
};

/** Short labels for tight chips. */
export const SOURCE_SHORT: Record<MeasurementSource, string> = {
  DEXA: 'DEXA',
  BOD_POD: 'BP',
  NAVY_TAPE: 'Navy',
  CALIPERS: 'Cal',
  BIA: 'BIA',
  VISUAL: 'Eye',
  MANUAL: 'Log',
  UNKNOWN: '?',
};

/** Chip tone per source. Lab-grade = lime/cyan, low-confidence = amber/rose. */
export const SOURCE_TONE: Record<MeasurementSource, 'cyan' | 'lime' | 'amber' | 'magenta'> = {
  DEXA: 'cyan',
  BOD_POD: 'cyan',
  NAVY_TAPE: 'lime',
  CALIPERS: 'lime',
  BIA: 'amber',
  VISUAL: 'magenta',
  MANUAL: 'amber',
  UNKNOWN: 'amber',
};

/** Confidence lookup. Returns the same number for both enum and
 *  string inputs so callers can pass either shape safely. */
export function confidenceForSource(s: MeasurementSource | string | null | undefined): number {
  if (!s) return SOURCE_CONFIDENCE.UNKNOWN;
  return SOURCE_CONFIDENCE[s as MeasurementSource] ?? SOURCE_CONFIDENCE.UNKNOWN;
}

/**
 * Weighted average of body-fat readings. Each reading's value is
 * weighted by its source's confidence — DEXA readings dominate the
 * average, BIA readings barely move it. Readings with confidence
 * <= 0 are excluded (defensive — won't fire today but future
 * "rejected" sources could set it).
 *
 * Returns null if no readings pass the filter.
 */
export function weightedBodyFatAverage(
  readings: Array<{ value: number; source: MeasurementSource | string | null }>,
): number | null {
  let sumW = 0;
  let sumWV = 0;
  for (const r of readings) {
    const w = confidenceForSource(r.source);
    if (w <= 0) continue;
    sumW += w;
    sumWV += w * r.value;
  }
  if (sumW === 0) return null;
  return sumWV / sumW;
}

/**
 * Return a `⚠ Watch` style risk flag when the user's recent body-fat
 * readings are all from low-confidence sources. Empty string when the
 * user has no body-fat readings, or when any of the last 3 is
 * high-confidence (we trust the trend enough to stay quiet).
 *
 * Surfaced in the morning report's risk_flags array.
 */
export function lowConfidenceBodyFatFlag(
  recent: Array<{ source: MeasurementSource | string | null }>,
): string | null {
  if (recent.length === 0) return null;
  // Any high-confidence reading in the recent window → no flag.
  if (recent.some((r) => confidenceForSource(r.source) >= 0.85)) return null;
  const sources = new Set(recent.map((r) => r.source ?? 'UNKNOWN'));
  const names = [...sources].map((s) => SOURCE_LABELS[s as MeasurementSource] ?? s);
  return `Recent body-fat readings are all ${names.join('/')} (low-confidence). One DEXA or BodPod scan would calibrate your trend.`;
}
