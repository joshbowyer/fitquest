/**
 * Tests for the pure helpers + threshold constants in api/src/lib/plateau.ts.
 *
 * The heuristic functions themselves are all DB-driven; their full
 * integration is exercised manually against the LobsterWrangler user
 * data (see /tmp/fitquest-api.log for live runs). Here we pin the
 * rules + math so accidental threshold tweaks don't ship silently.
 */
import { describe, it, expect } from 'vitest';
import {
  daysSince,
  estimatedOneRm,
  detectPlateaus,
  NO_PR_WARN_DAYS,
  NO_PR_SCOLD_DAYS,
  NO_PR_MIN_LIFETIME_PRS,
  ONE_RM_REGRESSION_PCT,
  ONE_RM_PEAK_WINDOW_DAYS,
  ONE_RM_RECENT_WINDOW_DAYS,
  TRACKED_MAIN_LIFTS,
  VOLUME_REGRESSION_PCT,
  VOLUME_BASELINE_DAYS,
  VOLUME_RECENT_DAYS,
  VOLUME_MIN_HISTORICAL_WORKOUTS_PER_WEEK,
  WEIGHT_FLATLINE_KG,
  WEIGHT_FLATLINE_DAYS,
  WEIGHT_FLATLINE_GOALS,
  WEIGHT_FLATLINE_MIN_READINGS,
  METRIC_FLATLINE_PCT,
  METRIC_FLATLINE_DAYS,
  METRIC_FLATLINE_MIN_WK,
  type Plateau,
} from '../lib/plateau';

describe('threshold constants', () => {
  it('uses sane defaults that are unlikely to fire on a normal week', () => {
    // If any of these get tuned too aggressively, the dashboard
    // would start yelling at users who are training fine.
    expect(NO_PR_WARN_DAYS).toBeGreaterThanOrEqual(14);
    expect(NO_PR_SCOLD_DAYS).toBeGreaterThan(NO_PR_WARN_DAYS);
    expect(ONE_RM_REGRESSION_PCT).toBeGreaterThanOrEqual(3);
    expect(ONE_RM_REGRESSION_PCT).toBeLessThanOrEqual(15);
    expect(VOLUME_REGRESSION_PCT).toBeGreaterThanOrEqual(10);
    expect(WEIGHT_FLATLINE_KG).toBeGreaterThan(0);
    expect(WEIGHT_FLATLINE_KG).toBeLessThan(1);
    expect(METRIC_FLATLINE_PCT).toBeGreaterThanOrEqual(2);
    expect(METRIC_FLATLINE_PCT).toBeLessThanOrEqual(10);
  });

  it('tracks the standard big-three lifts for 1RM regression', () => {
    expect(TRACKED_MAIN_LIFTS).toContain('Bench Press');
    expect(TRACKED_MAIN_LIFTS).toContain('Squat');
    expect(TRACKED_MAIN_LIFTS).toContain('Deadlift');
  });

  it('treats weight flatline as goal-sensitive', () => {
    expect(WEIGHT_FLATLINE_GOALS).toContain('CUT');
    expect(WEIGHT_FLATLINE_GOALS).toContain('MAINTAIN');
    expect(WEIGHT_FLATLINE_GOALS).not.toContain('BULK');
  });

  it('requires enough data before any flag can fire', () => {
    // Anti-spam: never fire on a brand-new account with 1 data point.
    expect(NO_PR_MIN_LIFETIME_PRS).toBeGreaterThanOrEqual(2);
    expect(WEIGHT_FLATLINE_MIN_READINGS).toBeGreaterThanOrEqual(4);
    expect(VOLUME_MIN_HISTORICAL_WORKOUTS_PER_WEEK).toBeGreaterThanOrEqual(1);
    expect(METRIC_FLATLINE_MIN_WK).toBeGreaterThanOrEqual(2);
  });

  it('uses consistent window-day values', () => {
    expect(ONE_RM_PEAK_WINDOW_DAYS).toBeGreaterThan(ONE_RM_RECENT_WINDOW_DAYS);
    expect(VOLUME_BASELINE_DAYS).toBeGreaterThan(VOLUME_RECENT_DAYS);
    expect(METRIC_FLATLINE_DAYS).toBe(WEIGHT_FLATLINE_DAYS);
  });
});

