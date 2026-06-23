import { describe, it, expect } from 'vitest';
import {
  computeDueMetrics,
  isWithinWindow,
  getLocalHour,
  getLocalDateKey,
  DEFAULT_CADENCE,
  NEVER_SURFACED,
  isCheckInMetric,
  CADENCES,
} from '../lib/checkIns';
import type { MetricType } from '@prisma/client';

describe('cadence defaults', () => {
  it('covers every MetricType', () => {
    // If a new metric is added to the Prisma enum without a cadence,
    // this test will fail — exactly what we want.
    const expected: MetricType[] = [
      'BICEP','CHEST','SHOULDER','QUAD','CALF','FOREARM','NECK','WAIST',
      'BENCH_1RM','SQUAT_1RM','DEADLIFT_1RM','OHP_1RM','PULLUP_1RM',
      'BODY_FAT_PCT','LEAN_MASS','FFMI','WEIGHT',
      'VO2_MAX','RESTING_HR','HRV','FIVE_K_TIME','ONE_MILE_TIME',
      'PLANK_HOLD','L_SIT_HOLD','PUSHUP_MAX','PULLUP_MAX',
      'POWERLIFT_TOTAL','SHOULDER_WAIST_RATIO',
      'SLEEP_HOURS','SLEEP_QUALITY',
      'CALORIES','PROTEIN_G','WATER_ML',
      'MOOD','ENERGY','SORENESS','STRESS',
    ];
    for (const m of expected) {
      expect(DEFAULT_CADENCE[m], `${m} missing cadence`).toBeDefined();
      expect(CADENCES).toContain(DEFAULT_CADENCE[m]);
    }
  });

  it('post-wakeup metrics are AM', () => {
    expect(DEFAULT_CADENCE.WEIGHT).toBe('AM');
    expect(DEFAULT_CADENCE.MOOD).toBe('AM');
    expect(DEFAULT_CADENCE.ENERGY).toBe('AM');
    expect(DEFAULT_CADENCE.SORENESS).toBe('AM');
    expect(DEFAULT_CADENCE.SLEEP_QUALITY).toBe('AM');
    expect(DEFAULT_CADENCE.RESTING_HR).toBe('AM');
    expect(DEFAULT_CADENCE.HRV).toBe('AM');
  });

  it('stress is PM', () => {
    expect(DEFAULT_CADENCE.STRESS).toBe('PM');
  });

  it('body comp + strength PRs are WEEKLY', () => {
    expect(DEFAULT_CADENCE.WAIST).toBe('WEEKLY');
    expect(DEFAULT_CADENCE.NECK).toBe('WEEKLY');
    expect(DEFAULT_CADENCE.BENCH_1RM).toBe('WEEKLY');
    expect(DEFAULT_CADENCE.SQUAT_1RM).toBe('WEEKLY');
    expect(DEFAULT_CADENCE.DEADLIFT_1RM).toBe('WEEKLY');
    expect(DEFAULT_CADENCE.PUSHUP_MAX).toBe('WEEKLY');
  });

  it('derived + daily aggregates are never surfaced', () => {
    expect(isCheckInMetric('LEAN_MASS')).toBe(false);
    expect(isCheckInMetric('FFMI')).toBe(false);
    expect(isCheckInMetric('SHOULDER_WAIST_RATIO')).toBe(false);
    expect(isCheckInMetric('CALORIES')).toBe(false);
    expect(isCheckInMetric('PROTEIN_G')).toBe(false);
    expect(isCheckInMetric('WATER_ML')).toBe(false);
    expect(isCheckInMetric('SLEEP_HOURS')).toBe(false);
  });

  it('never-surfaced set matches isCheckInMetric', () => {
    for (const m of Object.keys(DEFAULT_CADENCE) as MetricType[]) {
      expect(isCheckInMetric(m)).toBe(!NEVER_SURFACED.has(m));
    }
  });
});

describe('getLocalHour', () => {
  it('returns UTC hour when timezone is null', () => {
    const utc = new Date('2025-06-15T15:30:00Z');
    expect(getLocalHour(utc, null)).toBe(15);
  });

  it('converts to America/New_York in summer (EDT, UTC-4)', () => {
    // 2025-06-15 is in EDT (UTC-4). 15:30 UTC → 11:30 NY.
    const utc = new Date('2025-06-15T15:30:00Z');
    expect(getLocalHour(utc, 'America/New_York')).toBe(11);
  });

  it('converts to America/New_York in winter (EST, UTC-5)', () => {
    // 2025-01-15 is in EST (UTC-5). 15:30 UTC → 10:30 NY.
    const utc = new Date('2025-01-15T15:30:00Z');
    expect(getLocalHour(utc, 'America/New_York')).toBe(10);
  });

  it('falls back to UTC on invalid timezone', () => {
    const utc = new Date('2025-06-15T15:30:00Z');
    expect(getLocalHour(utc, 'Not/A/Zone')).toBe(15);
  });
});

describe('getLocalDateKey', () => {
  it('returns YYYY-MM-DD for the local timezone', () => {
    // 2025-06-15T03:00:00Z is 2025-06-14 in NY (still previous day).
    const utc = new Date('2025-06-15T03:00:00Z');
    expect(getLocalDateKey(utc, 'America/New_York')).toBe('2025-06-14');
    expect(getLocalDateKey(utc, 'Asia/Tokyo')).toBe('2025-06-15');
    expect(getLocalDateKey(utc, null)).toBe('2025-06-15');
  });
});

