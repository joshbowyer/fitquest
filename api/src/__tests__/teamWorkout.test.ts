/**
 * Tests for the team-workout cleanup cron (cleanupStaleTeamWorkouts) in
 * `api/src/routes/teamWorkouts.ts`.
 *
 * Phase A fix coverage:
 *   (a) INVITED-never-responded on a stale PENDING/ACTIVE session → NO_SHOW
 *   (b) ACCEPTED participants and the leader are NOT marked NO_SHOW by the sweep
 *   (c) participants on already COMPLETED/ABANDONED sessions are untouched
 *   (d) after the 30-min sweep, a session whose only remaining non-confirmed
 *       participant just became NO_SHOW and all others CONFIRMED → COMPLETED
 *   (e) 1h sweep: ≥2 CONFIRMED → COMPLETED with side effects,
 *                 0 CONFIRMED → ABANDONED (never converts confirmed work)
 *
 * The Phase A root-cause was a logic inversion in the NO_SHOW filter — the
 * old clause keyed off `respondedAt < now-30min`, but INVITED rows are
 * created without `respondedAt` (null), so the old filter NEVER matched a
 * real non-responder and instead ate the leader's ACCEPTED row (the only
 * kind with a non-null respondedAt). The new filter is `status='INVITED'`
 * + a relation filter on the parent teamWorkout, which excludes finalized
 * sessions and INVITED-only already excludes the leader.
 *
 * The cron itself is best-effort (called from index.ts on a setInterval
 * AND from POST /team-workouts/cleanup), so we call the exported helper
 * directly with `vi.useFakeTimers` to pin "now" and backdate startedAt
 * deterministically. No DB, no HTTP layer, no Fastify.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Shared store hoisted so the vi.mock factory can both read it (to back
// findMany/findUnique) and write to it (via create/updateMany mocks).
// Mirrors the `vi.hoisted` pattern in `notifications.test.ts`.
const store = vi.hoisted(() => ({
  teamWorkouts: [] as any[],
  teamParticipants: [] as any[],
  partyMembers: [] as any[],
  parties: [] as any[],
  partyCamaraderies: [] as any[],
  partyBuffs: [] as any[],
  achievements: [] as any[],
  userAchievements: [] as any[],
  notifications: [] as any[],
  workouts: [] as any[],
}));

vi.mock('../lib/prisma', () => {
  // ---- Where-clause helpers (mini Prisma where-evaluator) ----
  // The cleanup code uses two flavors of where that we have to honor:
  //   1. `teamParticipant.updateMany` with `teamWorkout: { is: {...} }`
  //      relation filter — the parent's status/startedAt must match.
  //   2. `teamWorkout.findMany` with `participants: { some: {...} }`
  //      relation filter — at least one child must match.
  function matchesStatus(actual: any, filter: any): boolean {
    if (filter == null) return true;
    if (typeof filter === 'string') return actual === filter;
    if (typeof filter === 'object') {
      if (filter.in && Array.isArray(filter.in)) return filter.in.includes(actual);
      if (filter.notIn && Array.isArray(filter.notIn)) return !filter.notIn.includes(actual);
    }
    return true;
  }
  function matchesDate(actual: Date, filter: any): boolean {
    if (filter == null) return true;
    if (typeof filter === 'object') {
      if (filter.lt) return actual.getTime() < filter.lt.getTime();
      if (filter.gt) return actual.getTime() > filter.gt.getTime();
      if (filter.lte) return actual.getTime() <= filter.lte.getTime();
      if (filter.gte) return actual.getTime() >= filter.gte.getTime();
    }
    return true;
  }
  function participantMatchesWhere(p: any, where: any): boolean {
    if (!where) return true;
    if (!matchesStatus(p.status, where.status)) return false;
    if (where.teamWorkoutId && p.teamWorkoutId !== where.teamWorkoutId) return false;
    if (where.teamWorkout?.is) {
      const tw = store.teamWorkouts.find((t: any) => t.id === p.teamWorkoutId);
      if (!tw) return false;
      if (!matchesStatus(tw.status, where.teamWorkout.is.status)) return false;
      if (!matchesDate(tw.startedAt, where.teamWorkout.is.startedAt)) return false;
    }
    return true;
  }
  function teamWorkoutMatchesWhere(tw: any, where: any): boolean {
    if (!where) return true;
    if (!matchesStatus(tw.status, where.status)) return false;
    if (!matchesDate(tw.startedAt, where.startedAt)) return false;
    if (where.id && tw.id !== where.id) return false;
    if (where.participants?.some) {
      const subs = store.teamParticipants.filter((p: any) => p.teamWorkoutId === tw.id);
      const sub = subs.find((p: any) => participantMatchesWhere(p, where.participants.some));
      if (!sub) return false;
    }
    return true;
  }

  return {
    prisma: {
      // --- TeamWorkout ---
      teamWorkout: {
        findUnique: vi.fn(async ({ where, include }: any) => {
          const tw = store.teamWorkouts.find((t: any) => t.id === where.id);
          if (!tw) return null;
          if (include?.participants) {
            return {
              ...tw,
              participants: store.teamParticipants
                .filter((p: any) => p.teamWorkoutId === tw.id)
                .map((p: any) => ({ ...p })),
            };
          }
          return { ...tw };
        }),
        findMany: vi.fn(async ({ where, select }: any) => {
          const out = store.teamWorkouts
            .filter((t: any) => teamWorkoutMatchesWhere(t, where))
            .map((t: any) => ({ ...t }));
          if (select) {
            return out.map((t: any) => {
              const r: any = {};
              for (const k of Object.keys(select)) r[k] = t[k];
              return r;
            });
          }
          return out;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const tw = store.teamWorkouts.find((t: any) => t.id === where.id);
          if (!tw) throw new Error('teamWorkout.update: not found');
          Object.assign(tw, data);
          return { ...tw };
        }),
        create: vi.fn(async ({ data, include }: any) => {
          const id = data.id ?? `tw-${store.teamWorkouts.length + 1}`;
          const tw: any = {
            id,
            partyId: data.partyId,
            leaderId: data.leaderId,
            status: data.status ?? 'PENDING',
            startedAt: data.startedAt ?? new Date(),
            endedAt: data.endedAt ?? null,
            completedAt: data.completedAt ?? null,
            routineName: data.routineName ?? null,
          };
          store.teamWorkouts.push(tw);
          if (include?.participants) {
            (tw as any).participants = store.teamParticipants
              .filter((p: any) => p.teamWorkoutId === id)
              .map((p: any) => ({ ...p }));
          }
          return tw;
        }),
      },

      // --- TeamParticipant ---
      teamParticipant: {
        findMany: vi.fn(async ({ where, select }: any) => {
          const rows = store.teamParticipants
            .filter((p: any) => participantMatchesWhere(p, where))
            .map((p: any) => ({ ...p }));
          if (select) {
            return rows.map((r: any) => {
              const o: any = {};
              for (const k of Object.keys(select)) o[k] = r[k];
              return o;
            });
          }
          return rows;
        }),
        findUnique: vi.fn(async ({ where }: any) => {
          // Used by the /confirm route's me_part lookup — not exercised
          // by these tests but kept in case we add route coverage later.
          if (where.id) {
            const p = store.teamParticipants.find((x: any) => x.id === where.id);
            return p ? { ...p } : null;
          }
          return null;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const p = store.teamParticipants.find((x: any) => x.id === where.id);
          if (!p) throw new Error('teamParticipant.update: not found');
          Object.assign(p, data);
          return { ...p };
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          let n = 0;
          for (const p of store.teamParticipants) {
            if (participantMatchesWhere(p, where)) {
              Object.assign(p, data);
              n++;
            }
          }
          return { count: n };
        }),
        create: vi.fn(async ({ data }: any) => {
          const row = {
            id: `tp-${store.teamParticipants.length + 1}`,
            teamWorkoutId: data.teamWorkoutId,
            userId: data.userId,
            status: data.status ?? 'INVITED',
            workoutId: data.workoutId ?? null,
            respondedAt: data.respondedAt ?? null,
            confirmedAt: data.confirmedAt ?? null,
          };
          store.teamParticipants.push(row);
          return { ...row };
        }),
      },

      // --- Party (lookup only — /confirm loads `party: true` but the
      //     shared finalize doesn't need it; cleanupStaleTeamWorkouts
      //     doesn't read it either. Stub for module-load sanity.) ---
      party: {
        findUnique: vi.fn(async ({ where }: any) => {
          return store.parties.find((p: any) => p.id === where.id) ?? null;
        }),
      },

      // --- PartyMember (read by the POST / route, not the cleanup —
      //     stub to keep module-load happy) ---
      partyMember: {
        findFirst: vi.fn(async () => null),
        findUnique: vi.fn(async () => null),
      },

      // --- PartyCamaraderie (drives adjustCamaraderie side effects) ---
      partyCamaraderie: {
        findUnique: vi.fn(async ({ where }: any) => {
          return (
            store.partyCamaraderies.find((c: any) => c.partyId === where.partyId) ?? null
          );
        }),
        upsert: vi.fn(async ({ where, create, update }: any) => {
          let row = store.partyCamaraderies.find(
            (c: any) => c.partyId === where.partyId,
          );
          if (!row) {
            row = {
              partyId: where.partyId,
              score: create.score ?? 0,
              tier: create.tier ?? 'Cold',
              history: create.history ?? [],
              updatedAt: new Date(),
            };
            store.partyCamaraderies.push(row);
          } else {
            Object.assign(row, update);
          }
          return { ...row };
        }),
        create: vi.fn(async ({ data }: any) => {
          const row = {
            partyId: data.partyId,
            score: data.score ?? 0,
            tier: data.tier ?? 'Cold',
            history: data.history ?? [],
            updatedAt: new Date(),
          };
          store.partyCamaraderies.push(row);
          return { ...row };
        }),
      },

      // --- PartyBuff (raid-dmg bonus, 24h after completion) ---
      partyBuff: {
        upsert: vi.fn(async ({ where, create, update }: any) => {
          let row = store.partyBuffs.find((b: any) => b.partyId === where.partyId);
          if (!row) {
            row = { ...create };
            store.partyBuffs.push(row);
          } else {
            Object.assign(row, update);
          }
          return { ...row };
        }),
      },

      // --- Achievement (drives unlockAchievement → userAchievement) ---
      achievement: {
        findUnique: vi.fn(async ({ where }: any) => {
          return store.achievements.find((a: any) => a.key === where.key) ?? null;
        }),
      },
      userAchievement: {
        upsert: vi.fn(async ({ where, create }: any) => {
          let row = store.userAchievements.find(
            (u: any) =>
              u.userId === where.userId_achievementId.userId &&
              u.achievementId === where.userId_achievementId.achievementId,
          );
          if (!row) {
            row = { ...create, unlockedAt: new Date() };
            store.userAchievements.push(row);
          }
          return { ...row };
        }),
      },

      // --- Notification (consumed by emitNotification, which we mock
      //     below — this stub exists so a stray real call doesn't 500) ---
      notification: {
        create: vi.fn(async ({ data }: any) => {
          const row = {
            id: `n-${store.notifications.length + 1}`,
            userId: data.userId,
            category: data.category,
            kind: data.kind,
            title: data.title,
            body: data.body ?? null,
            link: data.link ?? null,
            payload: data.payload ?? null,
            readAt: null,
            createdAt: new Date(),
          };
          store.notifications.push(row);
          return { ...row };
        }),
      },

      // --- Workout (read by the /confirm route — stub for module-load) ---
      workout: {
        findUnique: vi.fn(async () => null),
      },
    },
  };
});

// emitNotification is dynamic-imported by unlockAchievement. Stub it so
// the test doesn't have to wire a separate NotificationCategory enum.
// Expose the mock via a getter so the idempotency test can assert on
// call counts (proves no re-emitted achievement notifications on a
// double-sweep).
const emitNotificationMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../lib/notify.js', () => ({
  emitNotification: emitNotificationMock,
}));

// teamWorkouts.ts imports `requireUser` at module-load. The cleanup
// helper itself doesn't call it (the route's POST /cleanup does, but
// we don't exercise that route here). Stub so auth.ts doesn't try to
// load real sessions / bcryptjs.
vi.mock('../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ id: 'unused' })),
}));

import { cleanupStaleTeamWorkouts, maybeCompleteTeamWorkout } from '../routes/teamWorkouts';

// ----- Helpers -----
const NOW = new Date('2026-07-08T12:00:00Z');
const MS_30_MIN = 30 * 60 * 1000;
const MS_1_HOUR = 60 * 60 * 1000;

function resetStore() {
  store.teamWorkouts.length = 0;
  store.teamParticipants.length = 0;
  store.partyMembers.length = 0;
  store.parties.length = 0;
  store.partyCamaraderies.length = 0;
  store.partyBuffs.length = 0;
  store.achievements.length = 0;
  store.userAchievements.length = 0;
  store.notifications.length = 0;
  store.workouts.length = 0;
  // Seed the side_by_side achievement so unlockAchievement finds it.
  store.achievements.push({
    id: 'ach-side',
    key: 'side_by_side',
    name: 'Side By Side',
    description: 'Completed a team workout with at least one other party member.',
    category: 'SOCIAL',
    icon: 'people',
    points: 50,
  });
}

function seedTeamWorkout(opts: {
  id?: string;
  partyId?: string;
  leaderId?: string;
  status?: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  startedAt?: Date;
}) {
  const id = opts.id ?? `tw-${store.teamWorkouts.length + 1}`;
  store.teamWorkouts.push({
    id,
    partyId: opts.partyId ?? 'party-1',
    leaderId: opts.leaderId ?? 'user-leader',
    status: opts.status ?? 'PENDING',
    startedAt: opts.startedAt ?? NOW,
    endedAt: null,
    completedAt: null,
    routineName: null,
  });
  return id;
}

function seedParticipant(opts: {
  teamWorkoutId: string;
  userId: string;
  status: 'INVITED' | 'ACCEPTED' | 'DECLINED' | 'JOINED' | 'CONFIRMED' | 'NO_SHOW';
  respondedAt?: Date | null;
  confirmedAt?: Date | null;
}) {
  const row = {
    id: `tp-${store.teamParticipants.length + 1}`,
    teamWorkoutId: opts.teamWorkoutId,
    userId: opts.userId,
    status: opts.status,
    workoutId: null,
    respondedAt: opts.respondedAt ?? null,
    confirmedAt: opts.confirmedAt ?? null,
  };
  store.teamParticipants.push(row);
  return row;
}

function getParticipant(userId: string, teamWorkoutId: string) {
  return store.teamParticipants.find(
    (p: any) => p.userId === userId && p.teamWorkoutId === teamWorkoutId,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetStore();
  // Reset the emitNotification mock's call history so each test sees a
  // clean baseline (vi.hoisted creates the fn at module load and it
  // accumulates calls across tests otherwise).
  emitNotificationMock.mockClear();
});

// =============================================================================
// (a) INVITED >30min on a PENDING/ACTIVE session → NO_SHOW
// =============================================================================
describe('cleanupStaleTeamWorkouts — 30-min NO_SHOW sweep', () => {
  it('(a) marks an INVITED-never-responded participant NO_SHOW when the parent session is stale', async () => {
    // Session started 31 minutes ago, still PENDING (leader hasn't joined yet).
    const twId = seedTeamWorkout({
      status: 'PENDING',
      startedAt: new Date(NOW.getTime() - 31 * 60 * 1000),
    });
    // Leader is implicit-ACCEPTED (created at session start).
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-leader',
      status: 'ACCEPTED',
      respondedAt: new Date(NOW.getTime() - 31 * 60 * 1000),
    });
    // Friend who never even tapped Accept → still INVITED, respondedAt=null.
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-ghost',
      status: 'INVITED',
      respondedAt: null,
    });

    const r = await cleanupStaleTeamWorkouts();

    expect(getParticipant('user-ghost', twId)?.status).toBe('NO_SHOW');
    expect(r.noShowsMarked).toBe(1);
    // Session is NOT completed — leader is still ACCEPTED (not in the
    // allDone set), so maybeCompleteTeamWorkout bails.
    expect(store.teamWorkouts.find((t: any) => t.id === twId)?.status).toBe('PENDING');
    expect(r.sessionsCompletedBySweep).toBe(0);
    expect(r.sessionsAbandoned).toBe(0);
  });

  it('(a.ACTIVE) same NO_SHOW sweep applies to ACTIVE sessions, not just PENDING', async () => {
    // ACTIVE means at least one member joined; the non-responder is still
    // hanging on INVITED. The sweep should still flip them.
    const twId = seedTeamWorkout({
      status: 'ACTIVE',
      startedAt: new Date(NOW.getTime() - 45 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-leader',
      status: 'JOINED',
      respondedAt: new Date(NOW.getTime() - 40 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-ghost',
      status: 'INVITED',
      respondedAt: null,
    });

    const r = await cleanupStaleTeamWorkouts();

    expect(getParticipant('user-ghost', twId)?.status).toBe('NO_SHOW');
    expect(r.noShowsMarked).toBe(1);
  });
});

// =============================================================================
// (b) ACCEPTED participants and the leader are NOT marked NO_SHOW
// =============================================================================
describe('cleanupStaleTeamWorkouts — leader / ACCEPTED not no-showed', () => {
  it('(b) leaves ACCEPTED participants (incl. leader) untouched even when their respondedAt is past 30min', async () => {
    // This is the regression guard for the original bug — the old filter
    // `status IN (INVITED, ACCEPTED) AND respondedAt < now-30min` ate the
    // leader's ACCEPTED row (the only kind with non-null respondedAt at
    // that age). The new filter is INVITED-only with a relation filter
    // on the parent session — so ACCEPTED rows are never candidates.
    const twId = seedTeamWorkout({
      status: 'PENDING',
      startedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-leader',
      status: 'ACCEPTED',
      respondedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-friend',
      status: 'ACCEPTED',
      respondedAt: new Date(NOW.getTime() - 35 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-ghost',
      status: 'INVITED',
      respondedAt: null,
    });

    const r = await cleanupStaleTeamWorkouts();

    expect(getParticipant('user-leader', twId)?.status).toBe('ACCEPTED');
    expect(getParticipant('user-friend', twId)?.status).toBe('ACCEPTED');
    expect(getParticipant('user-ghost', twId)?.status).toBe('NO_SHOW');
    expect(r.noShowsMarked).toBe(1);
  });

  it('(b.JOINED) JOINED participants are also untouched by the NO_SHOW sweep', async () => {
    // JOINED is the "I've started my workout" state — the user IS doing
    // the session, just hasn't tapped "I'm done" yet. Marking them NO_SHOW
    // would be a false-positive identical to the leader bug.
    //
    // Note: keep the session in the 30-min-1h window so we test the
    // NO_SHOW sweep in isolation — past 1h, the ABANDON sweep correctly
    // marks JOINED participants NO_SHOW (they're non-terminal), which
    // is the right behavior but not what this assertion is about.
    const twId = seedTeamWorkout({
      status: 'ACTIVE',
      startedAt: new Date(NOW.getTime() - 35 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-leader',
      status: 'JOINED',
      respondedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-ghost',
      status: 'INVITED',
      respondedAt: null,
    });

    await cleanupStaleTeamWorkouts();

    expect(getParticipant('user-leader', twId)?.status).toBe('JOINED');
    expect(getParticipant('user-ghost', twId)?.status).toBe('NO_SHOW');
  });
});

// =============================================================================
// (c) Participants on finalized sessions are untouched
// =============================================================================
describe('cleanupStaleTeamWorkouts — finalized sessions untouched', () => {
  it('(c) leaves INVITED participants on COMPLETED sessions alone', async () => {
    // A COMPLETED session with a phantom INVITED row (user joined a week
    // ago, then the leader marked them NO_SHOW, but actually they're
    // still INVITED somehow) must NOT be re-finalized or re-swept. The
    // relation filter on `teamWorkout.status IN (PENDING, ACTIVE)`
    // guarantees this.
    const twId = seedTeamWorkout({
      status: 'COMPLETED',
      startedAt: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-leader',
      status: 'CONFIRMED',
      confirmedAt: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000 + MS_30_MIN),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-ghost',
      status: 'INVITED',
      respondedAt: null,
    });

    const r = await cleanupStaleTeamWorkouts();

    expect(getParticipant('user-ghost', twId)?.status).toBe('INVITED');
    expect(r.noShowsMarked).toBe(0);
    expect(r.sessionsCompletedBySweep).toBe(0);
    expect(r.sessionsAbandoned).toBe(0);
  });

  it('(c.ABANDONED) leaves INVITED participants on ABANDONED sessions alone', async () => {
    // Same idea, ABANDONED side. The previous bug's blind `updateMany`
    // could in principle flip these — the relation filter now prevents it.
    const twId = seedTeamWorkout({
      status: 'ABANDONED',
      startedAt: new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-leader',
      status: 'ACCEPTED',
      respondedAt: new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-ghost',
      status: 'INVITED',
      respondedAt: null,
    });

    const r = await cleanupStaleTeamWorkouts();

    expect(getParticipant('user-ghost', twId)?.status).toBe('INVITED');
    expect(r.noShowsMarked).toBe(0);
    expect(r.sessionsAbandoned).toBe(0);
  });
});

// =============================================================================
// (d) 30-min sweep completion — all-but-one CONFIRMED becomes COMPLETED
// =============================================================================
describe('cleanupStaleTeamWorkouts — sweep completes a near-done session', () => {
  it('(d) flips a session to COMPLETED when the sweep NO_SHOWs the last non-confirmed participant', async () => {
    // Setup: leader + friend already CONFIRMED, only one INVITED straggler
    // left. Before Phase A this session hung forever (NO_SHOW filter
    // didn't match INVITED). After Phase A the sweep flips the straggler
    // and then re-runs maybeCompleteTeamWorkout, which sees
    // allDone = (CONFIRMED + CONFIRMED + NO_SHOW) and finalizes.
    const twId = seedTeamWorkout({
      status: 'ACTIVE',
      startedAt: new Date(NOW.getTime() - 31 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-leader',
      status: 'CONFIRMED',
      confirmedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-friend',
      status: 'CONFIRMED',
      confirmedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-ghost',
      status: 'INVITED',
      respondedAt: null,
    });

    const r = await cleanupStaleTeamWorkouts();

    const tw = store.teamWorkouts.find((t: any) => t.id === twId);
    expect(tw?.status).toBe('COMPLETED');
    expect(tw?.completedAt).not.toBeNull();
    expect(tw?.endedAt).not.toBeNull();
    expect(getParticipant('user-ghost', twId)?.status).toBe('NO_SHOW');
    // Side effects (≥2 confirmed): +5 camaraderie, party buff upsert,
    // side_by_side achievement for BOTH confirmed users (incl. leader).
    const cam = store.partyCamaraderies.find((c: any) => c.partyId === 'party-1');
    expect(cam?.score).toBe(5);
    expect(store.partyBuffs.find((b: any) => b.partyId === 'party-1')?.raidDmgBonusPct).toBe(10);
    const userAchIds = store.userAchievements.map((u: any) => u.userId);
    expect(userAchIds).toContain('user-leader');
    expect(userAchIds).toContain('user-friend');
    // 30-min NO_SHOW completion counts toward sessionsCompletedBySweep.
    expect(r.sessionsCompletedBySweep).toBe(1);
    expect(r.sessionsAbandoned).toBe(0);
  });

  it('(d.one-confirmed) does NOT finalize a session with only 1 CONFIRMED via the 30-min sweep', async () => {
    // Boundary: 1 CONFIRMED + 1 INVITED → INVITED becomes NO_SHOW, but
    // the leader is still ACCEPTED, so allDone is false. The session
    // stays ACTIVE awaiting the leader's confirm. This documents that
    // the 30-min sweep does not produce a "1 person finished, that's
    // enough" finalization — the completion gate is unchanged.
    const twId = seedTeamWorkout({
      status: 'ACTIVE',
      startedAt: new Date(NOW.getTime() - 31 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-leader',
      status: 'ACCEPTED',
      respondedAt: new Date(NOW.getTime() - 30 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-friend',
      status: 'CONFIRMED',
      confirmedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-ghost',
      status: 'INVITED',
      respondedAt: null,
    });

    const r = await cleanupStaleTeamWorkouts();

    const tw = store.teamWorkouts.find((t: any) => t.id === twId);
    expect(tw?.status).toBe('ACTIVE');
    expect(getParticipant('user-ghost', twId)?.status).toBe('NO_SHOW');
    expect(r.sessionsCompletedBySweep).toBe(0);
  });
});

// =============================================================================
// (e) 1h ABANDON sweep — COMPLETED-with-side-effects vs ABANDONED
// =============================================================================
describe('cleanupStaleTeamWorkouts — 1h ABANDON sweep', () => {
  it('(e.COMPLETED) finalizes a ≥2-CONFIRMED session with side effects, never converts to ABANDONED', async () => {
    // 90-minute-old ACTIVE session with two CONFIRMED members and a
    // still-INVITED straggler. The 1h sweep would have ABANDONED this
    // pre-Phase A — silently throwing away the CONFIRMED participants'
    // workout data and skipping the camaraderie / party buff /
    // achievement side effects. Now: sweep NO_SHOWs the straggler +
    // remaining non-terminal rows, then re-runs the shared finalize
    // path, which sees ≥1 CONFIRMED and COMPLETES with side effects.
    const twId = seedTeamWorkout({
      status: 'ACTIVE',
      startedAt: new Date(NOW.getTime() - 90 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-leader',
      status: 'CONFIRMED',
      confirmedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-friend',
      status: 'CONFIRMED',
      confirmedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-ghost',
      status: 'INVITED',
      respondedAt: null,
    });

    const r = await cleanupStaleTeamWorkouts();

    const tw = store.teamWorkouts.find((t: any) => t.id === twId);
    expect(tw?.status).toBe('COMPLETED');
    expect(tw?.completedAt).not.toBeNull();
    expect(tw?.endedAt).not.toBeNull();
    // Side effects gated on ≥2 confirmed — both confirmed users get
    // the achievement; party gets +5 camaraderie + 10% raid-dmg buff.
    expect(store.partyCamaraderies.find((c: any) => c.partyId === 'party-1')?.score).toBe(5);
    expect(store.partyBuffs.find((b: any) => b.partyId === 'party-1')?.raidDmgBonusPct).toBe(10);
    const userAchIds = store.userAchievements.map((u: any) => u.userId);
    expect(userAchIds).toContain('user-leader');
    expect(userAchIds).toContain('user-friend');
    // The ghost is swept to NO_SHOW; noShowsMarked counts BOTH sweep
    // passes' results (30-min and 1h), so it's ≥1.
    expect(r.noShowsMarked).toBeGreaterThanOrEqual(1);
    expect(r.sessionsCompletedBySweep).toBe(1);
    expect(r.sessionsAbandoned).toBe(0);
  });

  it('(e.COMPLETED.one) finalizes a session with exactly 1 CONFIRMED, but skips the ≥2-confirmed side effects', async () => {
    // Boundary: 1 CONFIRMED + leader ACCEPTED + 1 INVITED. Per the
    // spec, the COMPLETED branch (≥1 CONFIRMED → COMPLETED) fires, but
    // the side effects stay gated on ≥2 CONFIRMED, so no party buff,
    // no +5 camaraderie, no achievement. Documents the side-effect
    // gate is independent of the COMPLETED gate.
    const twId = seedTeamWorkout({
      status: 'ACTIVE',
      startedAt: new Date(NOW.getTime() - 90 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-leader',
      status: 'ACCEPTED',
      respondedAt: new Date(NOW.getTime() - 90 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-friend',
      status: 'CONFIRMED',
      confirmedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-ghost',
      status: 'INVITED',
      respondedAt: null,
    });

    const r = await cleanupStaleTeamWorkouts();

    const tw = store.teamWorkouts.find((t: any) => t.id === twId);
    expect(tw?.status).toBe('COMPLETED');
    // Side effects gated on ≥2 confirmed → none.
    expect(store.partyCamaraderies.length).toBe(0);
    expect(store.partyBuffs.length).toBe(0);
    expect(store.userAchievements.length).toBe(0);
    expect(r.sessionsCompletedBySweep).toBe(1);
    expect(r.sessionsAbandoned).toBe(0);
  });

  it('(e.ABANDONED) marks a session with 0 CONFIRMED as ABANDONED (no side effects)', async () => {
    // 90-minute-old PENDING session where nobody joined. The 1h sweep
    // marks the leader ACCEPTED + the ghost INVITED both NO_SHOW, then
    // — finding 0 CONFIRMED — sets the session ABANDONED with endedAt.
    // No side effects (camaraderie is untouched; party buff untouched).
    const twId = seedTeamWorkout({
      status: 'PENDING',
      startedAt: new Date(NOW.getTime() - 90 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-leader',
      status: 'ACCEPTED',
      respondedAt: new Date(NOW.getTime() - 90 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-ghost',
      status: 'INVITED',
      respondedAt: null,
    });

    const r = await cleanupStaleTeamWorkouts();

    const tw = store.teamWorkouts.find((t: any) => t.id === twId);
    expect(tw?.status).toBe('ABANDONED');
    expect(tw?.endedAt).not.toBeNull();
    // No side effects on ABANDONED path.
    expect(store.partyCamaraderies.length).toBe(0);
    expect(store.partyBuffs.length).toBe(0);
    expect(store.userAchievements.length).toBe(0);
    expect(r.sessionsAbandoned).toBe(1);
    expect(r.sessionsCompletedBySweep).toBe(0);
    // Both the leader ACCEPTED and the ghost INVITED get NO_SHOWed.
    expect(getParticipant('user-leader', twId)?.status).toBe('NO_SHOW');
    expect(getParticipant('user-ghost', twId)?.status).toBe('NO_SHOW');
  });

  it('(e.ABANDONED.no-invited) PENDING session with only ACCEPTED + no invites still abandons cleanly', async () => {
    // Edge case: solo leader who started the session, accepted
    // implicitly, but never had anyone to invite. After 1h of idle,
    // sweep NO_SHOWs them and ABANDONs.
    const twId = seedTeamWorkout({
      status: 'PENDING',
      startedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-leader',
      status: 'ACCEPTED',
      respondedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    });

    const r = await cleanupStaleTeamWorkouts();

    const tw = store.teamWorkouts.find((t: any) => t.id === twId);
    expect(tw?.status).toBe('ABANDONED');
    expect(getParticipant('user-leader', twId)?.status).toBe('NO_SHOW');
    expect(r.sessionsAbandoned).toBe(1);
  });

  it('(e.mixed) handles a mix of stale + fresh sessions in one pass', async () => {
    // Three sessions in one sweep:
    //   - tw-stale-2-confirmed: 90min, 2 CONFIRMED + 1 INVITED → COMPLETED
    //   - tw-stale-0-confirmed: 90min, 1 ACCEPTED + 1 INVITED → ABANDONED
    //   - tw-fresh: 5min, 1 INVITED → INVITED (no sweep, within window)
    const tw1 = seedTeamWorkout({
      id: 'tw-1',
      status: 'ACTIVE',
      startedAt: new Date(NOW.getTime() - 90 * 60 * 1000),
    });
    seedParticipant({ teamWorkoutId: tw1, userId: 'user-leader', status: 'CONFIRMED', confirmedAt: new Date(NOW.getTime() - 60 * 60 * 1000) });
    seedParticipant({ teamWorkoutId: tw1, userId: 'user-friend-1', status: 'CONFIRMED', confirmedAt: new Date(NOW.getTime() - 60 * 60 * 1000) });
    seedParticipant({ teamWorkoutId: tw1, userId: 'user-ghost-1', status: 'INVITED', respondedAt: null });

    const tw2 = seedTeamWorkout({
      id: 'tw-2',
      partyId: 'party-2',
      status: 'PENDING',
      startedAt: new Date(NOW.getTime() - 90 * 60 * 1000),
    });
    seedParticipant({ teamWorkoutId: tw2, userId: 'user-leader-2', status: 'ACCEPTED', respondedAt: new Date(NOW.getTime() - 90 * 60 * 1000) });
    seedParticipant({ teamWorkoutId: tw2, userId: 'user-ghost-2', status: 'INVITED', respondedAt: null });

    const tw3 = seedTeamWorkout({
      id: 'tw-3',
      partyId: 'party-3',
      status: 'PENDING',
      startedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
    });
    seedParticipant({ teamWorkoutId: tw3, userId: 'user-leader-3', status: 'ACCEPTED', respondedAt: new Date(NOW.getTime() - 5 * 60 * 1000) });
    seedParticipant({ teamWorkoutId: tw3, userId: 'user-ghost-3', status: 'INVITED', respondedAt: null });

    const r = await cleanupStaleTeamWorkouts();

    expect(store.teamWorkouts.find((t: any) => t.id === tw1)?.status).toBe('COMPLETED');
    expect(store.teamWorkouts.find((t: any) => t.id === tw2)?.status).toBe('ABANDONED');
    expect(store.teamWorkouts.find((t: any) => t.id === tw3)?.status).toBe('PENDING');
    expect(getParticipant('user-ghost-3', tw3)?.status).toBe('INVITED');
    // tw-2's party buff: NOT set (ABANDONED path doesn't side-effect).
    expect(store.partyBuffs.find((b: any) => b.partyId === 'party-2')).toBeUndefined();
    // tw-1's party buff: SET (COMPLETED-with-side-effects path).
    expect(store.partyBuffs.find((b: any) => b.partyId === 'party-1')?.raidDmgBonusPct).toBe(10);
    expect(r.sessionsCompletedBySweep).toBe(1);
    expect(r.sessionsAbandoned).toBe(1);
    expect(r.noShowsMarked).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// Phase A.2 (oracle must-fix) — finalize idempotency + guard
// =============================================================================
// The maybeCompleteTeamWorkout status guard + the /confirm session.status
// guard together prevent double-finalization side effects. These tests pin
// the guard's behavior so a future refactor can't silently re-introduce the
// "double-credited camaraderie + re-emitted achievement notification" bug.
describe('maybeCompleteTeamWorkout — finalize idempotency', () => {
  it('running the 1h sweep twice does NOT re-apply side effects (camaraderie +5 only once, party buff upserted once)', async () => {
    // Build the (e) COMPLETED-with-≥2-confirmed scenario:
    //   90-min ACTIVE session, 2 CONFIRMED + 1 INVITED.
    // First sweep: ghost → NO_SHOW, then maybeCompleteTeamWorkout fires
    //   (allDone=true), side effects applied.
    // Second sweep: the session is now COMPLETED, so the 1h sweep's
    //   staleSessions.findMany ({ status: PENDING|ACTIVE }) EXCLUDES it
    //   entirely. Even if it didn't, the new status guard inside
    //   maybeCompleteTeamWorkout would no-op.
    const twId = seedTeamWorkout({
      status: 'ACTIVE',
      startedAt: new Date(NOW.getTime() - 90 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-leader',
      status: 'CONFIRMED',
      confirmedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-friend',
      status: 'CONFIRMED',
      confirmedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    seedParticipant({
      teamWorkoutId: twId,
      userId: 'user-ghost',
      status: 'INVITED',
      respondedAt: null,
    });

    // Capture store sizes before the first run so we can compare counts.
    const camBefore = store.partyCamaraderies.length;
    const buffBefore = store.partyBuffs.length;
    const userAchBefore = store.userAchievements.length;

    // ----- First sweep -----
    const r1 = await cleanupStaleTeamWorkouts();
    expect(r1.sessionsCompletedBySweep).toBe(1);
    expect(r1.sessionsAbandoned).toBe(0);
    expect(r1.noShowsMarked).toBeGreaterThanOrEqual(1);
    // Side effects fired exactly once.
    expect(store.partyCamaraderies.length).toBe(camBefore + 1);
    expect(store.partyBuffs.length).toBe(buffBefore + 1);
    expect(store.partyCamaraderies[0].score).toBe(5);
    expect(store.partyBuffs[0].raidDmgBonusPct).toBe(10);
    expect(store.userAchievements.length).toBe(userAchBefore + 2);
    // 2 emitNotification calls (one per confirmed user — leader + friend).
    expect(emitNotificationMock.mock.calls.length).toBe(2);
    const emitCallsAfterFirst = emitNotificationMock.mock.calls.length;

    // ----- Second sweep -----
    const r2 = await cleanupStaleTeamWorkouts();
    // Session is COMPLETED — 1h sweep's findMany filter excludes it,
    // 30-min sweep's affectedByNoShow also excludes it (no INVITED
    // participants left). Both passes do nothing.
    expect(r2.sessionsCompletedBySweep).toBe(0);
    expect(r2.sessionsAbandoned).toBe(0);
    expect(r2.noShowsMarked).toBe(0);
    // Side-effect store sizes UNCHANGED — no double-credits, no duplicate
    // party buff upserts, no re-emitted achievement notifications.
    expect(store.partyCamaraderies.length).toBe(camBefore + 1);
    expect(store.partyBuffs.length).toBe(buffBefore + 1);
    expect(store.userAchievements.length).toBe(userAchBefore + 2);
    expect(emitNotificationMock.mock.calls.length).toBe(emitCallsAfterFirst);
    // The party's camaraderie score is still 5 (additive +5 NOT re-applied).
    expect(store.partyCamaraderies[0].score).toBe(5);
  });

  it('directly calling maybeCompleteTeamWorkout on an already-COMPLETED session is a no-op (no new side effects)', async () => {
    // Pin the status guard's behavior at the unit level. Even if some
    // future caller skips the cleanup wrapper and invokes the finalize
    // helper directly against a finalized session, the guard prevents
    // the additive side effects.
    const twId = seedTeamWorkout({
      status: 'COMPLETED',
      startedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
      // completedAt / endedAt seeded implicitly via the helper nulls —
      // we set them explicitly so the row looks like a real finalized session.
    });
    const tw = store.teamWorkouts.find((t: any) => t.id === twId);
    tw.completedAt = new Date(NOW.getTime() - 4 * 60 * 1000);
    tw.endedAt = new Date(NOW.getTime() - 4 * 60 * 1000);
    // All-terminal participants (matches what a real COMPLETED session
    // looks like post-finalize).
    seedParticipant({ teamWorkoutId: twId, userId: 'user-leader', status: 'CONFIRMED', confirmedAt: new Date(NOW.getTime() - 4 * 60 * 1000) });
    seedParticipant({ teamWorkoutId: twId, userId: 'user-friend', status: 'CONFIRMED', confirmedAt: new Date(NOW.getTime() - 4 * 60 * 1000) });

    const camBefore = store.partyCamaraderies.length;
    const buffBefore = store.partyBuffs.length;
    const userAchBefore = store.userAchievements.length;
    const emitCallsBefore = emitNotificationMock.mock.calls.length;

    await maybeCompleteTeamWorkout(twId);

    // Status guard fires before any side-effect code runs.
    expect(store.partyCamaraderies.length).toBe(camBefore);
    expect(store.partyBuffs.length).toBe(buffBefore);
    expect(store.userAchievements.length).toBe(userAchBefore);
    expect(emitNotificationMock.mock.calls.length).toBe(emitCallsBefore);
  });

  it('directly calling maybeCompleteTeamWorkout on an ABANDONED session does NOT resurrect it to COMPLETED', async () => {
    // The other half of the guard: a leader-abandoned session (status
    // ABANDONED, all participants swept to NO_SHOW by the 1h sweep)
    // must stay ABANDONED. Without the guard, the allDone check would
    // pass (all participants ∈ {CONFIRMED, DECLINED, NO_SHOW}) and the
    // status update would resurrect the session.
    const twId = seedTeamWorkout({
      status: 'ABANDONED',
      startedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    });
    const tw = store.teamWorkouts.find((t: any) => t.id === twId);
    tw.endedAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    // Swept by the 1h pass — all NO_SHOW.
    seedParticipant({ teamWorkoutId: twId, userId: 'user-leader', status: 'NO_SHOW' });
    seedParticipant({ teamWorkoutId: twId, userId: 'user-ghost', status: 'NO_SHOW' });

    const camBefore = store.partyCamaraderies.length;
    const buffBefore = store.partyBuffs.length;
    const userAchBefore = store.userAchievements.length;

    await maybeCompleteTeamWorkout(twId);

    // Status is preserved — ABANDONED stays ABANDONED.
    expect(store.teamWorkouts.find((t: any) => t.id === twId)?.status).toBe('ABANDONED');
    // No side effects fire.
    expect(store.partyCamaraderies.length).toBe(camBefore);
    expect(store.partyBuffs.length).toBe(buffBefore);
    expect(store.userAchievements.length).toBe(userAchBefore);
  });
});