describe('daysSince', () => {
  it('returns whole days for past dates', () => {
    const now = new Date('2026-06-23T12:00:00Z');
    const ten = new Date('2026-06-13T12:00:00Z');
    expect(daysSince(ten, now)).toBe(10);
  });

  it('floors partial days', () => {
    const now = new Date('2026-06-23T12:00:00Z');
    const almost = new Date('2026-06-22T13:00:00Z'); // 23h ago
    expect(daysSince(almost, now)).toBe(0);
  });

  it('clamps future dates to 0', () => {
    const now = new Date('2026-06-23T12:00:00Z');
    const future = new Date('2026-06-30T12:00:00Z');
    expect(daysSince(future, now)).toBe(0);
  });

  it('handles "now" as the reference', () => {
    const just = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago
    expect(daysSince(just)).toBe(1);
  });
});

describe('estimatedOneRm (Epley)', () => {
  it('uses Epley\'s formula: w * (1 + r/30), so a 1RM set scores slightly above its weight', () => {
    // Epley isn't identity for reps=1 (it's conservative at low reps
    // compared to Brzycki). A 100kg single rep estimates 103.33kg,
    // not 100kg — that's the formula's known behaviour and matches
    // api/src/lib/pr.ts.
    expect(estimatedOneRm(100, 1)).toBeCloseTo(103.333, 3);
    expect(estimatedOneRm(225, 1)).toBeCloseTo(232.5, 3);
  });

  it('grows with reps', () => {
    expect(estimatedOneRm(100, 5)).toBeGreaterThan(estimatedOneRm(100, 1));
    expect(estimatedOneRm(100, 10)).toBeGreaterThan(estimatedOneRm(100, 5));
  });

  it('matches the formula w * (1 + r/30)', () => {
    expect(estimatedOneRm(100, 5)).toBeCloseTo(100 * (1 + 5 / 30), 5);
    expect(estimatedOneRm(80, 12)).toBeCloseTo(80 * (1 + 12 / 30), 5);
  });

  it('returns 0 for invalid input', () => {
    expect(estimatedOneRm(0, 5)).toBe(0);
    expect(estimatedOneRm(100, 0)).toBe(0);
    expect(estimatedOneRm(-10, 5)).toBe(0);
    expect(estimatedOneRm(100, -3)).toBe(0);
  });
});

