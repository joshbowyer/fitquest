/**
 * Tests for the pure helpers in api/src/lib/measurementSource.ts.
 *
 * These are pure functions (no DB), so we can exhaustively cover
 * the source → confidence mapping, the weighted-average behaviour,
 * and the risk-flag heuristic without touching Postgres.
 */
import { describe, it, expect } from 'vitest';
import {
  confidenceForSource,
  weightedBodyFatAverage,
  lowConfidenceBodyFatFlag,
  SOURCE_CONFIDENCE,
  SOURCE_LABELS,
  SOURCE_SHORT,
  SOURCE_TONE,
} from '../lib/measurementSource';

describe('SOURCE_CONFIDENCE table', () => {
  it('ranks lab-grade methods above field methods above eyeball methods', () => {
    expect(SOURCE_CONFIDENCE.DEXA).toBeGreaterThan(SOURCE_CONFIDENCE.NAVY_TAPE);
    expect(SOURCE_CONFIDENCE.NAVY_TAPE).toBeGreaterThan(SOURCE_CONFIDENCE.CALIPERS);
    expect(SOURCE_CONFIDENCE.CALIPERS).toBeGreaterThan(SOURCE_CONFIDENCE.BIA);
    expect(SOURCE_CONFIDENCE.BIA).toBeGreaterThan(SOURCE_CONFIDENCE.VISUAL);
  });

  it('treats UNKNOWN as conservative (lower than mid-range methods)', () => {
    expect(SOURCE_CONFIDENCE.UNKNOWN).toBeLessThan(SOURCE_CONFIDENCE.NAVY_TAPE);
    // But above VISUAL — we still trust the number, just not as much.
    expect(SOURCE_CONFIDENCE.UNKNOWN).toBeGreaterThan(SOURCE_CONFIDENCE.VISUAL);
  });

  it('keeps every value in [0, 1]', () => {
    for (const [src, conf] of Object.entries(SOURCE_CONFIDENCE)) {
      expect(conf, src).toBeGreaterThanOrEqual(0);
      expect(conf, src).toBeLessThanOrEqual(1);
    }
  });

  it('provides parallel labels, short labels, and tone for every source', () => {
    for (const src of Object.keys(SOURCE_CONFIDENCE)) {
      expect(SOURCE_LABELS[src as keyof typeof SOURCE_LABELS], src).toBeTruthy();
      expect(SOURCE_SHORT[src as keyof typeof SOURCE_SHORT], src).toBeTruthy();
      expect(['cyan', 'lime', 'amber', 'magenta']).toContain(SOURCE_TONE[src as keyof typeof SOURCE_TONE]);
    }
  });
});

describe('confidenceForSource', () => {
  it('looks up by enum value', () => {
    expect(confidenceForSource('DEXA')).toBe(0.95);
    expect(confidenceForSource('CALIPERS')).toBe(0.80);
    expect(confidenceForSource('UNKNOWN')).toBe(0.60);
  });

  it('returns UNKNOWN confidence for null / undefined', () => {
    expect(confidenceForSource(null)).toBe(SOURCE_CONFIDENCE.UNKNOWN);
    expect(confidenceForSource(undefined)).toBe(SOURCE_CONFIDENCE.UNKNOWN);
    expect(confidenceForSource('')).toBe(SOURCE_CONFIDENCE.UNKNOWN);
  });

  it('returns UNKNOWN confidence for unknown strings (forward-compat)', () => {
    expect(confidenceForSource('MADE_UP_METHOD')).toBe(SOURCE_CONFIDENCE.UNKNOWN);
  });
});

describe('weightedBodyFatAverage', () => {
  it('returns null for empty input', () => {
    expect(weightedBodyFatAverage([])).toBe(null);
  });

  it('returns the value when there is only one reading', () => {
    expect(weightedBodyFatAverage([{ value: 18.0, source: 'DEXA' }])).toBeCloseTo(18.0);
  });

  it('equals the simple average when all confidences are equal', () => {
    const readings = [
      { value: 18.0, source: 'DEXA' },
      { value: 20.0, source: 'DEXA' },
    ];
    expect(weightedBodyFatAverage(readings)).toBeCloseTo(19.0);
  });

  it('pulls the average toward the higher-confidence reading', () => {
    // DEXA @ 0.95 weight vs Calipers @ 0.80 weight
    const readings = [
      { value: 18.0, source: 'DEXA' },
      { value: 22.0, source: 'CALIPERS' },
    ];
    // weighted = (0.95*18 + 0.80*22) / (0.95 + 0.80)
    //         = (17.10 + 17.60) / 1.75
    //         = 34.70 / 1.75
    //         ≈ 19.83
    const result = weightedBodyFatAverage(readings);
    expect(result).toBeCloseTo((0.95 * 18 + 0.80 * 22) / (0.95 + 0.80));
    // Sanity: the average must lean toward 18 (DEXA), not 22 (Cal).
    expect(result!).toBeLessThan(20.0);
  });

  it('makes DEXA dominate when mixed with several low-confidence readings', () => {
    const readings = [
      { value: 18.0, source: 'DEXA' },     // 0.95 weight
      { value: 25.0, source: 'BIA' },      // 0.70 weight
      { value: 28.0, source: 'VISUAL' },   // 0.55 weight
    ];
    const result = weightedBodyFatAverage(readings)!;
    // Compare against the same readings treated as equal weight:
    const equalWeight = (18 + 25 + 28) / 3; // 23.67
    // DEXA-weighted average must be lower (closer to 18).
    expect(result).toBeLessThan(equalWeight);
  });

  it('treats null source as UNKNOWN confidence', () => {
    const readings = [
      { value: 18.0, source: 'DEXA' },
      { value: 20.0, source: null },
    ];
    const withNull = weightedBodyFatAverage(readings)!;
    // UNKNOWN (0.60) vs DEXA (0.95) — should lean toward 18.
    expect(withNull).toBeLessThan(19.0);
  });
});

describe('lowConfidenceBodyFatFlag', () => {
  it('returns null when there are no recent readings', () => {
    expect(lowConfidenceBodyFatFlag([])).toBe(null);
  });

  it('returns null when any recent reading is high-confidence', () => {
    expect(lowConfidenceBodyFatFlag([
      { source: 'BIA' },
      { source: 'DEXA' },
      { source: 'BIA' },
    ])).toBe(null);
  });

  it('returns a flag when all recent readings are low-confidence', () => {
    const flag = lowConfidenceBodyFatFlag([
      { source: 'BIA' },
      { source: 'BIA' },
      { source: 'CALIPERS' },
    ]);
    expect(flag).toBeTruthy();
    expect(flag!).toContain('BIA');
    expect(flag!).toContain('Calipers');
    expect(flag!).toMatch(/DEXA|BodPod/);
  });

  it('dedupes source names in the flag text', () => {
    const flag = lowConfidenceBodyFatFlag([
      { source: 'BIA' },
      { source: 'BIA' },
      { source: 'BIA' },
    ]);
    // Should mention BIA once, not three times.
    expect(flag!.match(/BIA/g)?.length).toBe(1);
  });

  it('handles null sources gracefully (UNKNOWN confidence)', () => {
    const flag = lowConfidenceBodyFatFlag([
      { source: null },
      { source: null },
    ]);
    expect(flag).toBeTruthy();
    expect(flag!).toContain('Unknown');
  });
});
