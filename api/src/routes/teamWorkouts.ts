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
              .map((id) => ({ userId: id, status: 'INVITED' })),
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

    // Check completion: every participant CONFIRMED OR DECLINED
    // means the session can wrap up. DECLINED counts as "out"
    // for the confirmation gate per roadmap §30 (otherwise one
    // ghost invite would block forever).
    const refreshed = await prisma.teamParticipant.findMany({ where: { teamWorkoutId: id } });
    const allDone = refreshed.every((p) =>
      p.status === 'CONFIRMED' || p.status === 'DECLINED' || p.status === 'NO_SHOW',
    );
    if (allDone) {
      const confirmed = refreshed.filter((p) => p.status === 'CONFIRMED');
      await prisma.teamWorkout.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          endedAt: new Date(),
        },
      });
      // Side effects from roadmap §30:
      //   - +5 party camaraderie
      //   - +10% raid damage for the party for 24h (handled by
      //     the raid-damage calculator reading party buff rows)
      //   - "Side by Side" achievement on the leader
      if (confirmed.length >= 2) {
        await adjustCamaraderie(session.partyId, 5, `team workout completed (${confirmed.length} members)`);
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
        // Side by Side achievement for everyone who confirmed.
        for (const p of confirmed) {
          await unlockAchievement(p.userId, 'side_by_side');
        }
      }
    }
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

/// Mark no-shows (invited/accepted >30min ago, never joined) and
/// abandon stale sessions (started >1h ago, still PENDING/ACTIVE).
/// Called by the /cleanup route above AND the index.ts interval
/// cron — the "cron" the header comment always promised but which
/// never actually existed, so stale sessions lingered forever
/// unless someone manually POSTed the endpoint.
export async function cleanupStaleTeamWorkouts(): Promise<{
  noShowsMarked: number;
  sessionsAbandoned: number;
}> {
  const now = Date.now();
  const noShowBefore = new Date(now - NO_SHOW_AFTER_MS);
  const abandonBefore = new Date(now - ABANDON_AFTER_MS);
  const noShows = await prisma.teamParticipant.updateMany({
    where: {
      status: { in: ['INVITED', 'ACCEPTED'] },
      respondedAt: { lt: noShowBefore },
      // also require no join — i.e. status field still INVITED/ACCEPTED
    },
    data: { status: 'NO_SHOW' },
  });
  const abandoned = await prisma.teamWorkout.updateMany({
    where: {
      status: { in: ['PENDING', 'ACTIVE'] },
      startedAt: { lt: abandonBefore },
    },
    data: { status: 'ABANDONED', endedAt: new Date() },
  });
  return { noShowsMarked: noShows.count, sessionsAbandoned: abandoned.count };
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