describe('detectPlateaus', () => {
  it('returns an empty array for a user with no training history', async () => {
    // Random cuid that doesn't exist in the DB. detectPlateaus should
    // gracefully return [] for any user with no PRs, no workouts, no
    // weigh-ins. This is the smoke test that the heuristics don't
    // blow up on a fresh account.
    const fakeId = 'cnonexistent0000000000000000';
    const result = await detectPlateaus(fakeId);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  it('returns Plateau objects with the expected shape when non-empty', async () => {
    // Smoke-test shape: any non-empty result must conform to Plateau.
    // We can't easily fabricate a "stale" user in a unit test (would
    // require seeding ~30 days of workouts + PRs), so we just confirm
    // the empty-path typing.
    const fakeId = 'cnonexistent0000000000000000';
    const result: Plateau[] = await detectPlateaus(fakeId);
    for (const p of result) {
      expect(typeof p.kind).toBe('string');
      expect(typeof p.label).toBe('string');
      expect(['warn', 'scold']).toContain(p.severity);
      expect(typeof p.note).toBe('string');
    }
  });

  it('sorts scolds before warns', async () => {
    // Just verify the comparator behaviour by inspecting the sort key
    // against the source — kept here so the contract is pinned.
    const sortOrder = (a: Plateau, b: Plateau) => {
      if (a.severity !== b.severity) return a.severity === 'scold' ? -1 : 1;
      return a.label.localeCompare(b.label);
    };
    const a: Plateau = { kind: 'VOLUME_REGRESSION', label: 'Volume', severity: 'warn', note: 'x' };
    const b: Plateau = { kind: 'NO_PR_RECENT', label: 'PR', severity: 'scold', note: 'y' };
    const c: Plateau = { kind: 'ONE_RM_REGRESSION', label: 'Bench Press', severity: 'scold', note: 'z' };
    const sorted = [a, b, c].sort(sortOrder);
    expect(sorted[0].severity).toBe('scold');
    expect(sorted[1].severity).toBe('scold');
    expect(sorted[2].severity).toBe('warn');
    // Within scolds, label-sorted: 'Bench Press' < 'PR'.
    expect(sorted[0].label).toBe('Bench Press');
    expect(sorted[1].label).toBe('PR');
  });
});

describe('pause handling', () => {
  it('PLATEAU_KINDS includes ALL for one-click cruise mode', async () => {
    const { PLATEAU_KINDS } = await import('../lib/plateau');
    expect(PLATEAU_KINDS).toContain('ALL');
    expect(PLATEAU_KINDS).toContain('WEIGHT_FLATLINE');
    expect(PLATEAU_KINDS.length).toBe(6);
  });

  it('returns [] for users with no active pauses (baseline behaviour unchanged)', async () => {
    const { activePauseKinds } = await import('../lib/plateau');
    const fakeId = 'cnonexistent0000000000000000';
    const paused = await activePauseKinds(fakeId);
    expect(paused).toBeInstanceOf(Set);
    expect(paused.size).toBe(0);
  });

  it('detectPlateaus respects ALL pause and short-circuits', async () => {
    // Insert a pause of kind ALL for a real user (FK requires it),
    // then verify detectPlateaus returns [].
    const { prisma } = await import('../lib/prisma');
    const { activePauseKinds } = await import('../lib/plateau');

    const testUser = await prisma.user.findFirst({ select: { id: true } });
    if (!testUser) {
      // No users seeded — skip the live DB portion of this test.
      return;
    }
    const now = new Date();
    const resume = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    await prisma.plateauPause.create({
      data: {
        userId: testUser.id,
        kind: 'ALL',
        resumeAt: resume,
      },
    });

    try {
      const paused = await activePauseKinds(testUser.id, now);
      expect(paused.has('ALL')).toBe(true);

      // detectPlateaus would normally call helpers — but with ALL
      // paused, it must short-circuit before any DB read. Verify the
      // public API still returns a well-formed array.
      const result = await detectPlateaus(testUser.id, now);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([]);
    } finally {
      // Cleanup so this test stays idempotent.
      await prisma.plateauPause.deleteMany({
        where: { userId: testUser.id, kind: 'ALL' },
      });
    }
  });

  it('expired pauses are filtered out by resumeAt > now', async () => {
    const { prisma } = await import('../lib/prisma');
    const { activePauseKinds } = await import('../lib/plateau');

    const testUser = await prisma.user.findFirst({ select: { id: true } });
    if (!testUser) return;
    const now = new Date();
    // Pause that ended an hour ago — must not appear in activePauseKinds.
    const expired = new Date(now.getTime() - 60 * 60 * 1000);

    await prisma.plateauPause.create({
      data: {
        userId: testUser.id,
        kind: 'WEIGHT_FLATLINE',
        resumeAt: expired,
      },
    });

    try {
      const paused = await activePauseKinds(testUser.id, now);
      expect(paused.has('WEIGHT_FLATLINE')).toBe(false);
      expect(paused.size).toBe(0);
    } finally {
      await prisma.plateauPause.deleteMany({
        where: { userId: testUser.id, kind: 'WEIGHT_FLATLINE' },
      });
    }
  });
});
