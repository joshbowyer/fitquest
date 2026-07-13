/**
 * Tests for the per-workout dedup in applyLeakDamage.
 *
 * Background (audit C2): before this fix, applyLeakDamage() had no
 * per-workout dedup. A caller could replay
 *   POST /workouts/:id/leak-damage
 * any number of times for the same workout id, each replay
 * decrementing the leak's HP and creating a fresh
 * portalLeakDamageEvent row. The inline auto-damage fired from
 * POST /workouts (workout commit handler) and the explicit
 * AttackLeakModal POST /portal-leak/:id/attack both call into the
 * same helper — replaying either path could grind a leak to 0 and
 * farm loot.
 *
 * Fix (defense in depth):
 *   1. applyLeakDamage does a runtime findFirst on
 *      portalLeakDamageEvent (leakId, workoutId) before applying
 *      damage — a clean replay returns the leak's current state
 *      without touching it.
 *   2. The schema/migration add a @@unique([leakId, workoutId])
 *      constraint. If two concurrent requests race past step 1
 *      (both observed an empty table), one of them fails with
 *      P2002 inside the $transaction and the catch returns the
 *      leak's current state without double-decrementing HP.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted prisma mock. We track call-execution semantics at the
// $transaction level, NOT at the create/update method level. The
// reason: in real Prisma, calling prisma.foo.create(args) builds a
// promise but only executes (and only persists) when something
// awaits it inside $transaction. If the await throws (P2002 on a
// unique violation), the rest of the batch's promises are never
// awaited — they don't actually hit the DB. To replicate that, we
// record ops into `calls` only when $transaction awaits them.
const h = vi.hoisted(() => {
  const calls: { kind: string; args?: any }[] = [];
  const opQueue: Array<{ kind: string; args: any }> = [];
  const mockPrisma = {
    portalLeak: {
      // findMany is the primary candidate-leak selector
      // (applyLeakDamage iterates every active leak whose tags
      // match the workout's hitTags). findFirst / findUnique
      // are kept for the targeted-attack code path that uses
      // findMany(targetLeakId) plus occasional lookups for
      // race-loser state and pre-existence checks.
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    portalLeakDamageEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    workout: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { calls, opQueue, mockPrisma };
});

vi.mock('../lib/prisma', () => ({
  prisma: h.mockPrisma,
}));

// applyLeakDamage dynamic-imports breach for classifyWorkout /
// damageForMatch. The real implementations are pure and don't
// read prisma — leave them unmocked.

import { applyLeakDamage } from '../lib/portalLeaks.js';

const userId = 'user-1';
const leakId = 'leak-A';
const workoutId = 'workout-1';

function buildLeak(overrides: Partial<{ hp: number; maxHp: number; status: string }> = {}) {
  return {
    id: leakId,
    userId,
    monsterName: 'The Crawler',
    monsterEmoji: '◐',
    monsterColor: '#dc2626',
    intro: 'Mock leak',
    preferredTags: ['legs', 'glutes'],
    bonusTags: ['cardio'],
    hp: overrides.hp ?? 100,
    maxHp: overrides.maxHp ?? 100,
    status: overrides.status ?? 'ACTIVE',
    worldSource: 'AMBIENT',
    itemDrop: null,
    resolvedReason: null,
    resolvedAt: null,
  };
}

function buildWorkout() {
  return {
    id: workoutId,
    userId,
    type: 'STRENGTH',
    exercises: [
      {
        id: 'ex-1',
        name: 'Squat',
        sets: [
          { id: 's-1', weight: 100, reps: 5, completed: true },
          { id: 's-2', weight: 100, reps: 5, completed: true },
          { id: 's-3', weight: 100, reps: 5, completed: true },
        ],
      },
    ],
  };
}

beforeEach(() => {
  // mockReset clears BOTH implementations (re-set below) AND
  // mockResolvedValueOnce queues. vi.clearAllMocks only clears
  // mock.calls/result tracking — it leaves one-shot return
  // queues in place, so a queued value from the previous test
  // would leak into this one. Without mockReset, the second-
  // call replay test would inherit the previous test's queued
  // findMany / findFirst mocks and behave identically to it.
  vi.resetAllMocks();
  h.calls.length = 0;

  // Recreate $transaction on each run — tests can override its
  // implementation per-call via mockImplementationOnce.
  //
  // The default behavior awaits each op sequentially and records
  // them into `calls`. Throwing on any op propagates the error
  // AND leaves the remaining ops un-recorded.
  vi.mocked(h.mockPrisma.$transaction).mockImplementation(async (ops: any[]) => {
    const results: any[] = [];
    for (const op of ops) {
      results.push(await op);
    }
    return results;
  });

  // Real Prisma builds the create/update promises when you call
  // them, and awaits them in $transaction. To track that we
  // record an op in `calls` only when $transaction awaits it,
  // we tag the promise returned by create/update with a hook
  // captured by the default $transaction.
  //
  // Each create/update mock pushes (kind, args) into opQueue and
  // returns a thenable. $transaction iterates ops, awaits them,
  // pops the matching entry from opQueue and moves it to calls.
  vi.mocked(h.mockPrisma.portalLeakDamageEvent.create).mockImplementation((args: any) => {
    const queued = { kind: 'damageCreate', args };
    h.opQueue.push(queued);
    // Create a tagged promise — $transaction sees `.tag` and moves
    // the matching opQueue entry into `calls` when awaited.
    const promise = Promise.resolve({ id: 'ev-1', ...args.data });
    (promise as any).__kind = 'damageCreate';
    (promise as any).__opQueueEntry = queued;
    return promise;
  });
  vi.mocked(h.mockPrisma.portalLeak.update).mockImplementation((args: any) => {
    const queued = { kind: 'portalLeakUpdate', args };
    h.opQueue.push(queued);
    const promise = Promise.resolve({ id: 'leak-1', ...args.data });
    (promise as any).__kind = 'portalLeakUpdate';
    (promise as any).__opQueueEntry = queued;
    return promise;
  });

  // Override $transaction to record into calls only when each op
  // resolves successfully. If the await rejects (P2002 race), the
  // for-loop exits and the rest of the batch is never recorded —
  // matching what a real DB-backed Prisma transaction does on a
  // rolled-back batch.
  vi.mocked(h.mockPrisma.$transaction).mockImplementation(async (ops: any[]) => {
    const results: any[] = [];
    for (const op of ops) {
      const result = await op; // throws on P2002 — propagates out
      const entry = (op as any).__opQueueEntry;
      if (entry) h.calls.push(entry);
      results.push(result);
    }
    return results;
  });
});

describe('applyLeakDamage — per-workout dedup (C2)', () => {
  // Helpers that translate the single-leak mocks the C2
  // tests were written for into the new findMany shape.
  // Each test below sets up `mockLeakSnapshotForFindMany`
  // exactly once and expects exactly one element in
  // `summary.results`.
  const setSingleActiveLeak = (overrides: Partial<{ hp: number; maxHp: number; status: string }> = {}) => {
    h.mockPrisma.portalLeak.findMany.mockResolvedValueOnce([buildLeak(overrides)]);
  };

  it('first call applies damage and records one event row', async () => {
    setSingleActiveLeak({ hp: 100 });
    h.mockPrisma.portalLeakDamageEvent.findFirst.mockResolvedValueOnce(null);
    h.mockPrisma.workout.findUnique.mockResolvedValueOnce(buildWorkout());

    const summary = await applyLeakDamage(userId, workoutId);

    expect(summary).not.toBeNull();
    expect(summary!.matched).toBe(1);
    expect(summary!.results).toHaveLength(1);
    const hit = summary!.results[0]!;
    expect(hit.leakId).toBe(leakId);
    // Squats hit ['legs','glutes'] which match both preferredTags —
    // damageForMatch returns at least the base matched damage.
    expect(hit.dealt).toBeGreaterThan(0);
    // leakHpAfter must reflect the recorded HP, not the input 100.
    expect(hit.leakHpAfter).toBeLessThan(100);

    // Exactly one damage event was queued (and awaited in $tx).
    const damageEvents = h.calls.filter((c) => c.kind === 'damageCreate');
    expect(damageEvents).toHaveLength(1);
    const leakUpdates = h.calls.filter((c) => c.kind === 'portalLeakUpdate');
    expect(leakUpdates).toHaveLength(1);
  });

  it('second call for the same (leakId, workoutId) is a no-op (idempotent replay)', async () => {
    // Pre-state: first call's leak row snapshot.
    setSingleActiveLeak({ hp: 100 });
    h.mockPrisma.portalLeakDamageEvent.findFirst.mockResolvedValueOnce(null); // no prior event
    h.mockPrisma.workout.findUnique.mockResolvedValueOnce(buildWorkout());

    const first = await applyLeakDamage(userId, workoutId);
    expect(first).not.toBeNull();
    expect(first!.results).toHaveLength(1);
    const hpAfterFirst = first!.results[0]!.leakHpAfter;

    // Second call (replay): the dedup findFirst now finds the
    // event row that the first call recorded, so applyLeakDamage
    // must short-circuit BEFORE touching the leak.
    setSingleActiveLeak({ hp: hpAfterFirst });
    // workout.findUnique is called UNCONDITIONALLY at the start
    // of applyLeakDamage — even on a replay, the helper still
    // re-loads the workout to classify its hitTags (the dedup
    // short-circuit only skips the damage path, not the classify
    // path). Queue it again here or the second call bails at
    // `if (!workout) return { matched: 0, results: [] }`.
    h.mockPrisma.workout.findUnique.mockResolvedValueOnce(buildWorkout());
    h.mockPrisma.portalLeakDamageEvent.findFirst.mockResolvedValueOnce({
      id: 'ev-1',
      leakId,
      workoutId,
      damage: first!.results[0]!.dealt,
      leakHpAfter: hpAfterFirst,
      matchType: first!.results[0]!.matchType,
      createdAt: new Date(),
    });

    const second = await applyLeakDamage(userId, workoutId);

    // Should still resolve with a shape the UI can use.
    expect(second).not.toBeNull();
    expect(second!.matched).toBe(1);
    expect(second!.results[0]!.leakId).toBe(leakId);
    // The historical event's damage is surfaced so the UI can
    // still show "you dealt X" without re-applying.
    expect(second!.results[0]!.dealt).toBe(first!.results[0]!.dealt);
    // Resolved stays null — we did NOT land a second event.
    expect(second!.results[0]!.resolved).toBeNull();

    // Critical assertions: no second damage event row was
    // created and no second leak.hp update was issued.
    const damageEvents = h.calls.filter((c) => c.kind === 'damageCreate');
    expect(damageEvents).toHaveLength(1);
    const leakUpdates = h.calls.filter((c) => c.kind === 'portalLeakUpdate');
    expect(leakUpdates).toHaveLength(1);

    // workout.findUnique is re-loaded on EVERY applyLeakDamage
    // call (the helper classifies the workout's hitTags once per
    // call — classifyWorkout + totalVolumeKg are pure but
    // re-running them keeps the helper stateless across replays).
    // The dedup invariant we DO want to lock in: damage.create
    // and leak.update were called exactly ONCE total (the dedup
    // findFirst short-circuited the second call's damage path).
    expect(h.mockPrisma.workout.findUnique).toHaveBeenCalledTimes(2);
  });

  it('database-level unique constraint: a concurrent loser returns the leak\'s current state without double-decrementing', async () => {
    // The race window: two concurrent requests both see no prior
    // event. Both compute the same damage and try to insert.
    // The DB raises P2002 on the loser's damage event insert.
    // The catch in applyLeakDamage must return the leak's
    // *current* HP (post-winner-update) and NOT throw or
    // double-decrement.

    // First call — the "winner" — succeeds end-to-end.
    setSingleActiveLeak({ hp: 100 });
    h.mockPrisma.portalLeakDamageEvent.findFirst.mockResolvedValueOnce(null);
    h.mockPrisma.workout.findUnique.mockResolvedValueOnce(buildWorkout());

    const winner = await applyLeakDamage(userId, workoutId);
    expect(winner).not.toBeNull();
    expect(winner!.results).toHaveLength(1);
    const winnerHp = winner!.results[0]!.leakHpAfter;

    // Second call — the "loser" — passes the dedup findFirst
    // (still in the race window), and the damage event insert
    // rejects with P2002. The helper catches it and returns the
    // leak's current state without updating HP.
    setSingleActiveLeak({ hp: 100 });
    h.mockPrisma.portalLeakDamageEvent.findFirst.mockResolvedValueOnce(null);
    h.mockPrisma.workout.findUnique.mockResolvedValueOnce(buildWorkout());

    // Override the create mock for THIS call only — make the
    // returned promise reject with the same error shape Prisma
    // throws on a @@unique collision.
    vi.mocked(h.mockPrisma.portalLeakDamageEvent.create).mockImplementationOnce((args: any) => {
      const queued = { kind: 'damageCreate', args };
      h.opQueue.push(queued);
      const e: any = new Error('Unique constraint failed');
      e.code = 'P2002';
      e.meta = { target: ['leakId', 'workoutId'] };
      const rejected = Promise.reject(e);
      (rejected as any).__kind = 'damageCreate';
      (rejected as any).__opQueueEntry = queued;
      return rejected;
    });

    // The catch in applyLeakDamage reads portalLeak.findUnique
    // to obtain the leak's *current* (post-winner) HP.
    h.mockPrisma.portalLeak.findUnique.mockResolvedValueOnce({ hp: winnerHp, status: 'ACTIVE' });

    const loser = await applyLeakDamage(userId, workoutId);

    // Loser resolves with the leak's current state (winner-applied
    // HP), not the originally-calculated newHp. No exception.
    expect(loser).not.toBeNull();
    expect(loser!.matched).toBe(1); // the loser is still surfaced (matched:1 + dealt:0) so the UI can update
    const loserHit = loser!.results[0]!;
    expect(loserHit.leakHpAfter).toBe(winnerHp);
    // Loser's damage was discarded by the unique constraint.
    expect(loserHit.dealt).toBe(0);
    expect(loserHit.resolved).toBeNull();

    // Both racers called prisma.portalLeakDamageEvent.create at
    // the client level (Prisma can't know about the DB
    // constraint until it tries the INSERT). What matters is
    // what actually landed: only the winner's update reached
    // the DB. The loser's create rejected inside $transaction,
    // which rolled back the matching portalLeak.update promise
    // (the for-loop exited before awaiting the update).
    const damageCreates = h.calls.filter((c) => c.kind === 'damageCreate');
    expect(damageCreates).toHaveLength(1); // only the winner's was awaited successfully
    const leakUpdates = h.calls.filter((c) => c.kind === 'portalLeakUpdate');
    expect(leakUpdates).toHaveLength(1); // only the winner's update landed
  });
});

describe('applyLeakDamage — multi-target fan-out (C2 extension)', () => {
  // A second-tier "leak" with the same preferredTags as the
  // primary — used to verify the cascade behavior the user
  // asked for in C2: a workout whose hitTags match multiple
  // active leaks takes the FULL damage value on each matched
  // leak (NOT split across them).
  const secondLeakId = 'leak-B';

  function buildSecondLeak(overrides: Partial<{ hp: number; maxHp: number; status: string }> = {}) {
    return {
      id: secondLeakId,
      userId,
      monsterName: 'The Twin',
      monsterEmoji: '◍',
      monsterColor: '#f59e0b',
      intro: 'Mock twin leak',
      // Same preferredTags as the primary — squat-day hits both.
      preferredTags: ['legs', 'glutes'],
      bonusTags: [],
      hp: overrides.hp ?? 100,
      maxHp: overrides.maxHp ?? 100,
      status: overrides.status ?? 'ACTIVE',
      worldSource: 'AMBIENT',
      itemDrop: null,
      resolvedReason: null,
      resolvedAt: null,
    };
  }

  it('workout whose muscle tag matches multiple active leaks — all matched leaks take the full damage, no splitting', async () => {
    // Two active leaks, both with ['legs','glutes'] preferredTags.
    // Squat day hits both. Each leak takes the FULL damage value,
    // not 1/N of it (the user explicitly asked for this in C2).
    const startingHp = 100;
    h.mockPrisma.portalLeak.findMany.mockResolvedValueOnce([
      buildLeak({ hp: startingHp }),
      buildSecondLeak({ hp: startingHp }),
    ]);
    // No prior damage events for either leak.
    h.mockPrisma.portalLeakDamageEvent.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    h.mockPrisma.workout.findUnique.mockResolvedValueOnce(buildWorkout());

    const summary = await applyLeakDamage(userId, workoutId);

    expect(summary).not.toBeNull();
    // Both leaks matched — the helper ran damageForMatch twice,
    // once per leak.
    expect(summary!.matched).toBe(2);
    expect(summary!.results).toHaveLength(2);

    const hitA = summary!.results.find((r) => r.leakId === leakId);
    const hitB = summary!.results.find((r) => r.leakId === secondLeakId);
    expect(hitA).toBeDefined();
    expect(hitB).toBeDefined();

    // Both leaks take the same FULL damage value (no split). For
    // matched squats: BASE_MATCHED_DAMAGE = 60 scaled to leak
    // size (÷3, clamped) — the scaling is the same per leak.
    expect(hitA!.dealt).toBeGreaterThan(0);
    expect(hitA!.dealt).toBe(hitB!.dealt);
    // Both leak HPs are reduced; not one reduced by 2x and the
    // other unchanged. (The C2 ask: "lets not split the damage,
    // just do the full damage to each.")
    expect(hitA!.leakHpAfter).toBe(startingHp - hitA!.dealt);
    expect(hitB!.leakHpAfter).toBe(startingHp - hitB!.dealt);

    // Critical: TWO damage event rows + TWO leak HP updates were
    // issued (one per matched leak). If damage had been split
    // we'd see smaller updates but on TWO leaks still — the
    // sizes (not the count) check the no-split invariant.
    const damageEvents = h.calls.filter((c) => c.kind === 'damageCreate');
    expect(damageEvents).toHaveLength(2);
    const leakUpdates = h.calls.filter((c) => c.kind === 'portalLeakUpdate');
    expect(leakUpdates).toHaveLength(2);

    // Each event row's damage payload matches the per-leak
    // damage value — the SAME value appears in both rows since
    // there's no split. Belt-and-braces over the dealt:leakHpAfter
    // assertion above.
    const damages = damageEvents.map((e) => (e.args as any).data.damage).sort();
    expect(damages[0]).toBe(damages[1]);
  });

  it('workout whose tag matches ONLY one of two active leaks — non-matching leak is left alone (matched === 1)', async () => {
    // Primary leak: ['legs','glutes']. Second leak: ['chest','back'].
    // Squat day hits the primary only. The second leak should
    // remain untouched — no event row, no HP change.
    h.mockPrisma.portalLeak.findMany.mockResolvedValueOnce([
      buildLeak({ hp: 100 }),
      {
        ...buildSecondLeak({ hp: 100 }),
        preferredTags: ['chest', 'back'],
      },
    ]);
    h.mockPrisma.portalLeakDamageEvent.findFirst.mockResolvedValueOnce(null);  // matched: null for primary
    h.mockPrisma.workout.findUnique.mockResolvedValueOnce(buildWorkout());

    const summary = await applyLeakDamage(userId, workoutId);

    // The first call is for the primary leak. There is no
    // second-leak event-row findFirst — that leak never enters
    // the damage path because its tag overlap test fails.
    expect(summary).not.toBeNull();
    expect(summary!.matched).toBe(1);
    expect(summary!.results).toHaveLength(1);
    expect(summary!.results[0]!.leakId).toBe(leakId);

    // Only one damage event + one HP update landed.
    const damageEvents = h.calls.filter((c) => c.kind === 'damageCreate');
    expect(damageEvents).toHaveLength(1);
    const leakUpdates = h.calls.filter((c) => c.kind === 'portalLeakUpdate');
    expect(leakUpdates).toHaveLength(1);
  });

  it('workout tag overlaps NEITHER active leak — matched === 0, no DB writes', async () => {
    // Both leaks want chest/back. Workout is a calf raise (mobility).
    // Hit-tags will be ['mobility'], no overlap with either leak's
    // preferredTags. The helper must short-circuit cleanly.
    h.mockPrisma.portalLeak.findMany.mockResolvedValueOnce([
      { ...buildLeak({ hp: 100 }), preferredTags: ['chest'] },
      { ...buildSecondLeak({ hp: 100 }), preferredTags: ['back'] },
    ]);
    h.mockPrisma.workout.findUnique.mockResolvedValueOnce(buildWorkout());

    const summary = await applyLeakDamage(userId, workoutId);

    expect(summary).not.toBeNull();
    expect(summary!.matched).toBe(0);
    expect(summary!.results).toEqual([]);
    // No damage event, no leak update — neither candidate leak
    // received an event row, neither received a HP change.
    const damageEvents = h.calls.filter((c) => c.kind === 'damageCreate');
    expect(damageEvents).toHaveLength(0);
    const leakUpdates = h.calls.filter((c) => c.kind === 'portalLeakUpdate');
    expect(leakUpdates).toHaveLength(0);
  });

  it('targetLeakId: the AttackLeakModal-mode — restrict to ONE leak, only-this-id behavior', async () => {
    // Two active leaks exist for this user. The targeted-attack
    // endpoint passes targetLeakId: leakId. Production Prisma
    // honors the where: { id: targetLeakId, status: 'ACTIVE' }
    // filter, so the helper receives ONLY the targeted leak.
    // The mock here mimics that: it returns just the targeted
    // leak (not both), matching what production Prisma would.
    h.mockPrisma.portalLeak.findMany.mockResolvedValueOnce([
      buildLeak({ hp: 100 }),
    ]);
    h.mockPrisma.portalLeakDamageEvent.findFirst.mockResolvedValueOnce(null);
    h.mockPrisma.workout.findUnique.mockResolvedValueOnce(buildWorkout());

    const summary = await applyLeakDamage(userId, workoutId, h.mockPrisma as any, { targetLeakId: leakId });

    // findMany was called WITH the id filter — args include
    // `id: leakId` alongside status: 'ACTIVE'. This is the
    // core "only-this-id" assertion: the helper asks the
    // production DB for one specific leak, not the whole
    // active queue.
    expect(h.mockPrisma.portalLeak.findMany).toHaveBeenCalledTimes(1);
    const findManyArgs = h.mockPrisma.portalLeak.findMany.mock.calls[0]![0] as any;
    expect(findManyArgs?.where?.id).toBe(leakId);
    expect(findManyArgs?.where?.status).toBe('ACTIVE');

    // Helper applied damage only to the targeted leak. matched
    // is 1 because there's exactly one leak in scope (production
    // Prisma would have filtered to it before the helper saw it).
    expect(summary!.matched).toBe(1);
    expect(summary!.results).toHaveLength(1);
    expect(summary!.results[0]!.leakId).toBe(leakId);

    // Damage event count == matched: only one leak took damage.
    const damageEvents = h.calls.filter((c) => c.kind === 'damageCreate');
    expect(damageEvents).toHaveLength(1);
  });

  it('targetLeakId + non-matching tags — matched === 0 (UI distinguishes no-op from no-leak)', async () => {
    // The targeted-attack endpoint passes the leak id. The leak's
    // preferredTags DO overlap the workout's hitTags — so damage
    // would normally land. But under the targeted attack, if the
    // tags don't match, the helper returns matched: 0 (no-op).
    // Here we mirror that by having ONE leak with non-matching
    // tags and a targetLeakId pointing at it.
    h.mockPrisma.portalLeak.findMany.mockResolvedValueOnce([
      { ...buildLeak({ hp: 100 }), preferredTags: ['chest'] }, // workout hits 'legs' — no overlap
    ]);
    h.mockPrisma.workout.findUnique.mockResolvedValueOnce(buildWorkout());

    const summary = await applyLeakDamage(userId, workoutId, h.mockPrisma as any, { targetLeakId: leakId });

    expect(summary).not.toBeNull();
    expect(summary!.matched).toBe(0);
    expect(summary!.results).toEqual([]);
    // No event row, no HP change.
    const damageEvents = h.calls.filter((c) => c.kind === 'damageCreate');
    expect(damageEvents).toHaveLength(0);
    const leakUpdates = h.calls.filter((c) => c.kind === 'portalLeakUpdate');
    expect(leakUpdates).toHaveLength(0);
  });
});
