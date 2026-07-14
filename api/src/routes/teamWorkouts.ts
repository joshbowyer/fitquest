import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { adjustCamaraderie } from '../lib/camaraderie.js';

const MAX_PARTICIPANTS = 4;
/// Sessions that go inactive for >1h get auto-abandoned by the
/// /team-workouts/cleanup cron (called from index.ts on a
/// setInterval). The window is generous because freestyle mode
/// can run long; tighter windows would mark legit 90-minute
/// lifting sessions as abandoned.
const ABANDON_AFTER_MS = 60 * 60 * 1000;
/// Invitees that don't respond within 30 min get marked
/// NO_SHOW so the leader knows who's actually showing up.
const NO_SHOW_AFTER_MS = 30 * 60 * 1000;

export async function teamWorkoutRoutes(app: FastifyInstance) {
  // ----- Leader starts a team workout -----
  app.post('/', async (req, reply) => {
    const me = await requireUser(req);
    const body = req.body as {
      participantIds?: string[];
      routineName?: string | null;
    };
    if (!Array.isArray(body.participantIds)) {
      return reply.code(400).send({ error: 'participantIds required' });
    }
    if (body.participantIds.length < 1 || body.participantIds.length > MAX_PARTICIPANTS) {
      return reply.code(400).send({ error: `participantIds must be 1-${MAX_PARTICIPANTS}` });
    }
    // Leader must be in a party; invitees must be members of the
    // same party. Cross-party team workouts would be a footgun:
    // raid damage bonuses apply to "your party", not "your
    // arbitrary friends list".
    const myParty = await prisma.partyMember.findFirst({
      where: { userId: me.id },
      include: { party: { include: { members: true } } },
    });
    if (!myParty) {
      return reply.code(400).send({ error: 'must be in a party to start a team workout' });
    }
    const memberIds = new Set(myParty.party.members.map((m) => m.userId));
    for (const id of body.participantIds) {
      if (!memberIds.has(id)) {
        return reply.code(400).send({ error: `user ${id} not in your party` });
      }
    }
    if (!memberIds.has(me.id)) {
      return reply.code(400).send({ error: 'leader not in party' });
    }

    // Implicit-accept for the leader (roadmap §27).
    const session = await prisma.teamWorkout.create({
      data: {
        partyId: myParty.partyId,
        leaderId: me.id,
        routineName: body.routineName ?? null,
        status: 'PENDING',
        participants: {
          create: [
            { userId: me.id, status: 'ACCEPTED', respondedAt: new Date() },
            ...body.participantIds
              .filter((id) => id !== me.id)
              // 'as const' so the literal isn't widened to `string`
              // (Prisma's enum field rejects `string` here).
              .map((id) => ({ userId: id, status: 'INVITED' as const })),
          ],
        },
      },
      include: {
        participants: { include: { user: { select: { id: true, username: true, level: true, class: true, units: true } } } },
        leader: { select: { id: true, username: true, level: true, class: true, units: true } },
      },
    });
    return session;
  });

  // ----- Current user's active or pending team workouts -----
  app.get('/active', async (req) => {
    const me = await requireUser(req);
    const items = await prisma.teamWorkout.findMany({
      where: {
        status: { in: ['PENDING', 'ACTIVE'] },
        OR: [
          { leaderId: me.id },
          { participants: { some: { userId: me.id } } },
        ],
      },
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, username: true, level: true, class: true, units: true },
            },
          },
        },
        leader: {
          select: { id: true, username: true, level: true, class: true, units: true },
        },
      },
      orderBy: { startedAt: 'desc' },
    });
    return { items };
  });

  // ----- Single session detail (used by the split-pane UI) -----
  app.get('/:id', async (req) => {
    const me = await requireUser(req);
    const id = (req.params as any).id as string;
    const session = await prisma.teamWorkout.findUnique({
      where: { id },
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, username: true, level: true, class: true, units: true },
            },
          },
        },
        leader: {
          select: { id: true, username: true, level: true, class: true, units: true },
        },
      },
    });
    if (!session) {
      return { error: 'not found' };
    }
    const isParticipant =
      session.leaderId === me.id ||
      session.participants.some((p) => p.userId === me.id);
    if (!isParticipant) {
      return { error: 'not authorized' };
    }
    return session;
  });

  // ----- Invitees respond (accept/decline) -----
  app.post('/:id/respond', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id as string;
    const body = req.body as { accept?: boolean };
    const accept = body.accept !== false;
    const session = await prisma.teamWorkout.findUnique({
      where: { id },
      include: { participants: true },
    });
    if (!session) return reply.code(404).send({ error: 'not found' });
    if (session.status === 'COMPLETED' || session.status === 'ABANDONED') {
      return reply.code(400).send({ error: 'session already finalized' });
    }
    const me_part = session.participants.find((p) => p.userId === me.id);
    if (!me_part) return reply.code(403).send({ error: 'not invited' });
    if (me_part.userId === session.leaderId) {
      return reply.code(400).send({ error: 'leader implicit-accepted; use abandon' });
    }
    await prisma.teamParticipant.update({
      where: { id: me_part.id },
      data: {
        status: accept ? 'ACCEPTED' : 'DECLINED',
        respondedAt: new Date(),
      },
    });
    return { ok: true };
  });

  // ----- Participant marks "I've started" (joined) -----
  app.post('/:id/join', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id as string;
    const session = await prisma.teamWorkout.findUnique({
      where: { id },
      include: { participants: true },
    });
    if (!session) return reply.code(404).send({ error: 'not found' });
    const me_part = session.participants.find((p) => p.userId === me.id);
    if (!me_part) return reply.code(403).send({ error: 'not invited' });
    if (me_part.status === 'DECLINED') {
      return reply.code(400).send({ error: 'declined; cannot join' });
    }
    await prisma.teamParticipant.update({
      where: { id: me_part.id },
      data: { status: 'JOINED', respondedAt: new Date() },
    });
    // First JOINED flips the session into ACTIVE state.
    if (session.status === 'PENDING') {
      await prisma.teamWorkout.update({
        where: { id },
        data: { status: 'ACTIVE' },
      });
    }
    return { ok: true };
  });

  // ----- Participant commits their workout + taps "I'm done" -----
  // The workout is created via the existing /workouts route
  // (single-player path). We just attach its id here.
  app.post('/:id/confirm', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id as string;
    const body = req.body as { workoutId?: string };
    if (!body.workoutId) return reply.code(400).send({ error: 'workoutId required' });
    const session = await prisma.teamWorkout.findUnique({
      where: { id },
      include: { participants: true, party: true },
    });
    if (!session) return reply.code(404).send({ error: 'not found' });
    if (session.status === 'COMPLETED' || session.status === 'ABANDONED') {
      // Mirror the /respond handler's guard. Without this, a late
      // /confirm POST against an already-finalized session would
      // re-run the additive side effects (camaraderie +5, party buff
      // refresh, side_by_side achievement re-emit) — the same
      // double-finalize risk the maybeCompleteTeamWorkout status guard
      // prevents on the cleanup path. Failing closed with 400 keeps
      // the API contract honest: a confirmed workout can't be
      // "re-confirmed" against a closed session.
      return reply.code(400).send({ error: 'session already finalized' });
    }
    const me_part = session.participants.find((p) => p.userId === me.id);
    if (!me_part) return reply.code(403).send({ error: 'not in session' });
    if (me_part.status === 'DECLINED') {
      return reply.code(400).send({ error: 'declined; cannot confirm' });
    }
    const workout = await prisma.workout.findUnique({ where: { id: body.workoutId } });
    if (!workout || workout.userId !== me.id) {
      return reply.code(400).send({ error: 'workout not yours' });
    }
    await prisma.teamParticipant.update({
      where: { id: me_part.id },
      data: {
        status: 'CONFIRMED',
        workoutId: body.workoutId,
        confirmedAt: new Date(),
      },
    });

    // Reuse the shared finalize path (also called from cleanupStaleTeamWorkouts
    // after a 30-min NO_SHOW sweep). The function reloads participants,
    // checks `allDone = every status ∈ {CONFIRMED, DECLINED, NO_SHOW}`, and
    // if so sets status=COMPLETED + completedAt + endedAt. Side effects
    // (camaraderie +5, party buff upsert, side_by_side achievement) are
    // gated on ≥2 confirmed — preserves the pre-refactor behavior of /confirm.
    await maybeCompleteTeamWorkout(id);
    return { ok: true };
  });

  // ----- Leader cancels the session (no penalty if PENDING; small
  //       penalty if anyone had JOINED) -----
  app.post('/:id/abandon', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id as string;
    const session = await prisma.teamWorkout.findUnique({ where: { id } });
    if (!session) return reply.code(404).send({ error: 'not found' });
    if (session.leaderId !== me.id) {
      return reply.code(403).send({ error: 'only leader can abandon' });
    }
    if (session.status === 'COMPLETED') {
      return reply.code(400).send({ error: 'already completed' });
    }
    await prisma.teamWorkout.update({
      where: { id },
      data: { status: 'ABANDONED', endedAt: new Date() },
    });
    if (session.status === 'ACTIVE') {
      await adjustCamaraderie(session.partyId, -1, `team workout abandoned by leader`);
    }
    return { ok: true };
  });

  // ----- Cron: mark no-shows + abandon stale sessions -----
  // requireUser: this was the only unauthenticated state-mutating
  // route in the API — anyone on the network could force-mark
  // participants NO_SHOW / sessions ABANDONED for every user. The
  // operation is timestamp-gated housekeeping (only touches rows
  // that are genuinely stale), so any signed-in user may trigger
  // it; the real cadence comes from the index.ts interval, which
  // calls cleanupStaleTeamWorkouts() directly.
  app.post('/cleanup', async (req) => {
    await requireUser(req);
    return cleanupStaleTeamWorkouts();
  });
}

