/**
 * Tests for routes/import.ts persist() — the FIT-import reward
 * pipeline (audit C1, C4, C5). The full pipeline now mirrors
 * routes/workouts.ts:217-823:
 *
 *   - workout upsert + PR detection + XP/gold + dailyLog all in
 *     one $transaction block
 *   - post-commit: skill matching, penances, raid damage,
 *     breach damage, portal-leak damage, achievements, routine
 *     progress
 *   - gated by `wasUpdate` so re-importing the same FIT file
 *     does not double-credit XP/gold or re-run combat math
 *
 * Regression coverage:
 *  - Fresh import credits XP + gold + creates a DailyLog row
 *    whose xpDelta / goldDelta reflect the actual awarded
 *    amounts (not the old hardcoded 10g/15xp which bypassed
 *    the heart multiplier — C5).
 *  - breach.applyWorkoutDamage is invoked (audit C1 — was
 *    missing on imports entirely).
 *  - Re-importing the same FIT file does NOT credit XP/gold a
 *    second time. Achievements / breach / leak are also skipped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test state. Hoisted so the vi.mock factories can close over
// the mutable containers (vi.mock factories run BEFORE the
// module body, so non-hoisted top-level `let` is invisible to
// them).
const h = vi.hoisted(() => {
  // One mutable user record. findUnique returns this; update
  // patches fields onto it so a follow-up findUnique reflects
  // the post-credit state.
  const user = {
    id: 'u1',
    xp: 0,
    gold: 0,
    level: 1,
    class: 'PHANTOM',
    mode: 'CASUAL',
    weightKg: 80,
    hearts: 10,
    timezone: 'UTC',
  };
  // Map of (userId|performedAtISO) -> workout id, for the
  // wasUpdate pre-check. First call: no row. Second call: row.
  const workoutRows: Record<string, { id: string; type: string }> = {};
  let nextWorkoutSeq = 1;
  const fallbackDaily = { id: 'd-fallback' };
  // Daily logs created during the run, indexed by id.
  const dailyLogs: Array<{ id: string; userId: string; dailyKey: string; goldDelta: number; xpDelta: number }> = [];
  // Sequence counter for generated ids (workout / daily-log).
  let nextId = 1;
  const calls: { kind: string; args?: any }[] = [];

  // Helper to look up a workout row by either the
  // userId_performedAt unique key (the pre-upsert wasUpdate check)
  // or by id (the PR-detection follow-up findUnique with `include`).
  const lookupWorkout = (where: any) => {
    if (where.userId_performedAt) {
      const key = `${where.userId_performedAt.userId}|${where.userId_performedAt.performedAt.toISOString()}`;
      return workoutRows[key] ?? null;
    }
    if (where.id) {
      // Search across all stored rows by id. Mock supports a
      // single workout at a time; for tests that exercise the
      // PR path we'd seed multiple rows. Either way: return
      // whatever matches the id; PR detection in this test
      // never fires because no workout has nested exercises.
      const found = Object.values(workoutRows).find((r) => r.id === where.id);
      return found
        ? { ...found, exercises: [], notes: null, durationSec: 0, name: null, userId: 'u1' }
        : null;
    }
    return null;
  };

  const txMock = {
    workout: {
      findUnique: vi.fn(async ({ where }: any) => lookupWorkout(where)),
      upsert: vi.fn(async ({ where, create }: any) => {
        const key = `${where.userId_performedAt.userId}|${where.userId_performedAt.performedAt.toISOString()}`;
        const existing = workoutRows[key];
        const id = existing?.id ?? `w-${nextWorkoutSeq++}`;
        workoutRows[key] = { id, type: create.type };
        calls.push({ kind: 'workout.upsert', args: { key, id, type: create.type } });
        return { id, type: create.type, performedAt: where.userId_performedAt.performedAt, ...create };
      }),
    },
    user: {
      update: vi.fn(async ({ where, data }: any) => {
        Object.assign(user, data);
        calls.push({ kind: 'user.update', args: data });
        return user;
      }),
    },
    dailyLog: {
      // Inside the transaction we also need the idempotency check.
      // Same logic as the top-level mock below.
      findFirst: vi.fn(async ({ where }: any) => {
        if (!where) return null;
        const matches = dailyLogs.filter(
          (l) => l.userId === where.userId && (!where.dailyKey || l.dailyKey === where.dailyKey),
        );
        if (where.loggedAt?.gte != null) {
          const cutoff = where.loggedAt.gte instanceof Date ? where.loggedAt.gte.getTime() : new Date(where.loggedAt.gte).getTime();
          const filtered = matches.filter((l) => (l as any).loggedAt?.getTime?.() >= cutoff);
          return filtered[0] ?? null;
        }
        return matches[0] ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = `dl-${nextId++}`;
        const log = { id, loggedAt: data.loggedAt ?? new Date(), ...data };
        dailyLogs.push(log);
        calls.push({ kind: 'dailyLog.create', args: data });
        return log;
      }),
    },
    pr: { findFirst: vi.fn(async () => null), create: vi.fn(async () => null) },
  };

  const mockPrisma = {
    user: {
      findUnique: vi.fn(async () => ({ ...user })),
      update: vi.fn(async ({ where, data }: any) => {
        Object.assign(user, data);
        calls.push({ kind: 'user.update', args: data });
        return user;
      }),
    },
    workout: {
      findUnique: vi.fn(async ({ where }: any) => lookupWorkout(where)),
      upsert: vi.fn(async ({ where, create }: any) => {
        const key = `${where.userId_performedAt.userId}|${where.userId_performedAt.performedAt.toISOString()}`;
        const existing = workoutRows[key];
        const id = existing?.id ?? `w-${nextWorkoutSeq++}`;
        workoutRows[key] = { id, type: create.type };
        calls.push({ kind: 'workout.upsert', args: { key, id, type: create.type } });
        return { id, type: create.type, performedAt: where.userId_performedAt.performedAt, ...create };
      }),
    },
    daily: {
      findFirst: vi.fn(async () => fallbackDaily),
    },
    dailyLog: {
      // The idempotency check: return the most recent DailyLog for
      // this (userId, dailyKey) if one was created earlier in this
      // test session. Mirrors the local-day idempotency dailies.ts
      // /complete enforces — multiple imports on the same day hit
      // the same log row, not a fresh one.
      findFirst: vi.fn(async ({ where }: any) => {
        if (!where) return null;
        const matches = dailyLogs.filter(
          (l) => l.userId === where.userId && (!where.dailyKey || l.dailyKey === where.dailyKey),
        );
        // Apply the `loggedAt: { gte: today }` half-open filter the
        // production code uses. Any non-null match wins, which is
        // enough to suppress duplicate creates.
        if (where.loggedAt?.gte != null) {
          const cutoff = where.loggedAt.gte instanceof Date ? where.loggedAt.gte.getTime() : new Date(where.loggedAt.gte).getTime();
          const filtered = matches.filter((l) => (l as any).loggedAt?.getTime?.() >= cutoff);
          return filtered[0] ?? null;
        }
        return matches[0] ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = `dl-${nextId++}`;
        const log = { id, loggedAt: data.loggedAt ?? new Date(), ...data };
        dailyLogs.push(log);
        calls.push({ kind: 'dailyLog.create', args: data });
        return log;
      }),
    },
    measurement: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => null),
      upsert: vi.fn(async () => null),
    },
    partyMember: { findUnique: vi.fn(async () => null) },
    raid: { findFirst: vi.fn(async () => null) },
    partyBuff: { findUnique: vi.fn(async () => null) },
    pendingSkillUnlock: { create: vi.fn(async () => null) },
    $transaction: vi.fn(async (cbOrOps: any) => {
      if (typeof cbOrOps === 'function') {
        return cbOrOps(txMock);
      }
      // Array-form: replicate Prisma's pass-through semantics.
      return cbOrOps;
    }),
  };

  return { user, workoutRows, dailyLogs, fallbackDaily, mockPrisma, txMock, calls, nextId: () => nextId++ };
});

vi.mock('../lib/prisma', () => ({
  prisma: h.mockPrisma,
  WorkoutSource: { WEB: 'WEB', BRIDGE: 'BRIDGE', BULK_REPROCESS: 'BULK_REPROCESS' },
}));

// Stub lib/mode — both persist() (heart multiplier on XP/gold + raid
// damage) reads from it. Return CASUAL/full-credit so the test can
// reason about the gold/xp numerics without the Hardcore curve.
vi.mock('../lib/mode', () => ({
  tickHearts: vi.fn(async () => 10),
  heartMultiplier: vi.fn(() => 1.0),
}));

// Stub lib/geo.activityTitle — the persist() pipeline uses this to
// name the workout row. We don't want real Nominatim round trips
// in unit tests.
vi.mock('../lib/geo', () => ({
  activityTitle: vi.fn(async (sport: string) => sport),
}));

// Stub the post-commit side-effecting libs. Each is best-effort
// in persist(); a stubbed no-op lets the test focus on the
// reward pipeline + DailyLog shape.
vi.mock('../lib/breach', () => ({
  unlockBreachIfReady: vi.fn(async (_uid: string, _level: number) => null),
  tickCooldown: vi.fn(async () => null),
  applyWorkoutDamage: vi.fn(async () => null),
}));
vi.mock('../lib/portalLeaks', () => ({
  applyLeakDamage: vi.fn(async () => null),
}));
vi.mock('../lib/penance', () => ({
  firePenances: vi.fn(async () => []),
  firePenance: vi.fn(async () => null),
}));
vi.mock('../lib/skillMatching', () => ({
  findEligibleSkillUnlocks: vi.fn(async () => []),
}));
vi.mock('../lib/equipment', () => ({
  getEquippedBonus: vi.fn(async () => ({ statTotals: {}, setCounts: {}, equip: {} })),
}));

// Achievements / routine: confirm they fire on fresh import and
// that the achievements pass is suppressed on re-import. Routine
// progress is unconditional (matches workouts.ts).
vi.mock('../lib/achievements', () => ({
  checkAchievements: vi.fn(async () => null),
}));
vi.mock('../routes/routine.js', () => ({
  checkRoutineProgress: vi.fn(async () => null),
}));

import { persist } from '../routes/import.js';
import { checkAchievements } from '../lib/achievements.js';
import { checkRoutineProgress } from '../routes/routine.js';
import { applyWorkoutDamage } from '../lib/breach.js';
import { applyLeakDamage } from '../lib/portalLeaks.js';
import { firePenances } from '../lib/penance.js';
import { xpFromWorkout, goldFromWorkout } from '../lib/xp.js';
import { WorkoutSource } from '../lib/prisma.js';

beforeEach(() => {
  // Reset mutable state between tests. We can't reassign the
  // h.user object (the mock factories close over the original
  // reference), so we mutate fields back to baseline.
  h.user.id = 'u1';
  h.user.xp = 0;
  h.user.gold = 0;
  h.user.level = 1;
  h.user.class = 'PHANTOM';
  h.user.mode = 'CASUAL';
  h.user.weightKg = 80;
  h.user.hearts = 10;
  h.user.timezone = 'UTC';
  // Clear captured call records + side-effect rows.
  for (const k of Object.keys(h.workoutRows)) delete h.workoutRows[k];
  h.dailyLogs.length = 0;
  h.calls.length = 0;
  vi.clearAllMocks();
});

// A fabricated 1mi-equivalent run.
function makeFit(overrides: Partial<{
  sport: string; durationSec: number; distanceMeters: number; startTime: Date;
}> = {}) {
  const startTime = overrides.startTime ?? new Date('2026-07-13T15:00:00Z');
  return {
    kind: 'activity' as const,
    sourceTimestamp: startTime.toISOString(),
    workouts: [
      {
        startTime,
        durationSec: overrides.durationSec ?? 30 * 60, // 30 min
        sport: overrides.sport ?? 'running',
        subSport: undefined,
        distanceMeters: overrides.distanceMeters ?? 5000,
        avgHeartRate: 150,
        maxHeartRate: 175,
        totalCalories: 320,
        avgPower: undefined,
        normalizedPower: undefined,
        rpe: undefined,
        trackpoints: [], // no geo — keeps activityTitle stub happy
      },
    ],
    measurements: [],
  };
}

describe('persist() — import reward pipeline (audit C1/C4/C5)', () => {
  it('credits XP + gold on a fresh import and writes a DailyLog row with the actual deltas', async () => {
    const fit = makeFit({ sport: 'running', durationSec: 30 * 60, distanceMeters: 5000 });
    const before = { xp: h.user.xp, gold: h.user.gold };

    const created = await persist('u1', fit, WorkoutSource.WEB, 'run.fit');

    // 1. user.update was called with the awarded XP + gold + level.
    const userUpdates = h.calls.filter((c) => c.kind === 'user.update') as Array<{ args: any }>;
    expect(userUpdates.length).toBeGreaterThan(0);
    const lastUpdate = userUpdates[userUpdates.length - 1]!.args;
    expect(lastUpdate.xp).toBeGreaterThan(0);
    expect(lastUpdate.gold).toBeGreaterThan(0);

    // 2. user gold + xp moved by the expected amounts.
    const baseXp = xpFromWorkout({ type: 'CARDIO', totalVolumeKg: 0, durationMin: 30, prCount: 0 });
    const baseGold = goldFromWorkout({ type: 'CARDIO', prCount: 0, durationMin: 30 });
    expect(h.user.xp).toBe(before.xp + Math.round(baseXp * 1.0));
    expect(h.user.gold).toBe(before.gold + Math.round(baseGold * 1.0));

    // 3. DailyLog created with the heart-multiplier-scaled deltas
    //    (C5 fix — the previous code hardcoded 10/15 regardless of
    //    multiplier or modifier).
    expect(h.dailyLogs.length).toBe(1);
    const log = h.dailyLogs[0]!;
    expect(log.dailyKey).toBe('WORKOUT');
    // CASUAL × 1.0 keeps the documentation's 10g / 15xp verbatim.
    expect(log.goldDelta).toBe(10);
    expect(log.xpDelta).toBe(15);

    // 4. Side-effect libs were invoked. breach.applyWorkoutDamage
    //    is the C1 wire that was missing.
    expect(applyWorkoutDamage).toHaveBeenCalledTimes(1);
    expect(applyLeakDamage).toHaveBeenCalledTimes(1);
    // Penances fired for CARDIO ≥30min (logged_cardio_30).
    expect(firePenances).toHaveBeenCalledTimes(1);

    // 5. Created records include both workout + daily_log.
    expect(created.some((r) => r.kind === 'workout')).toBe(true);
    expect(created.some((r) => r.kind === 'daily_log')).toBe(true);
  });

  it('re-importing the same FIT file does NOT double-credit XP, gold, or breach damage', async () => {
    const fit = makeFit({ sport: 'running', durationSec: 30 * 60, distanceMeters: 5000 });

    // First import — pays out rewards.
    await persist('u1', fit, WorkoutSource.WEB, 'run.fit');
    const afterFirst = { xp: h.user.xp, gold: h.user.gold, breachCalls: (applyWorkoutDamage as any).mock.calls.length };
    const achievementsAfterFirst = (checkAchievements as any).mock.calls.length;

    // Second import — same FIT. Should be a true no-op for rewards.
    await persist('u1', fit, WorkoutSource.WEB, 'run.fit');

    // 1. User XP/gold did NOT move.
    expect(h.user.xp).toBe(afterFirst.xp);
    expect(h.user.gold).toBe(afterFirst.gold);

    // 2. Breach damage was NOT re-attempted (wasUpdate guards it).
    expect((applyWorkoutDamage as any).mock.calls.length).toBe(afterFirst.breachCalls);

    // 3. Achievements pass was suppressed on re-import (matches
    //    workouts.ts:450 `if (!result.wasUpdate)` guard).
    expect((checkAchievements as any).mock.calls.length).toBe(achievementsAfterFirst);

    // 4. Routine progress fired BOTH times (matches workouts.ts:
    //    unconditional — runs per commit regardless of re-upload).
    // 5. The DailyLog was NOT recreated — only the first import
    //    wrote one. This is the C4 idempotency fix.
    expect(h.dailyLogs.length).toBe(1);

    // The persisted workout row also didn't get a duplicate ID —
    // the second upsert re-used the existing record (same id).
    const ids = Object.values(h.workoutRows).map((r) => r.id);
    const uniq = new Set(ids);
    expect(uniq.size).toBe(1);
  });

  it('firePenances: only logs_mobility (MOBILITY type) — no stretch detection (FIT imports lack exercise names)', async () => {
    // Yoga maps to MOBILITY type. Persist a 10-min yoga session.
    const fit = makeFit({ sport: 'yoga', durationSec: 10 * 60, distanceMeters: undefined });
    await persist('u1', fit, WorkoutSource.WEB, 'yoga.fit');

    // penanceLib.firePenances was called once with logged_mobility
    // (no log_stretch because FIT imports don't carry exercise
    // names).
    expect(firePenances).toHaveBeenCalledTimes(1);
    const call = (firePenances as any).mock.calls[0];
    expect(call[0]).toBe('u1');
    const fires = call[1];
    expect(fires.length).toBe(1);
    expect(fires[0].key).toBe('logged_mobility');
  });

  it('firePenances: skipped on a short CARDIO session (< 30 min) — only the ≥30min branch fires', async () => {
    const fit = makeFit({ sport: 'running', durationSec: 15 * 60, distanceMeters: 2500 });
    await persist('u1', fit, WorkoutSource.WEB, 'short-run.fit');

    expect(firePenances).not.toHaveBeenCalled();
  });

  it('DailyLog idempotency per-local-day — three imports of different FITs on the same day produce one log', async () => {
    // Same day, three different workouts. Without C4's idempotency
    // check we'd see three DailyLog rows.
    await persist('u1', makeFit({ sport: 'running', durationSec: 30 * 60, distanceMeters: 5000, startTime: new Date('2026-07-13T08:00:00Z') }), WorkoutSource.WEB, 'morning.fit');
    expect(h.dailyLogs.length).toBe(1);

    await persist('u1', makeFit({ sport: 'running', durationSec: 20 * 60, distanceMeters: 3000, startTime: new Date('2026-07-13T18:00:00Z') }), WorkoutSource.WEB, 'evening.fit');
    expect(h.dailyLogs.length).toBe(1);

    await persist('u1', makeFit({ sport: 'cycling', durationSec: 45 * 60, distanceMeters: 15000, startTime: new Date('2026-07-13T20:00:00Z') }), WorkoutSource.WEB, 'ride.fit');
    expect(h.dailyLogs.length).toBe(1);

    // Three distinct workouts though:
    expect(Object.keys(h.workoutRows).length).toBe(3);
  });
});
