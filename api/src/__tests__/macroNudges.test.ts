/**
 * Tests for the pure rule functions in api/src/lib/macroNudges.ts.
 * No DB access — exercises the rule shapes only. Integration is
 * verified manually against LobsterWrangler's real data.
 */
import { describe, it, expect } from 'vitest';
import {
  caffeinePreWorkoutRule,
  caffeineLateRule,
  caffeineClusterRule,
  creatineGapRule,
  hydrationLowRule,
  CAFFEINE_PRE_WORKOUT_MIN_MIN,
  CAFFEINE_PRE_WORKOUT_MAX_MIN,
  CAFFEINE_LATE_CUTOFF_HOUR,
  CAFFEINE_CLUSTER_THRESHOLD,
  CREATINE_GAP_THRESHOLD,
  HYDRATION_SHORTFALL_ML,
  type Nudge,
} from '../lib/macroNudges';

const now = new Date('2026-06-23T16:00:00Z'); // 12:00 EDT

describe('thresholds', () => {
  it('uses sane defaults', () => {
    expect(CAFFEINE_PRE_WORKOUT_MIN_MIN).toBeGreaterThanOrEqual(10);
    expect(CAFFEINE_PRE_WORKOUT_MAX_MIN).toBeLessThanOrEqual(120);
    expect(CAFFEINE_LATE_CUTOFF_HOUR).toBeGreaterThanOrEqual(12);
    expect(CAFFEINE_LATE_CUTOFF_HOUR).toBeLessThanOrEqual(16);
    expect(CAFFEINE_CLUSTER_THRESHOLD).toBeGreaterThanOrEqual(3);
    expect(CREATINE_GAP_THRESHOLD).toBe(3);
    expect(HYDRATION_SHORTFALL_ML).toBeGreaterThanOrEqual(300);
    expect(HYDRATION_SHORTFALL_ML).toBeLessThanOrEqual(1000);
  });
});

describe('caffeinePreWorkoutRule', () => {
  it('returns null when there is no recent workout', () => {
    expect(
      caffeinePreWorkoutRule(
        [],
        [{ loggedAt: new Date(now.getTime() - 30 * 60 * 1000) }],
        now,
      ),
    ).toBe(null);
  });

  it('returns null when caffeine is too close to workout (< 15min)', () => {
    expect(
      caffeinePreWorkoutRule(
        [{ performedAt: now }],
        [{ loggedAt: new Date(now.getTime() - 5 * 60 * 1000) }], // 5min before
        now,
      ),
    ).toBe(null);
  });

  it('returns null when caffeine is too far from workout (> 90min)', () => {
    expect(
      caffeinePreWorkoutRule(
        [{ performedAt: now }],
        [{ loggedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000) }], // 2h before
        now,
      ),
    ).toBe(null);
  });

  it('returns a positive nudge when caffeine is in the 15-90min window', () => {
    const nudge = caffeinePreWorkoutRule(
      [{ performedAt: now }],
      [{ loggedAt: new Date(now.getTime() - 45 * 60 * 1000) }], // 45min before
      now,
    );
    expect(nudge).toBeTruthy();
    expect(nudge!.severity).toBe('positive');
    expect(nudge!.note).toContain('45m before');
  });

  it('accepts the lower bound (15min exactly)', () => {
    const nudge = caffeinePreWorkoutRule(
      [{ performedAt: now }],
      [{ loggedAt: new Date(now.getTime() - CAFFEINE_PRE_WORKOUT_MIN_MIN * 60 * 1000) }],
      now,
    );
    expect(nudge).toBeTruthy();
  });

  it('accepts the upper bound (90min exactly)', () => {
    const nudge = caffeinePreWorkoutRule(
      [{ performedAt: now }],
      [{ loggedAt: new Date(now.getTime() - CAFFEINE_PRE_WORKOUT_MAX_MIN * 60 * 1000) }],
      now,
    );
    expect(nudge).toBeTruthy();
  });

  it('ignores caffeine after the workout', () => {
    expect(
      caffeinePreWorkoutRule(
        [{ performedAt: now }],
        [{ loggedAt: new Date(now.getTime() + 30 * 60 * 1000) }],
        now,
      ),
    ).toBe(null);
  });
});

