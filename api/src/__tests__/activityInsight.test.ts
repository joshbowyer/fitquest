/**
 * Tests for the offline fallback + JSON-extraction helpers in
 * activityInsight.ts. The LLM path itself is not unit-testable
 * here (it'd need a mock LLM), but the conservative rule-based
 * fallback and the JSON-extraction logic can both be exercised
 * without a network or DB.
 */
import { describe, it, expect } from 'vitest';
import {
  CURRENT_PROMPT_VERSION,
  InsightPayloadSchema,
  offlineFallback,
  extractJson,
  extractActivityMetrics,
  clamp,
  clampInt,
  type InsightPayload,
  type ActivityMetrics,
} from '../lib/activityInsight';

describe('CURRENT_PROMPT_VERSION', () => {
  it('is a positive integer', () => {
    expect(CURRENT_PROMPT_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(CURRENT_PROMPT_VERSION)).toBe(true);
  });
});

describe('InsightPayloadSchema', () => {
  it('accepts a well-formed payload', () => {
    const r = InsightPayloadSchema.safeParse({
      summary: 'Solid session.',
      qualityScore: 7,
      recoveryLoad: 'normal',
      confidence: 'high',
      factors: [
        { label: 'Sleep', signal: 'positive', weight: 0.4, note: '7.5h avg' },
        { label: 'RPE', signal: 'neutral', weight: 0.2, note: '8.1 avg' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects out-of-range qualityScore', () => {
    const r = InsightPayloadSchema.safeParse({
      summary: 'x',
      qualityScore: 11,
      recoveryLoad: 'normal',
      confidence: 'high',
      factors: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects invalid recoveryLoad', () => {
    const r = InsightPayloadSchema.safeParse({
      summary: 'x',
      qualityScore: 5,
      recoveryLoad: 'medium',
      confidence: 'low',
      factors: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects invalid factor signal', () => {
    const r = InsightPayloadSchema.safeParse({
      summary: 'x',
      qualityScore: 5,
      recoveryLoad: 'light',
      confidence: 'low',
      factors: [{ label: 'X', signal: 'great', weight: 0.5, note: 'n' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects factor weight > 1', () => {
    const r = InsightPayloadSchema.safeParse({
      summary: 'x',
      qualityScore: 5,
      recoveryLoad: 'light',
      confidence: 'low',
      factors: [{ label: 'X', signal: 'positive', weight: 1.5, note: 'n' }],
    });
    expect(r.success).toBe(false);
  });

  it('caps factors at 8', () => {
    const factors = Array.from({ length: 9 }, (_, i) => ({
      label: `F${i}`,
      signal: 'neutral' as const,
      weight: 0.1,
      note: 'n',
    }));
    const r = InsightPayloadSchema.safeParse({
      summary: 'x',
      qualityScore: 5,
      recoveryLoad: 'light',
      confidence: 'low',
      factors,
    });
    expect(r.success).toBe(false);
  });
});

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips ```json fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strips ``` fences without language tag', () => {
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strips leading prose', () => {
    expect(extractJson('Here is the JSON you asked for: {"a":1}')).toEqual({ a: 1 });
  });

  it('strips trailing commentary', () => {
    expect(extractJson('{"a":1}\n\nHope that helps!')).toEqual({ a: 1 });
  });

  it('returns null for empty input', () => {
    expect(extractJson('')).toBeNull();
    expect(extractJson('   \n  ')).toBeNull();
  });

  it('returns null when no JSON object present', () => {
    expect(extractJson('just text')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(extractJson('{"a":')).toBeNull();
  });
});

describe('clamp', () => {
  it('returns empty string for empty input', () => {
    expect(clamp('', 10)).toBe('');
  });

  it('returns input unchanged when under max', () => {
    expect(clamp('hello', 10)).toBe('hello');
  });

  it('truncates with ellipsis when over max', () => {
    const out = clamp('hello world', 6);
    expect(out.length).toBeLessThanOrEqual(6);
    expect(out.endsWith('…')).toBe(true);
  });

  it('keeps input at exactly max length', () => {
    expect(clamp('12345', 5)).toBe('12345');
  });
});

describe('clampInt', () => {
  it('returns min for non-finite values', () => {
    expect(clampInt(NaN, 1, 10)).toBe(1);
    expect(clampInt(Infinity, 1, 10)).toBe(1);
  });

  it('clamps above max to max', () => {
    expect(clampInt(15, 1, 10)).toBe(10);
  });

  it('clamps below min to min', () => {
    expect(clampInt(-3, 1, 10)).toBe(1);
  });

  it('rounds to nearest integer within range', () => {
    expect(clampInt(7.4, 1, 10)).toBe(7);
    expect(clampInt(7.6, 1, 10)).toBe(8);
  });
});

describe('offlineFallback', () => {
  function makeCtx(overrides: Partial<{
    avgRpe: number | null;
    hrv7d: number | null;
    hrvPrior7d: number | null;
    sleepHours7d: number | null;
    sorenessLatest: number | null;
    exercises: number;
    setVolume: number;
    activityMetrics: ActivityMetrics | null;
    type: string;
    durationMin: number | null;
  }> = {}) {
    return {
      workout: {
        type: overrides.type ?? 'STRENGTH',
        name: null,
        durationMin: overrides.durationMin ?? 45,
        performedAt: '2025-06-15T15:00:00.000Z',
        exercises: Array.from({ length: overrides.exercises ?? 3 }, (_, i) => ({
          name: `Ex${i}`,
          sets: [{ reps: 5, weight: 100, rpe: overrides.avgRpe ?? null, skipped: false }],
        })),
        setVolume: overrides.setVolume ?? 1500,
        avgRpe: overrides.avgRpe ?? null,
        activityMetrics: overrides.activityMetrics ?? null,
      },
      context: {
        sleepHours7d: overrides.sleepHours7d ?? null,
        sleepQuality7d: null,
        hrv7d: overrides.hrv7d ?? null,
        hrvPrior7d: overrides.hrvPrior7d ?? null,
        sorenessLatest: overrides.sorenessLatest ?? null,
        moodLatest: null,
        energyLatest: null,
        stressLatest: null,
        weightsLogged7d: 0,
        workoutsLast7d: 0,
        daysSinceLastSession: null,
        exerciseHistory: {},
      },
    };
  }

  it('returns confidence low and a "limited context" factor when no data', () => {
    const p = offlineFallback(makeCtx());
    expect(p.confidence).toBe('low');
    expect(p.recoveryLoad).toBe('normal');
    expect(p.factors.some((f) => f.label === 'Limited context')).toBe(true);
  });

  it('drops score when HRV down >10% vs prior 7d', () => {
    const p = offlineFallback(makeCtx({ hrv7d: 40, hrvPrior7d: 50 }));
    expect(p.factors.some((f) => f.label === 'HRV trend' && f.signal === 'negative')).toBe(true);
    expect(p.qualityScore).toBeLessThan(7);
  });

  it('lifts score when HRV up >10%', () => {
    const p = offlineFallback(makeCtx({ hrv7d: 60, hrvPrior7d: 50 }));
    expect(p.factors.some((f) => f.label === 'HRV trend' && f.signal === 'positive')).toBe(true);
  });

  it('drops score when avg sleep < 6.5h', () => {
    const p = offlineFallback(makeCtx({ sleepHours7d: 6.0 }));
    expect(p.factors.some((f) => f.label === 'Sleep')).toBe(true);
  });

  it('drops score when avg RPE ≥ 9', () => {
    const p = offlineFallback(makeCtx({ avgRpe: 9.3 }));
    expect(p.factors.some((f) => f.label === 'RPE')).toBe(true);
  });

  it('drops score when soreness ≥ 7', () => {
    const p = offlineFallback(makeCtx({ sorenessLatest: 8 }));
    expect(p.factors.some((f) => f.label === 'Soreness')).toBe(true);
  });

  it('clamps score to 1-10', () => {
    const allBad = makeCtx({
      avgRpe: 10,
      hrv7d: 20,
      hrvPrior7d: 50,
      sleepHours7d: 4,
      sorenessLatest: 10,
    });
    const p = offlineFallback(allBad);
    expect(p.qualityScore).toBeGreaterThanOrEqual(1);
    expect(p.qualityScore).toBeLessThanOrEqual(10);
    expect(p.recoveryLoad).toBe('rest');
  });

  it('summary mentions set volume + RPE when available', () => {
    const p = offlineFallback(makeCtx({ avgRpe: 8.2, setVolume: 2400 }));
    expect(p.summary).toContain('2400');
    expect(p.summary).toContain('8.2');
  });

  it('returns a valid InsightPayloadSchema shape', () => {
    const p = offlineFallback(makeCtx({ avgRpe: 8, sleepHours7d: 7, sorenessLatest: 4 }));
    const check = InsightPayloadSchema.safeParse(p);
    expect(check.success).toBe(true);
  });

  it('drops score when avg HR ≥ 170 (cardio effort flag)', () => {
    const cardio: ActivityMetrics = {
      distanceKm: 8.2,
      elevationGainM: 50,
      avgHr: 172,
      maxHr: 182,
      avgPaceSecPerKm: 360,
      pace: 'JOG',
    };
    const p = offlineFallback(makeCtx({
      type: 'CARDIO',
      exercises: 0,
      setVolume: 0,
      activityMetrics: cardio,
    }));
    expect(p.factors.some((f) => f.label === 'Heart rate' && f.signal === 'negative')).toBe(true);
    expect(p.qualityScore).toBeLessThan(7);
  });

  it('drops score when avg HR is within 10 bpm of max HR (sustained near-max)', () => {
    const cardio: ActivityMetrics = {
      distanceKm: 5.0,
      elevationGainM: null,
      avgHr: 178,
      maxHr: 182,
      avgPaceSecPerKm: 300,
      pace: 'RUN',
    };
    const p = offlineFallback(makeCtx({
      type: 'CARDIO',
      exercises: 0,
      setVolume: 0,
      activityMetrics: cardio,
    }));
    expect(p.factors.some((f) => f.label === 'Heart rate' && f.signal === 'negative')).toBe(true);
    // Near-max note should mention "sustained near-max".
    const hr = p.factors.find((f) => f.label === 'Heart rate');
    expect(hr?.note).toContain('sustained near-max');
  });

  it('does not penalize a moderate cardio HR', () => {
    const cardio: ActivityMetrics = {
      distanceKm: 8.2,
      elevationGainM: 50,
      avgHr: 145,
      maxHr: 175,
      avgPaceSecPerKm: 360,
      pace: 'JOG',
    };
    const p = offlineFallback(makeCtx({
      type: 'CARDIO',
      exercises: 0,
      setVolume: 0,
      activityMetrics: cardio,
    }));
    expect(p.factors.some((f) => f.label === 'Heart rate' && f.signal === 'negative')).toBe(false);
  });

  it('CARDIO summary mentions distance and avg HR when present', () => {
    const cardio: ActivityMetrics = {
      distanceKm: 8.2,
      elevationGainM: 50,
      avgHr: 145,
      maxHr: 175,
      avgPaceSecPerKm: 360,
      pace: 'JOG',
    };
    const p = offlineFallback(makeCtx({
      type: 'CARDIO',
      exercises: 0,
      setVolume: 0,
      durationMin: 45,
      activityMetrics: cardio,
    }));
    expect(p.summary).toContain('45min');
    expect(p.summary).toContain('8.2km');
    expect(p.summary).toContain('avg HR 145');
  });
});

describe('extractActivityMetrics', () => {
  it('returns null when both cardio and trackJson are empty', () => {
    expect(extractActivityMetrics(null)).toBeNull();
    expect(extractActivityMetrics(undefined, [])).toBeNull();
    expect(extractActivityMetrics({}, [])).toBeNull();
  });

  it('returns null when cardio is a non-object value', () => {
    expect(extractActivityMetrics('not an object' as any)).toBeNull();
    expect(extractActivityMetrics(42 as any)).toBeNull();
  });

  it('returns non-null activityMetrics from a populated cardio block', () => {
    // The exact case the bug report calls out: a 5-mile run with HR
    // "screaming" — captured by the manual cardio entry path which
    // populates the workout-level cardio JSONB block.
    const cardio = {
      distanceKm: 8.05,
      durationSec: 45 * 60,
      pace: 'RUN',
      elevationGainM: 80,
      avgHr: 172,
      maxHr: 184,
      avgPaceSecPerKm: 335,
      source: 'GPS',
    };
    const m = extractActivityMetrics(cardio);
    expect(m).not.toBeNull();
    expect(m!.distanceKm).toBe(8.05);
    expect(m!.elevationGainM).toBe(80);
    expect(m!.avgHr).toBe(172);
    expect(m!.maxHr).toBe(184);
    expect(m!.avgPaceSecPerKm).toBe(335);
    expect(m!.pace).toBe('RUN');
  });

  it('falls back to trackJson for HR when cardio.avgHr/maxHr are missing', () => {
    // The FIT import path: cardio block is null, but trackJson has
    // per-second HR samples. Should produce non-null metrics with at
    // least the HR pair populated from the stream.
    const cardio = { distanceKm: 5.0, pace: 'JOG' };
    const trackJson = [
      { t: 0, hr: 140 },
      { t: 1, hr: 150 },
      { t: 2, hr: 160 },
      { t: 3, hr: 170 },
      { t: 4, hr: 180 },
    ];
    const m = extractActivityMetrics(cardio, trackJson);
    expect(m).not.toBeNull();
    expect(m!.distanceKm).toBe(5.0);
    expect(m!.pace).toBe('JOG');
    expect(m!.avgHr).toBe(160);
    expect(m!.maxHr).toBe(180);
  });

  it('prefers cardio HR over trackJson when both are present', () => {
    const cardio = { distanceKm: 5.0, avgHr: 150, maxHr: 170 };
    const trackJson = [
      { t: 0, hr: 180 },
      { t: 1, hr: 185 },
    ];
    const m = extractActivityMetrics(cardio, trackJson);
    expect(m!.avgHr).toBe(150);
    expect(m!.maxHr).toBe(170);
  });

  it('ignores non-numeric or impossibly high HR samples in trackJson', () => {
    const trackJson = [
      { hr: 150 },
      { hr: '160' as any }, // not a number
      { hr: 0 }, // out of range
      { hr: -10 }, // out of range
      { hr: 500 }, // out of range
      { hr: 160 },
    ];
    const m = extractActivityMetrics(null, trackJson);
    expect(m).not.toBeNull();
    expect(m!.avgHr).toBe(155); // (150 + 160) / 2
    expect(m!.maxHr).toBe(160);
  });

  it('returns null when trackJson has no usable HR samples', () => {
    const trackJson = [
      { hr: null },
      { hr: 'x' as any },
      {},
    ];
    expect(extractActivityMetrics(null, trackJson)).toBeNull();
  });

  it('safely ignores malformed cardio fields of wrong types', () => {
    const cardio = {
      distanceKm: '8.05' as any, // wrong type
      avgHr: 172,
      maxHr: 184,
      pace: 123 as any, // wrong type
    };
    const m = extractActivityMetrics(cardio);
    expect(m).not.toBeNull();
    expect(m!.distanceKm).toBeNull();
    expect(m!.avgHr).toBe(172);
    expect(m!.maxHr).toBe(184);
    expect(m!.pace).toBeNull();
  });
});