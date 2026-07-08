/**
 * Tests for the batched recovery-history path that backs
 * `RECOVERY_STREAK` quest levels (sanctum-3, sanctum-5,
 * crossroads-4, and their bosses).
 *
 * Before this commit `routes/quest.ts` returned `[]` from
 * `loadRecoveryHistory`, so the streak scanner in
 * `worlds.ts:RECOVERY_STREAK` always saw an empty history and
 * every `>= 7d` / `>= 30d` streak requirement was unsatisfiable.
 *
 * The new `computeRecoveryHistory` does ONE `measurement.findMany`
 * across the whole 90-day window for the 8 TRACKED_METRICS plus a
 * 30-day baseline `groupBy` for HRV / RESTING_HR, then scores each
 * day in memory using the same subscore functions
 * `computeRecoveryForDate` runs for "today".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeRecoveryHistory } from '../lib/recovery';
import { WORLDS, computeRequirementProgress } from '../lib/worlds';
import { localMidnightUtc, localDayKey } from '../lib/timezone';

// ---- Fake measurement table ---------------------------------------------
//
// The recovery module only reads from `measurement` (single findMany)
// and `user`. Mock both so the test is hermetic — no DB or migration
// state needed.

type Row = {
  metric: string;
  value: number;
  recordedAt: Date;
};

const h = vi.hoisted(() => {
  const rows: Row[] = [];
  let userTz: string | null = 'UTC';
  return { rows, getUserTz: () => userTz, setUserTz: (tz: string | null) => { userTz = tz; } };
});

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({ timezone: h.getUserTz() })),
    },
    measurement: {
      findMany: vi.fn(async (args: any) => {
        // Honor the prisma call shape used by the lib: a where
        // clause with `userId`, optional `metric in [...]`, and
        // `recordedAt: { gte: <since> }`.
        const wantUser = args?.where?.userId;
        const wantMetricIn: string[] | undefined = args?.where?.metric?.in;
        const wantGte: Date | undefined = args?.where?.recordedAt?.gte;
        let result = h.rows.filter((r) => r.metric && (!wantUser || true));
        if (wantGte) {
          const gte = wantGte.getTime();
          result = result.filter((r) => r.recordedAt.getTime() >= gte);
        }
        if (Array.isArray(wantMetricIn)) {
          const allowed = new Set(wantMetricIn);
          result = result.filter((r) => allowed.has(r.metric));
        }
        // Order by recordedAt desc to match the lib's expectation.
        return [...result].sort(
          (a, b) => b.recordedAt.getTime() - a.recordedAt.getTime(),
        );
      }),
      groupBy: vi.fn(async (_args: any) => {
        // Compute 30d baselines exactly like the lib does, but
        // batched: one row per metric with both metrics on the
        // same call.
        const out: Array<{ metric: string; _avg: { value: number | null }; _count: { _all: number } }> = [];
        for (const metric of ['HRV', 'RESTING_HR']) {
          const xs = h.rows
            .filter((r) => r.metric === metric)
            .map((r) => r.value);
          const count = xs.length;
          const avg = count > 0 ? xs.reduce((a, b) => a + b, 0) / count : null;
          out.push({ metric, _avg: { value: avg }, _count: { _all: count } });
        }
        return out;
      }),
    },
  },
}));

// Make the user-lookup hook return whatever the test pinned.
const setUserTz = (tz: string | null) => h.setUserTz(tz);

beforeEach(() => {
  h.rows.length = 0;
  setUserTz('UTC');
});

function pushDay(dayKey: string, partial: Partial<Record<string, number>>) {
  // Push a row per metric at 06:00 UTC on the given day.
  const at = new Date(`${dayKey}T06:00:00Z`);
  for (const [metric, value] of Object.entries(partial)) {
    if (typeof value === 'number') {
      h.rows.push({ metric, value, recordedAt: at });
    }
  }
}

describe('computeRecoveryHistory', () => {
  it('returns a non-empty history when the user has logged at least one tracked metric for several days', async () => {
    // Seven consecutive days, all in the last 90d window. Bias
    // the values well above the median line so each day's score
    // clears 70+ (the sanctum-3 / crossroads-4 threshold).
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dk = localDayKey(d, 'UTC');
      pushDay(dk, {
        HRV: 80,
        SLEEP_HOURS: 8,
        RESTING_HR: 50,
        SLEEP_QUALITY: 9,
        SORENESS: 2,
        STRESS: 2,
        ENERGY: 9,
        MOOD: 9,
      });
    }

    const hist = await computeRecoveryHistory('user-1', 90, 'UTC');
    expect(hist.length).toBeGreaterThan(0);
    expect(hist.every((e) => typeof e.score === 'number')).toBe(true);
    expect(hist.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date))).toBe(true);
  });

  it('RECOVERY_STREAK clears at the sanctum-3 threshold (70+ for 7 consecutive days)', () => {
    // Synthetic history directly fed to the streak scanner —
    // exercises the worlds.ts:RECOVERY_STREAK branch.
    const today = localDayKey(new Date(), 'UTC');
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      days.push(localDayKey(d, 'UTC'));
    }
    const history = days.map((d) => ({ date: d, score: d === today ? 85 : 75 }));

    const req = { kind: 'RECOVERY_STREAK' as const, minScore: 70, consecutiveDays: 7 };
    const result = computeRequirementProgress(req, 70, [], [], history);
    expect(result.cleared).toBe(true);
    expect(result.current).toBe(7);
    expect(result.target).toBe(7);
    expect(result.pct).toBe(1);
  });

  it('RECOVERY_STREAK does NOT clear when a single day scores below threshold mid-streak (gap breaks)', () => {
    // Build a 28-day window with a low-scoring day every 4 days.
    // Longest contiguous good run = 3 (< the 7-day threshold).
    const history: Array<{ date: string; score: number }> = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      history.push({ date: localDayKey(d, 'UTC'), score: i % 4 === 0 ? 50 : 80 });
    }

    const req = { kind: 'RECOVERY_STREAK' as const, minScore: 70, consecutiveDays: 7 };
    const result = computeRequirementProgress(req, 70, [], [], history);
    expect(result.cleared).toBe(false);
    // Longest contiguous run = 3 (day-3 → day-1 is 3 good days in
    // a row before the next low day at day-0... or whichever
    // chunk has the most good days). Always < 7.
    expect(result.current).toBeLessThan(7);
  });

  it('RECOVERY_STREAK does NOT clear when a day is missing from the history (gap = missing row)', () => {
    // Same logic as above, but the gap is an ABSENT day rather
    // than a low-scoring day. The scanner resets to 0 on any
    // non-consecutive jump.
    const history: Array<{ date: string; score: number }> = [];
    for (let i = 12; i >= 7; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      history.push({ date: localDayKey(d, 'UTC'), score: 80 });
    }
    // i = 6 (yesterday-6d) is intentionally absent.
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      history.push({ date: localDayKey(d, 'UTC'), score: 80 });
    }

    const req = { kind: 'RECOVERY_STREAK' as const, minScore: 70, consecutiveDays: 7 };
    const result = computeRequirementProgress(req, 70, [], [], history);
    expect(result.cleared).toBe(false);
    // The trailing contiguous run is only 6 days (5..0). The
    // pre-gap run was 6 days too (12..7). Neither clears 7.
    expect(result.current).toBeLessThan(7);
  });

  it('returns an empty array when no measurements exist (graceful no-data)', async () => {
    const hist = await computeRecoveryHistory('user-empty', 90, 'UTC');
    expect(hist).toEqual([]);
  });
});

describe('WORLDS exposes RECOVERY_STREAK levels (sanctum-3, sanctum-5, crossroads-4)', () => {
  // Sanity check: the bug was that the streak scanner got an
  // empty history. These worlds ship RECOVERY_STREAK levels that
  // depend on a non-empty recoveryHistory. Lock that they ARE
  // present and well-formed.
  it('sanctum-3 is 70+ × 7 days', () => {
    const lvl = WORLDS.find((w) => w.id === 'sanctum')!.levels.find((l) => l.id === 'sanctum-3')!;
    expect(lvl.requirement).toEqual({ kind: 'RECOVERY_STREAK', minScore: 70, consecutiveDays: 7 });
  });

  it('sanctum-5 is 80+ × 30 days', () => {
    const lvl = WORLDS.find((w) => w.id === 'sanctum')!.levels.find((l) => l.id === 'sanctum-5')!;
    expect(lvl.requirement).toEqual({ kind: 'RECOVERY_STREAK', minScore: 80, consecutiveDays: 30 });
  });

  it('crossroads-4 is 70+ × 7 days', () => {
    const lvl = WORLDS.find((w) => w.id === 'crossroads')!.levels.find((l) => l.id === 'crossroads-4')!;
    expect(lvl.requirement).toEqual({ kind: 'RECOVERY_STREAK', minScore: 70, consecutiveDays: 7 });
  });
});
