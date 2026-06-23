/**
 * Tests for the offline metric-insight rules + JSON-extraction
 * helpers. The LLM path itself is not unit-testable here; we
 * verify the deterministic fallback that powers the panel when
 * the LLM is unavailable or returns garbage.
 */
import { describe, it, expect } from 'vitest';
import {
  CURRENT_PROMPT_VERSION,
  MetricInsightPayloadSchema,
  offlineMetricInsight,
  extractJson,
  type GatheredMetric,
} from '../lib/metricInsight';

describe('CURRENT_PROMPT_VERSION', () => {
  it('is a positive integer', () => {
    expect(CURRENT_PROMPT_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(CURRENT_PROMPT_VERSION)).toBe(true);
  });
});

describe('MetricInsightPayloadSchema', () => {
  it('accepts a well-formed payload', () => {
    const r = MetricInsightPayloadSchema.safeParse({
      summary: 'HRV steady at 51ms.',
      factors: [
        { label: 'Trend', signal: 'positive', weight: 0.6, note: 'up 4%' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid signal', () => {
    const r = MetricInsightPayloadSchema.safeParse({
      summary: 'x',
      factors: [{ label: 'X', signal: 'great', weight: 0.5, note: 'n' }],
    });
    expect(r.success).toBe(false);
  });

  it('caps factors at 6', () => {
    const factors = Array.from({ length: 7 }, (_, i) => ({
      label: `F${i}`,
      signal: 'neutral' as const,
      weight: 0.1,
      note: 'n',
    }));
    const r = MetricInsightPayloadSchema.safeParse({ summary: 'x', factors });
    expect(r.success).toBe(false);
  });
});

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strips leading prose', () => {
    expect(extractJson('Here you go: {"a":1}')).toEqual({ a: 1 });
  });

  it('returns null for empty / malformed', () => {
    expect(extractJson('')).toBeNull();
    expect(extractJson('not json')).toBeNull();
    expect(extractJson('{"a":')).toBeNull();
  });
});

describe('offlineMetricInsight', () => {
  function makeCtx(overrides: Partial<{
    metric: string;
    lastValue: number | null;
    deltaPct30: number | null;
    coverageDays30: number;
    coverageDays7: number;
    coverageDays90: number;
    geneticMax: number | null;
    related: Record<string, number | null>;
  }> = {}) {
    const last7 = {
      avg: overrides.lastValue ?? null,
      delta: null,
      deltaPct: null,
      coverageDays: overrides.coverageDays7 ?? 0,
      lastValue: overrides.lastValue ?? null,
      lastRecordedAt: new Date(),
    };
    const prior7 = { avg: null, delta: null, deltaPct: null, coverageDays: 0, lastValue: null, lastRecordedAt: null };
    const last30 = {
      avg: overrides.lastValue ?? null,
      delta: overrides.deltaPct30 != null && overrides.lastValue != null
        ? overrides.lastValue * overrides.deltaPct30
        : null,
      deltaPct: overrides.deltaPct30,
      coverageDays: overrides.coverageDays30 ?? 5,
      lastValue: overrides.lastValue ?? null,
      lastRecordedAt: new Date(),
    };
    const prior30 = { avg: null, delta: null, deltaPct: null, coverageDays: 0, lastValue: null, lastRecordedAt: null };
    const last90 = {
      avg: overrides.lastValue ?? null,
      delta: null,
      deltaPct: null,
      coverageDays: overrides.coverageDays90 ?? 10,
      lastValue: overrides.lastValue ?? null,
      lastRecordedAt: new Date(),
    };
    const prior90 = { avg: null, delta: null, deltaPct: null, coverageDays: 0, lastValue: null, lastRecordedAt: null };
    return {
      metric: overrides.metric ?? 'HRV',
      windows: {
        last7, prior7,
        last30: { ...last30, deltaPct: overrides.deltaPct30 },
        prior30,
        last90, prior90,
      },
      geneticMax: overrides.geneticMax ?? null,
      relatedMetrics: overrides.related ?? { RESTING_HR: 60 },
    } as unknown as GatheredMetric;
  }

  it('returns "no data" hint when nothing logged', () => {
    const p = offlineMetricInsight(makeCtx({ lastValue: null, coverageDays7: 0, coverageDays30: 0, coverageDays90: 0 }));
    expect(p.summary.toLowerCase()).toContain('no data');
    expect(p.factors).toHaveLength(1);
    expect(p.factors[0].label).toBe('Coverage');
  });

  it('says "steady" when delta < 5%', () => {
    const p = offlineMetricInsight(makeCtx({ lastValue: 51, deltaPct30: 0.02 }));
    expect(p.summary.toLowerCase()).toContain('steady');
  });

  it('reports "up N%" when delta > 5%', () => {
    const p = offlineMetricInsight(makeCtx({ lastValue: 55, deltaPct30: 0.10 }));
    expect(p.summary).toContain('up');
    expect(p.summary).toContain('10%');
  });

  it('reports "down N%" when delta < -5%', () => {
    const p = offlineMetricInsight(makeCtx({ lastValue: 45, deltaPct30: -0.15 }));
    expect(p.summary).toContain('down');
    expect(p.summary).toContain('15%');
  });

  it('includes genetic max percentage when available', () => {
    const p = offlineMetricInsight(makeCtx({ lastValue: 100, geneticMax: 130 }));
    // 100/130 = 76.9% → rounded to 77%.
    expect(p.summary).toMatch(/77%/);
  });

  it('returns a valid payload schema shape', () => {
    const p = offlineMetricInsight(makeCtx({ lastValue: 60, deltaPct30: -0.08, geneticMax: 200 }));
    const check = MetricInsightPayloadSchema.safeParse(p);
    expect(check.success).toBe(true);
  });
});