describe('caffeineLateRule', () => {
  it('returns null when no recent caffeine exists', () => {
    expect(caffeineLateRule([], [], now, 'America/New_York')).toBe(null);
  });

  it('returns null when HRV has not dipped', () => {
    // Caffeine at 15:00 EDT (after 14:00 cutoff).
    const lateCaffeine = {
      loggedAt: new Date('2026-06-23T19:00:00Z'), // 15:00 EDT
    };
    const hrvBaseline = Array.from({ length: 14 }, (_, i) => ({
      value: 60,
      recordedAt: new Date(now.getTime() - (i + 1) * 24 * 60 * 60 * 1000),
    }));
    const hrvRecent = [
      { value: 60, recordedAt: new Date(now.getTime() - 6 * 60 * 60 * 1000) },
    ];
    expect(caffeineLateRule([lateCaffeine], [...hrvBaseline, ...hrvRecent], now, 'America/New_York')).toBe(null);
  });

  it('warns when late caffeine coincides with HRV dip', () => {
    // Caffeine 1h before now → 11:00 EDT. But test needs a caffeine
    // entry AFTER 14:00 local AND within the 6h lookback. Set
    // caffeine at 14:30 EDT = 18:30 UTC. Since "now" in this test
    // is 16:00 UTC = 12:00 EDT, caffeine at 18:30 UTC is in the
    // future — bump now to 19:00 UTC (15:00 EDT) so the 18:30 UTC
    // caffeine lands in the lookback.
    const testNow = new Date('2026-06-23T19:00:00Z');
    const lateCaffeine = {
      loggedAt: new Date('2026-06-23T18:30:00Z'), // 14:30 EDT (after 14:00)
    };
    const hrvBaseline = Array.from({ length: 14 }, (_, i) => ({
      value: 60,
      recordedAt: new Date(testNow.getTime() - (i + 1) * 24 * 60 * 60 * 1000),
    }));
    const hrvRecent = [
      { value: 50, recordedAt: new Date(testNow.getTime() - 2 * 60 * 60 * 1000) }, // 16% dip
    ];
    const nudge = caffeineLateRule(
      [lateCaffeine],
      [...hrvBaseline, ...hrvRecent],
      testNow,
      'America/New_York',
    );
    expect(nudge).toBeTruthy();
    expect(nudge!.severity).toBe('warn');
    expect(nudge!.note).toContain('14:00');
  });

  it('returns null when not enough HRV history for a baseline', () => {
    const lateCaffeine = {
      loggedAt: new Date('2026-06-23T19:00:00Z'),
    };
    const hrvRecent = [
      { value: 40, recordedAt: new Date(now.getTime() - 6 * 60 * 60 * 1000) },
    ];
    expect(caffeineLateRule([lateCaffeine], hrvRecent, now, 'America/New_York')).toBe(null);
  });
});

describe('caffeineClusterRule', () => {
  it('returns null below threshold', () => {
    expect(
      caffeineClusterRule(
        Array.from({ length: CAFFEINE_CLUSTER_THRESHOLD - 1 }, (_, i) => ({
          loggedAt: new Date(now.getTime() - i * 60 * 60 * 1000),
        })),
        now,
      ),
    ).toBe(null);
  });

  it('warns at or above threshold', () => {
    const nudge = caffeineClusterRule(
      Array.from({ length: CAFFEINE_CLUSTER_THRESHOLD }, (_, i) => ({
        loggedAt: new Date(now.getTime() - i * 60 * 60 * 1000),
      })),
      now,
    );
    expect(nudge).toBeTruthy();
    expect(nudge!.severity).toBe('warn');
    expect(nudge!.note).toContain(String(CAFFEINE_CLUSTER_THRESHOLD));
  });

  it('ignores caffeine older than 24h', () => {
    const nudge = caffeineClusterRule(
      [
        ...Array.from({ length: CAFFEINE_CLUSTER_THRESHOLD }, (_, i) => ({
          loggedAt: new Date(now.getTime() - (i + 25) * 60 * 60 * 1000), // > 24h ago
        })),
      ],
      now,
    );
    expect(nudge).toBe(null);
  });
});