describe('isWithinWindow', () => {
  it('AM is in window 5:00-11:59', () => {
    expect(isWithinWindow('AM', new Date('2025-06-15T10:00:00Z'), null)).toBe(true);
    expect(isWithinWindow('AM', new Date('2025-06-15T04:00:00Z'), null)).toBe(false);
    expect(isWithinWindow('AM', new Date('2025-06-15T12:00:00Z'), null)).toBe(false);
  });

  it('PM is in window 17:00-23:59', () => {
    expect(isWithinWindow('PM', new Date('2025-06-15T18:00:00Z'), null)).toBe(true);
    expect(isWithinWindow('PM', new Date('2025-06-15T16:00:00Z'), null)).toBe(false);
    expect(isWithinWindow('PM', new Date('2025-06-15T00:00:00Z'), null)).toBe(false);
  });

  it('WEEKLY is always in window', () => {
    expect(isWithinWindow('WEEKLY', new Date('2025-06-15T03:00:00Z'), null)).toBe(true);
  });
});

describe('computeDueMetrics', () => {
  const noonUtc = new Date('2025-06-15T15:00:00Z'); // 11am NY (summer)

  it('flags every check-in metric when nothing logged', () => {
    const due = computeDueMetrics({
      lastLoggedByMetric: new Map(),
      now: noonUtc,
      timezone: 'America/New_York',
    });
    // Should include every metric that has a cadence AND is not in NEVER_SURFACED
    const expectedCount = Object.keys(DEFAULT_CADENCE).filter(
      (m) => !NEVER_SURFACED.has(m as MetricType),
    ).length;
    expect(due).toHaveLength(expectedCount);
    expect(due.find((d) => d.metric === 'WEIGHT')).toBeDefined();
    expect(due.find((d) => d.metric === 'STRESS')).toBeDefined();
    expect(due.find((d) => d.metric === 'WAIST')).toBeDefined();
  });

  it('omits never-surfaced metrics', () => {
    const due = computeDueMetrics({
      lastLoggedByMetric: new Map(),
      now: noonUtc,
      timezone: 'America/New_York',
    });
    expect(due.find((d) => d.metric === 'CALORIES')).toBeUndefined();
    expect(due.find((d) => d.metric === 'LEAN_MASS')).toBeUndefined();
  });

  it('AM metric logged today is NOT due', () => {
    const last = new Map<MetricType, Date>();
    last.set('WEIGHT', new Date('2025-06-15T14:00:00Z')); // 10am NY — earlier today
    const due = computeDueMetrics({
      lastLoggedByMetric: last,
      now: noonUtc,
      timezone: 'America/New_York',
    });
    expect(due.find((d) => d.metric === 'WEIGHT')).toBeUndefined();
  });

  it('AM metric logged yesterday IS due', () => {
    const last = new Map<MetricType, Date>();
    last.set('WEIGHT', new Date('2025-06-14T14:00:00Z')); // yesterday 10am NY
    const due = computeDueMetrics({
      lastLoggedByMetric: last,
      now: noonUtc,
      timezone: 'America/New_York',
    });
    expect(due.find((d) => d.metric === 'WEIGHT')).toBeDefined();
  });

  it('WEEKLY metric logged 3 days ago is NOT due', () => {
    const last = new Map<MetricType, Date>();
    last.set('WAIST', new Date('2025-06-13T15:00:00Z')); // 3 days ago
    const due = computeDueMetrics({
      lastLoggedByMetric: last,
      now: noonUtc,
      timezone: 'America/New_York',
    });
    expect(due.find((d) => d.metric === 'WAIST')).toBeUndefined();
  });

  it('WEEKLY metric logged 7 days ago IS due', () => {
    const last = new Map<MetricType, Date>();
    last.set('WAIST', new Date('2025-06-08T15:00:00Z')); // exactly 7 days ago
    const due = computeDueMetrics({
      lastLoggedByMetric: last,
      now: noonUtc,
      timezone: 'America/New_York',
    });
    expect(due.find((d) => d.metric === 'WAIST')).toBeDefined();
  });

  it('WEEKLY metric logged 8 days ago IS due', () => {
    const last = new Map<MetricType, Date>();
    last.set('WAIST', new Date('2025-06-07T15:00:00Z')); // 8 days ago
    const due = computeDueMetrics({
      lastLoggedByMetric: last,
      now: noonUtc,
      timezone: 'America/New_York',
    });
    expect(due.find((d) => d.metric === 'WAIST')).toBeDefined();
  });

  it('inWindow flag tracks current local time-of-day', () => {
    const last = new Map<MetricType, Date>();
    // Noon UTC = 8am NY (summer). AM should be in window, PM should not.
    const due = computeDueMetrics({
      lastLoggedByMetric: last,
      now: new Date('2025-06-15T12:00:00Z'),
      timezone: 'America/New_York',
    });
    const am = due.find((d) => d.cadence === 'AM')!;
    const pm = due.find((d) => d.cadence === 'PM')!;
    expect(am.inWindow).toBe(true);
    expect(pm.inWindow).toBe(false);
  });

  it('overdueByDays is a sentinel for never-logged metrics', () => {
    // The lib clamps Infinity → 9999 so the value stays
    // JSON-serialisable. The route layer maps that to -1 (never
    // logged) on the wire.
    const due = computeDueMetrics({
      lastLoggedByMetric: new Map(),
      now: noonUtc,
      timezone: 'America/New_York',
    });
    const weight = due.find((d) => d.metric === 'WEIGHT')!;
    expect(weight.lastLoggedAt).toBeNull();
    expect(weight.overdueByDays).toBe(9999);
  });
});