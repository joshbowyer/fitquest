/**
 * Tests for the body-battery correlation engine. Pure helpers are
 * unit-tested; integration (DB→overlaps→LLM summary) is verified
 * manually once the user starts logging BODY_BATTERY data.
 */
import { describe, it, expect } from 'vitest';
import { summarizeBbForLlm, type BodyBatteryReport } from '../lib/bodyBatteryCorrelation';

describe('summarizeBbForLlm', () => {
  it('returns empty string for too-few-mornings samples', () => {
    const r: BodyBatteryReport = {
      windowDays: 14,
      morningsTotal: 3,
      lastMorning: null,
      overlaps: [],
    };
    expect(summarizeBbForLlm(r)).toBe('');
  });

  it('returns empty string when no overlap has meaningful data', () => {
    const r: BodyBatteryReport = {
      windowDays: 14,
      morningsTotal: 10,
      lastMorning: null,
      overlaps: [
        { label: 'sleep < 7h', withCount: 3, withoutCount: 7, medianBbWith: 60, medianBbWithout: 62 },
      ],
    };
    // delta = 2, below 5 threshold.
    expect(summarizeBbForLlm(r)).toBe('');
  });

  it('emits a line when an overlap has ≥5pt delta on ≥2 mornings per side', () => {
    const r: BodyBatteryReport = {
      windowDays: 14,
      morningsTotal: 10,
      lastMorning: null,
      overlaps: [
        {
          label: 'sleep < 7h',
          withCount: 3,
          withoutCount: 7,
          medianBbWith: 50,
          medianBbWithout: 70,
        },
      ],
    };
    const summary = summarizeBbForLlm(r);
    expect(summary).toContain('lower');
    expect(summary).toContain('20-pt delta');
    expect(summary).toContain('sleep < 7h');
  });

  it('emits a latest-morning line when lastMorning is present', () => {
    const r: BodyBatteryReport = {
      windowDays: 14,
      morningsTotal: 10,
      lastMorning: {
        bb: 65,
        recordedAt: '2026-06-23T12:00:00Z',
        sleepHours: 7.5,
        sleepOnset: 22.5,
        sleepQuality: 8,
        caffeineInWindow: false,
        alcoholInWindow: false,
        nicotineInWindow: false,
        workoutsInLast24h: 1,
      },
      overlaps: [],
    };
    const summary = summarizeBbForLlm(r);
    expect(summary).toContain('latest body battery 65/100');
    expect(summary).toContain('7.5h sleep');
    expect(summary).toContain('quality 8/10');
    expect(summary).toContain('1 workout');
  });

  it('skips overlaps with too few samples per side', () => {
    const r: BodyBatteryReport = {
      windowDays: 14,
      morningsTotal: 10,
      lastMorning: null,
      overlaps: [
        {
          label: 'caffeine < 8h before sleep',
          withCount: 1,
          withoutCount: 1,
          medianBbWith: 40,
          medianBbWithout: 80,
        },
      ],
    };
    expect(summarizeBbForLlm(r)).toBe('');
  });
});
