/**
 * Streak counter DST regressions.
 *
 * `getWeighInStreak` and `getMetricStreak` previously compared the
 * user's most recent weigh-in's UTC instant against "today" or
 * "yesterday = today − 24h". On the day after DST fall-back (a
 * 25-hour local day), "yesterday's local midnight" via −24h sits
 * only 23 real hours before today's, so the exact-instant
 * comparison missed and the streak dropped to 0.
 *
 * The fix swaps the instant-equality check for a day-key string
 * comparison via daysBetweenKeys(), so the user's consecutive-day
 * chain is immune to ±1h shifts in UTC instant per local day.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Build a "user" record prisma.user.findUnique returns for tz lookups.
const h = vi.hoisted(() => {
  const USERS: Record<string, { timezone: string | null }> = {};
  const MEASUREMENTS: Array<{ recordedAt: Date }> = [];
  const m = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => USERS[where.id] ?? null),
    },
    measurement: {
      findMany: vi.fn(async () => [...MEASUREMENTS]),
    },
  };
  return { m, USERS, MEASUREMENTS };
});

vi.mock('../lib/prisma', () => ({
  prisma: h.m,
  PrismaRuntime: { AnyNull: Symbol('AnyNull') },
}));

// Pin "now" to the post-fall-back day (US: 2026-11-02 is the
// first day of EST after DST ends). All measurements use
// recordedAt instants at LOCAL midnight of the user's tz so we
// control exactly which calendar day each row lands on.
const POST_FALL_BACK_NOW = new Date('2026-11-02T12:00:00Z');

describe('streaks — DST fall-back (25h day)', () => {
  beforeEach(() => {
    h.USERS.u1 = { timezone: 'America/New_York' };
    h.MEASUREMENTS.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(POST_FALL_BACK_NOW);
  });

  it('keeps the streak alive when yesterday\'s local midnight is exactly 24h+1h before today\'s (EST after fall-back)', async () => {
    // Yesterday (2026-11-01) local midnight in NY = 04:00 UTC
    // (after fall-back to EST, UTC-5). Today (2026-11-02) local
    // midnight = 05:00 UTC. The gap is 25h of wall-clock UTC, but
    // the calendar-day count is still 1 — the OLD code computed
    // `today − 24h` → 04:00 UTC the day before, and exact-instant
    // equality failed because "yesterday's local midnight" was
    // actually 04:00 UTC and "today − 24h" was 04:00 UTC, BUT on
    // the 25h day those two 04:00 instants fall on different UTC
    // days and the comparison still fails in some timezones.
    //
    // The previous-version bug case (specifically): user in
    // America/Chicago (CST = UTC-6). Yesterday local midnight =
    // 06:00 UTC; today local midnight = 06:00 UTC (CST stayed
    // because DST ends earlier). Now consider 2026-11-01 00:30
    // CDT (DST hadn't ended yet; CDT = UTC-5) = 2026-11-01 05:30
    // UTC. Post-fall-back (EST) "today local midnight" is at
    // 2026-11-02 05:00 UTC. today−24h = 2026-11-01 05:00 UTC. The
    // measurement's local-midnight instant was 06:00 UTC on
    // Nov 1 (CST) — doesn't equal 05:00 UTC the OLD code
    // computed, so streak dropped to 0 even though the user's
    // chain was unbroken.
    //
    // Insert measurements at local midnight on:
    //   2026-10-31 (CST, UTC-6) → 06:00 UTC
    //   2026-11-01 (transitioned to EST 06:00 UTC same instant,
    //              but local-midnight UTC was 05:00 on this date)
    //   2026-11-02 (today, EST, UTC-5) → 05:00 UTC
    h.MEASUREMENTS.push(
      { recordedAt: new Date('2026-10-31T06:00:00Z') }, // 00:00 CST
      { recordedAt: new Date('2026-11-01T06:00:00Z') }, // 00:00 CST (DST ends at 02:00 → 01:00 CST)
      { recordedAt: new Date('2026-11-02T05:00:00Z') }, // 00:00 EST (today)
    );

    const { getWeighInStreak } = await import('../lib/streaks');
    const streak = await getWeighInStreak('u1');
    expect(streak.current).toBe(3); // 31st → 1st → 2nd is a clean 3-day chain
    expect(streak.longest).toBe(3);
  });

  it('returns 0 when the streak is genuinely broken across a 25h day', async () => {
    // Last weigh-in was 2 days ago — should still be 0 even
    // though the gap is 49h (2 × 25h after fall-back).
    h.MEASUREMENTS.push({ recordedAt: new Date('2026-10-31T06:00:00Z') });
    const { getWeighInStreak } = await import('../lib/streaks');
    const streak = await getWeighInStreak('u1');
    expect(streak.current).toBe(0);
  });
});

describe('streaks — DST spring-forward (23h day)', () => {
  beforeEach(() => {
    h.USERS.u1 = { timezone: 'America/Chicago' };
    h.MEASUREMENTS.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-09T12:00:00Z')); // Mon after spring-forward
  });

  it('keeps the streak alive when yesterday\'s local midnight is 23h before today\'s (CDT after spring-forward)', async () => {
    // Yesterday Sun 2026-03-08 local midnight CST (UTC-6) = 06:00 UTC.
    // Today Mon 2026-03-09 local midnight CDT (UTC-5) = 05:00 UTC.
    // Gap is 23h of wall-clock UTC. The OLD code computed
    // today−24h = 05:00 UTC on Mar 8, which doesn't match the
    // 06:00 UTC measurement's local-midnight instant.
    h.MEASUREMENTS.push(
      { recordedAt: new Date('2026-03-07T06:00:00Z') }, // 00:00 CST Sat
      { recordedAt: new Date('2026-03-08T06:00:00Z') }, // 00:00 CST Sun (DST starts 02:00 → 03:00 CDT)
      { recordedAt: new Date('2026-03-09T05:00:00Z') }, // 00:00 CDT Mon (today)
    );
    const { getWeighInStreak } = await import('../lib/streaks');
    const streak = await getWeighInStreak('u1');
    expect(streak.current).toBe(3);
    expect(streak.longest).toBe(3);
  });
});