/**
 * Tests for the Hardcore-mode heart-loss sweep in morningReport.ts.
 *
 * Each trigger (missed workout, missed all dailies, substance overuse,
 * zero spiritual) writes a HeartLossEvent row and calls loseHeart.
 * The unique constraint on (userId, kind, sourceDate) makes the
 * sweep idempotent within a local day — re-running the morning-report
 * fetch produces no new rows and no new heart loss.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma with all the methods fireHardcoreHeartPenalties touches.
// The store is hoisted to module scope so the test file can inspect
// it across tests; the factory can't return it via a property of the
// mocked export because `prisma.ts` only re-exports `prisma`.
const store: any = { heartLossEvents: [] as any[], users: new Map() };

vi.mock('../lib/prisma', () => {
  return {
    prisma: {
      user: {
        findUnique: vi.fn(async ({ where, select }: any) => {
          const u = store.users.get(where.id);
          if (!u) return null;
          if (!select) return u;
          const out: any = {};
          for (const k of Object.keys(select)) out[k] = u[k];
          return out;
        }),
      },
      routineDay: { findUnique: vi.fn(async () => null) },
      daily: { findMany: vi.fn(async () => []) },
      dailyLog: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
      workout: { count: vi.fn(async () => 0) },
      substanceLog: {
        groupBy: vi.fn(async () => []),
      },
      prayerLog: { count: vi.fn(async () => 0) },
      heartLossEvent: {
        create: vi.fn(async ({ data }: any) => {
          // Simulate the unique constraint: duplicate (userId, kind, sourceDate) throws.
          const dup = store.heartLossEvents.find((e: any) =>
            e.userId === data.userId
            && e.kind === data.kind
            && e.sourceDate.getTime() === data.sourceDate.getTime(),
          );
          if (dup) {
            const err: any = new Error('Unique constraint violation');
            err.code = 'P2002';
            throw err;
          }
          const row = { id: `hle-${store.heartLossEvents.length + 1}`, firedAt: new Date(), ...data };
          store.heartLossEvents.push(row);
          return row;
        }),
      },
    },
  };
});

// Mock mode.ts so loseHeart is a tracked function but tickHearts
// / the rest still work normally.
vi.mock('../lib/mode', async () => {
  const actual = await vi.importActual<any>('../lib/mode');
  return {
    ...actual,
    loseHeart: vi.fn(async (userId: string) => {
      const u = store.users.get(userId);
      if (u) u.hearts = Math.max(0, (u.hearts ?? 5) - 1);
      return u?.hearts ?? 0;
    }),
  };
});

import { prisma } from '../lib/prisma';
import { loseHeart } from '../lib/mode';
import { fireHardcoreHeartPenalties } from '../lib/morningReport';

const mockedPrisma = prisma as unknown as {
  user: any; routineDay: any; daily: any; dailyLog: any; workout: any;
  substanceLog: any; prayerLog: any; heartLossEvent: any;
};

beforeEach(() => {
  vi.clearAllMocks();
  store.heartLossEvents.length = 0;
  store.users.clear();
  store.users.set('user-hardcore', {
    id: 'user-hardcore',
    mode: 'HARDCORE',
    hearts: 5,
    timezone: 'UTC',
    spiritualDailyPrayers: [],
  });
  store.users.set('user-casual', {
    id: 'user-casual',
    mode: 'CASUAL',
    hearts: 5,
    timezone: 'UTC',
    spiritualDailyPrayers: [],
  });
});

describe('fireHardcoreHeartPenalties — gating', () => {
  it('is a no-op for Casual users', async () => {
    await fireHardcoreHeartPenalties('user-casual', 'UTC');
    expect(store.heartLossEvents.length).toBe(0);
    expect(loseHeart).not.toHaveBeenCalled();
  });
});

describe('fireHardcoreHeartPenalties — triggers', () => {
  it('fires MISSED_WORKOUT when yesterday was a planned workout day with 0 workouts', async () => {
    // Monday's routine says workout = true. (The sweep reads DayOfWeek
    // from yesterday's local date in the user's tz.)
    // NOTE: MISSED_ALL_DAILIES also fires (WORKOUT is always in
    // expectedKeys, so missing a planned workout = missing all
    // dailies too). ZERO_SPIRITUAL also fires because no PrayerLog +
    // no SPIRITUAL:* daily was logged. Three triggers, three hearts.
    mockedPrisma.routineDay.findUnique.mockResolvedValue({ workout: true });
    mockedPrisma.workout.count.mockResolvedValue(0);

    await fireHardcoreHeartPenalties('user-hardcore', 'UTC');

    const kinds = store.heartLossEvents.map((e: any) => e.kind);
    expect(kinds).toContain('MISSED_WORKOUT');
    expect(kinds).toContain('MISSED_ALL_DAILIES');
    expect(kinds).toContain('ZERO_SPIRITUAL');
    expect(loseHeart).toHaveBeenCalledTimes(3);
  });

  it('does NOT fire MISSED_WORKOUT when yesterday was a rest day', async () => {
    mockedPrisma.routineDay.findUnique.mockResolvedValue({ workout: false });
    await fireHardcoreHeartPenalties('user-hardcore', 'UTC');
    expect(store.heartLossEvents.find((e: any) => e.kind === 'MISSED_WORKOUT')).toBeUndefined();
  });

  it('does NOT fire MISSED_WORKOUT when a workout was logged', async () => {
    mockedPrisma.routineDay.findUnique.mockResolvedValue({ workout: true });
    mockedPrisma.workout.count.mockResolvedValue(1);
    await fireHardcoreHeartPenalties('user-hardcore', 'UTC');
    expect(store.heartLossEvents.find((e: any) => e.kind === 'MISSED_WORKOUT')).toBeUndefined();
  });

  it('fires MISSED_ALL_DAILIES when every expected daily was skipped', async () => {
    // User has 2 user dailies + 1 spiritual prayer. None completed.
    mockedPrisma.daily.findMany.mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]);
    store.users.get('user-hardcore').spiritualDailyPrayers = ['ROSARY'];
    mockedPrisma.dailyLog.findMany.mockResolvedValue([]);
    mockedPrisma.dailyLog.count.mockResolvedValue(0);

    await fireHardcoreHeartPenalties('user-hardcore', 'UTC');

    const kinds = store.heartLossEvents.map((e: any) => e.kind);
    expect(kinds).toContain('MISSED_ALL_DAILIES');
  });

  it('fires SUBSTANCE_CAFFEINE when yesterday caffeine > cap', async () => {
    // Yesterday had 4 caffeine logs (cap = 3).
    mockedPrisma.substanceLog.groupBy
      .mockResolvedValueOnce([{ category: 'CAFFEINE', _count: { _all: 4 } }]) // yesterday-only
      .mockResolvedValueOnce([]); // rolling 7d

    await fireHardcoreHeartPenalties('user-hardcore', 'UTC');

    const kinds = store.heartLossEvents.map((e: any) => e.kind);
    expect(kinds).toContain('SUBSTANCE_CAFFEINE');
  });

  it('fires SUBSTANCE_NICOTINE when 7d nicotine > cap (2/week)', async () => {
    // Yesterday-only: 0. Rolling 7d: 3 nicotine logs (cap 2).
    mockedPrisma.substanceLog.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ category: 'NICOTINE', _count: { _all: 3 } }]);

    await fireHardcoreHeartPenalties('user-hardcore', 'UTC');

    const kinds = store.heartLossEvents.map((e: any) => e.kind);
    expect(kinds).toContain('SUBSTANCE_NICOTINE');
  });

  it('fires ZERO_SPIRITUAL when no prayer log + no spiritual daily was logged', async () => {
    mockedPrisma.prayerLog.count.mockResolvedValue(0);
    mockedPrisma.dailyLog.count.mockResolvedValue(0);
    await fireHardcoreHeartPenalties('user-hardcore', 'UTC');
    const kinds = store.heartLossEvents.map((e: any) => e.kind);
    expect(kinds).toContain('ZERO_SPIRITUAL');
  });

  it('does NOT fire ZERO_SPIRITUAL when any prayer was logged', async () => {
    mockedPrisma.prayerLog.count.mockResolvedValue(1);
    await fireHardcoreHeartPenalties('user-hardcore', 'UTC');
    expect(store.heartLossEvents.find((e: any) => e.kind === 'ZERO_SPIRITUAL')).toBeUndefined();
  });
});

describe('fireHardcoreHeartPenalties — idempotency', () => {
  it('does not double-fire the same trigger within the same local day', async () => {
    // First sweep: yesterday was a planned workout day, no workout.
    // MISSED_WORKOUT fires; MISSED_ALL_DAILIES also fires (WORKOUT is
    // always in expectedKeys). Two distinct triggers, two hearts.
    mockedPrisma.routineDay.findUnique.mockResolvedValue({ workout: true });
    mockedPrisma.workout.count.mockResolvedValue(0);

    await fireHardcoreHeartPenalties('user-hardcore', 'UTC');
    expect(store.heartLossEvents.length).toBe(2);
    expect(loseHeart).toHaveBeenCalledTimes(2);

    // Second sweep the same day: should be a no-op for hearts.
    vi.mocked(loseHeart).mockClear();
    await fireHardcoreHeartPenalties('user-hardcore', 'UTC');
    expect(store.heartLossEvents.length).toBe(2); // unchanged
    expect(loseHeart).not.toHaveBeenCalled();
  });

  it('lets multiple distinct triggers fire on the same day (each loses a heart)', async () => {
    // Plan a missed workout AND exceed caffeine cap AND miss spiritual.
    // MISSED_WORKOUT + MISSED_ALL_DAILIES (WORKOUT is expected) +
    // SUBSTANCE_CAFFEINE + ZERO_SPIRITUAL = 4 distinct triggers.
    mockedPrisma.routineDay.findUnique.mockResolvedValue({ workout: true });
    mockedPrisma.workout.count.mockResolvedValue(0);
    mockedPrisma.substanceLog.groupBy
      .mockResolvedValueOnce([{ category: 'CAFFEINE', _count: { _all: 5 } }])
      .mockResolvedValueOnce([]);
    mockedPrisma.prayerLog.count.mockResolvedValue(0);
    mockedPrisma.dailyLog.count.mockResolvedValue(0);

    await fireHardcoreHeartPenalties('user-hardcore', 'UTC');

    const kinds = store.heartLossEvents.map((e: any) => e.kind);
    expect(kinds).toContain('MISSED_WORKOUT');
    expect(kinds).toContain('MISSED_ALL_DAILIES');
    expect(kinds).toContain('SUBSTANCE_CAFFEINE');
    expect(kinds).toContain('ZERO_SPIRITUAL');
    expect(loseHeart).toHaveBeenCalledTimes(4);
    // Hearts dropped from 5 → 1.
    expect(store.users.get('user-hardcore').hearts).toBe(1);
  });
});