describe('creatineGapRule', () => {
  it('returns null when user is not on creatine', () => {
    expect(
      creatineGapRule(false, [{ takenAt: now }], now),
    ).toBe(null);
  });

  it('returns null when user is on creatine but has zero logs (still starting)', () => {
    expect(creatineGapRule(true, [], now)).toBe(null);
  });

  it('warns when user has 1-2 logs in last 7 days', () => {
    const nudge = creatineGapRule(
      true,
      [
        { takenAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) },
      ],
      now,
    );
    expect(nudge).toBeTruthy();
    expect(nudge!.severity).toBe('warn');
    expect(nudge!.note).toContain('1 of the last 7');
  });

  it('does not warn at exactly the threshold', () => {
    const nudge = creatineGapRule(
      true,
      Array.from({ length: CREATINE_GAP_THRESHOLD }, (_, i) => ({
        takenAt: new Date(now.getTime() - (i + 1) * 24 * 60 * 60 * 1000),
      })),
      now,
    );
    expect(nudge).toBe(null);
  });

  it('does not warn above the threshold', () => {
    const nudge = creatineGapRule(
      true,
      Array.from({ length: CREATINE_GAP_THRESHOLD + 2 }, (_, i) => ({
        takenAt: new Date(now.getTime() - i * 24 * 60 * 60 * 1000),
      })),
      now,
    );
    expect(nudge).toBe(null);
  });
});

describe('hydrationLowRule', () => {
  it('returns null with no data', () => {
    expect(hydrationLowRule([], 2128, now)).toBe(null);
  });

  it('returns null with fewer than 3 days of data', () => {
    const nudge = hydrationLowRule(
      [
        { value: 500, recordedAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) },
        { value: 500, recordedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) },
      ],
      2128,
      now,
    );
    expect(nudge).toBe(null);
  });

  it('warns when avg daily water is >500ml below target', () => {
    const nudge = hydrationLowRule(
      Array.from({ length: 7 }, (_, i) => ({
        // 1500ml/day for 7 days → shortfall 628 vs target 2128
        value: 1500,
        recordedAt: new Date(now.getTime() - i * 24 * 60 * 60 * 1000),
      })),
      2128,
      now,
    );
    expect(nudge).toBeTruthy();
    expect(nudge!.severity).toBe('warn');
    expect(nudge!.note).toContain('1500ml');
    expect(nudge!.note).toContain('628ml short');
  });

  it('does not warn when avg is within HYDRATION_SHORTFALL_ML of target', () => {
    // 2000ml/day vs target 2128 → shortfall 128, well under 500.
    const nudge = hydrationLowRule(
      Array.from({ length: 7 }, (_, i) => ({
        value: 2000,
        recordedAt: new Date(now.getTime() - i * 24 * 60 * 60 * 1000),
      })),
      2128,
      now,
    );
    expect(nudge).toBe(null);
  });

  it('aggregates multiple entries per day correctly', () => {
    // Three sips per day = 3 * 200 = 600ml/day, well below target.
    const nudge = hydrationLowRule(
      Array.from({ length: 7 }, (_, d) =>
        [0, 4, 8].map((h) => ({
          value: 200,
          recordedAt: new Date(now.getTime() - d * 24 * 60 * 60 * 1000 - h * 60 * 60 * 1000),
        })),
      ).flat(),
      2128,
      now,
    );
    expect(nudge).toBeTruthy();
    expect(nudge!.note).toContain('600ml');
  });
});