/// Shared finalize path for the team-workout completion gate. Called
/// from POST /:id/confirm (replacing the inline finalize that used to
/// live there) AND from cleanupStaleTeamWorkouts when the 30-min NO_SHOW
/// sweep turns the last non-confirmed participant of an otherwise-
/// complete session into NO_SHOW.
///
/// Logic:
///   - Load the session + participants.
///   - `allDone` = every participant's status ∈ {CONFIRMED, DECLINED,
///     NO_SHOW}. DECLINED counts as "out" per roadmap §30 (otherwise
///     one ghost invite would block forever).
///   - If allDone: set status=COMPLETED + completedAt + endedAt.
///   - Side effects (gated on ≥2 confirmed, preserved from the
///     pre-refactor /confirm behavior):
///       +5 party camaraderie
///       +10% raid-damage party buff for 24h (read by the raid-damage
///         calculator from the party buff row)
///       "Side by Side" achievement for every confirmed participant
///       (the leader gets one too — the original code unlocked for
///       every confirmed participant, not just the leader)
///
/// Returns nothing; side effects bubble as exceptions (which the
/// caller in /confirm propagates to the HTTP response). The cleanup
/// cron is best-effort and swallows its own errors at the call site
/// in index.ts.
export async function maybeCompleteTeamWorkout(id: string): Promise<void> {
  const session = await prisma.teamWorkout.findUnique({
    where: { id },
    include: { participants: true },
  });
  if (!session) return;
  // Guard: never finalize a session that's already finalized. Without this,
  // a re-call (e.g. the cleanup cron running again, or a /confirm racing
  // with the cron) would re-run the additive side effects:
  //   - adjustCamaraderie(+5) is additive — double-credits the party
  //   - side_by_side re-emits an achievement notification (the user
  //     sees "Achievement unlocked" again, even though UserAchievement
  //     is correctly idempotent)
  //   - status could be flipped from ABANDONED → COMPLETED, resurrecting
  //     a session the leader deliberately cancelled or that the 1h sweep
  //     marked ABANDONED
  if (session.status !== 'PENDING' && session.status !== 'ACTIVE') return;
  const allDone = session.participants.every((p) =>
    p.status === 'CONFIRMED' || p.status === 'DECLINED' || p.status === 'NO_SHOW',
  );
  if (!allDone) return;
  const confirmed = session.participants.filter((p) => p.status === 'CONFIRMED');
  await prisma.teamWorkout.update({
    where: { id },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      endedAt: new Date(),
    },
  });
  if (confirmed.length >= 2) {
    await adjustCamaraderie(
      session.partyId,
      5,
      `team workout completed (${confirmed.length} members)`,
    );
    await prisma.partyBuff.upsert({
      where: { partyId: session.partyId },
      create: {
        partyId: session.partyId,
        raidDmgBonusPct: 10,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        reason: 'team workout',
      },
      update: {
        raidDmgBonusPct: 10,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        reason: 'team workout',
      },
    });
    for (const p of confirmed) {
      await unlockAchievement(p.userId, 'side_by_side');
    }
  }
}

/// Mark no-shows (INVITED-never-responded >30min) and finalize stale
/// sessions (started >1h ago, still PENDING/ACTIVE). Called by the
/// /cleanup route above AND the index.ts interval cron — the "cron"
/// the header comment always promised but which never actually
/// existed, so stale sessions lingered forever unless someone manually
/// POSTed the endpoint.
///
/// Phase A fixes:
///   - NO_SHOW sweep now keys off `status='INVITED'` + a relation filter
///     on the parent teamWorkout (non-finalized AND stale). The old
///     filter keyed off `respondedAt < now-30min`, but INVITED rows are
///     created without `respondedAt` (null) — so it NEVER matched real
///     non-responders, and instead ate the leader's ACCEPTED row (the
///     only kind with a non-null respondedAt). INVITED-only already
///     excludes the leader and ACCEPTED/JOINED participants.
///   - After the sweep, each affected still-live session is re-checked
///     via maybeCompleteTeamWorkout. A session where everyone else
///     already CONFIRMED + the last non-confirmed participant just
///     became NO_SHOW now finalizes properly instead of hanging.
///   - The 1h sweep no longer blindly converts stale sessions to
///     ABANDONED. It first marks the remaining non-terminal participants
///     (INVITED/ACCEPTED/JOINED) NO_SHOW, then finalizes via the shared
///     path (COMPLETED if ≥1 CONFIRMED — side effects still ≥2 — else
///     ABANDONED). Sessions with confirmed work are never converted.
///
/// Return shape preserved for index.ts:372-381 (`noShowsMarked` +
/// `sessionsAbandoned`). A new `sessionsCompletedBySweep` counter is
/// exposed so observability dashboards / future tests can split the
/// two finalization outcomes.
export async function cleanupStaleTeamWorkouts(): Promise<{
  noShowsMarked: number;
  sessionsAbandoned: number;
  sessionsCompletedBySweep: number;
}> {
  const now = Date.now();
  const noShowBefore = new Date(now - NO_SHOW_AFTER_MS);
  const abandonBefore = new Date(now - ABANDON_AFTER_MS);

  // ----- 30-min NO_SHOW sweep -----
  // Collect the affected live sessions up front so we can re-check them
  // for completion after the bulk update. updateMany returns just the
  // count, not the rows, so we need this separate findMany.
  const affectedByNoShow = await prisma.teamWorkout.findMany({
    where: {
      status: { in: ['PENDING', 'ACTIVE'] },
      startedAt: { lt: noShowBefore },
      participants: { some: { status: 'INVITED' } },
    },
    select: { id: true },
  });
  const noShows = await prisma.teamParticipant.updateMany({
    where: {
      status: 'INVITED',
      // Relation filter on the parent teamWorkout — must be a
      // non-finalized session past the 30-min threshold. This
      // replaces the old `respondedAt: { lt: noShowBefore }` clause
      // (which was unreachable for INVITED rows since they have
      // null respondedAt) AND keeps finalized sessions untouched
      // (a defensive guarantee the relation filter buys us).
      teamWorkout: {
        is: {
          status: { in: ['PENDING', 'ACTIVE'] },
          startedAt: { lt: noShowBefore },
        },
      },
    },
    data: { status: 'NO_SHOW' },
  });
  // Re-check each affected still-live session. A session where every
  // participant is now CONFIRMED | DECLINED | NO_SHOW finalizes via
  // the shared path; everything else stays as-is (e.g. one CONFIRMED
  // + one NO_SHOW + several ACCEPTED still needs the ACCEPTED folks
  // to confirm or get swept later).
  let sessionsCompletedBySweep = 0;
  for (const s of affectedByNoShow) {
    await maybeCompleteTeamWorkout(s.id);
    // Track transitions. affectedByNoShow is filtered to PENDING/ACTIVE
    // sessions, so a status=COMPLETED post-call means the finalize
    // fired (no double-count risk from re-calling on already-finalized
    // sessions). One extra findUnique per affected session — minor
    // overhead in a 15-min cron that affects at most a handful of rows.
    const after = await prisma.teamWorkout.findUnique({
      where: { id: s.id },
      select: { status: true },
    });
    if (after?.status === 'COMPLETED') sessionsCompletedBySweep++;
  }

  // ----- 1h ABANDON sweep -----
  // For each stale live session, mark remaining non-terminal
  // participants NO_SHOW, then decide COMPLETED vs ABANDONED on
  // fresh state. The shared finalize path handles side effects
  // (still gated on ≥2 confirmed) when COMPLETED wins.
  const staleSessions = await prisma.teamWorkout.findMany({
    where: {
      status: { in: ['PENDING', 'ACTIVE'] },
      startedAt: { lt: abandonBefore },
    },
    select: { id: true },
  });
  let noShowsMarked = noShows.count;
  let sessionsAbandoned = 0;
  for (const s of staleSessions) {
    const u = await prisma.teamParticipant.updateMany({
      where: {
        teamWorkoutId: s.id,
        status: { in: ['INVITED', 'ACCEPTED', 'JOINED'] },
      },
      data: { status: 'NO_SHOW' },
    });
    noShowsMarked += u.count;
    // Re-load participants on fresh state — the race window between
    // the findMany above and the updateMany here is tiny but checking
    // fresh state honors "NEVER convert a session with confirmed work
    // into ABANDONED". If a /confirm landed between findMany and now,
    // we'll see the new CONFIRMED participant and finalize properly.
    const refreshed = await prisma.teamParticipant.findMany({
      where: { teamWorkoutId: s.id },
      select: { status: true },
    });
    const hasConfirmed = refreshed.some((p) => p.status === 'CONFIRMED');
    if (hasConfirmed) {
      await maybeCompleteTeamWorkout(s.id);
      sessionsCompletedBySweep++;
    } else {
      await prisma.teamWorkout.update({
        where: { id: s.id },
        data: { status: 'ABANDONED', endedAt: new Date() },
      });
      sessionsAbandoned++;
    }
  }
  return { noShowsMarked, sessionsAbandoned, sessionsCompletedBySweep };
}

async function unlockAchievement(userId: string, key: string): Promise<void> {
  // Look up the achievement def by its key; if missing, fail
  // silently — the catalog can change between releases.
  const ach = await prisma.achievement.findUnique({ where: { key } });
  if (!ach) return;
  await prisma.userAchievement.upsert({
    where: { userId_achievementId: { userId, achievementId: ach.id } },
    create: { userId, achievementId: ach.id },
    update: {},
  });
  // `unlockAchievement` is the out-of-band path (bypasses
  // `checkAchievements` so the central emit funnel doesn't
  // catch it). Light a notification manually so the inbox
  // mirrors the UserAchievement row. Idempotent on the inbox
  // via the same per-(user, key) dedup we'd get from the
  // central funnel — a repeat call lands on the upsert's
  // `update: {}` no-op branch, but `emitNotification` still
  // fires. A real fix would add a per-(user, achievementId)
  // "did we already notify?" check; the rate of this call
  // (once per team-workout completion per participant) is
  // low enough that the rare double-notify on a retry is
  // acceptable.
  const { emitNotification } = await import('../lib/notify.js');
  await emitNotification({
    userId,
    category: 'ACHIEVEMENT',
    kind: 'achievement_unlocked',
    title: `Achievement unlocked: ${ach.name}`,
    body: ach.description,
    link: '/achievements',
    payload: { key: ach.key, category: ach.category, points: ach.points, source: 'direct_grant' },
  });
}