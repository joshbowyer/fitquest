import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { checkAchievements } from '../lib/achievements.js';

const CreateSchema = z.object({ name: z.string().min(2).max(60) });

const InviteSchema = z.object({
  username: z.string().min(1).max(40),
  message: z.string().max(200).optional(),
});

export async function partyRoutes(app: FastifyInstance) {
  app.get('/me', async (req) => {
    const me = await requireUser(req);
    const membership = await prisma.partyMember.findUnique({
      where: { userId: me.id },
      include: {
        party: {
          include: {
            members: { include: { user: { select: { id: true, username: true, class: true, level: true } } } },
            raids: { orderBy: { startedAt: 'desc' }, take: 5 },
          },
        },
      },
    });
    return { party: membership?.party ?? null, role: membership?.role ?? null };
  });

  app.get('/list', async (req) => {
    const me = await requireUser(req);
    const items = await prisma.party.findMany({
      where: {
        members: { none: { userId: me.id } },
      },
      include: { members: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { items: items.map((p) => ({ id: p.id, name: p.name, memberCount: p.members.length })) };
  });

  app.post('/', async (req) => {
    const me = await requireUser(req);
    const body = CreateSchema.parse(req.body);
    const existing = await prisma.partyMember.findUnique({ where: { userId: me.id } });
    if (existing) return { error: 'Already in a party' };
    const party = await prisma.party.create({
      data: {
        name: body.name,
        members: { create: { userId: me.id, role: 'LEADER' } },
      },
      include: { members: { include: { user: true } } },
    });
    await checkAchievements(me.id);
    return { party };
  });

  app.post('/:id/join', async (req) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const existing = await prisma.partyMember.findUnique({ where: { userId: me.id } });
    if (existing) return { error: 'Already in a party' };
    const party = await prisma.party.findUnique({ where: { id } });
    if (!party) return { error: 'Party not found' };
    await prisma.partyMember.create({ data: { partyId: id, userId: me.id, role: 'MEMBER' } });
    await checkAchievements(me.id);
    return { ok: true };
  });

  app.post('/leave', async (req) => {
    const me = await requireUser(req);
    const membership = await prisma.partyMember.findUnique({ where: { userId: me.id } });
    if (!membership) return { error: 'Not in a party' };
    // Capture party name + remaining-member list BEFORE delete
    // so we can both fan out a "X left" notification and decide
    // whether to skip the notification entirely when the party
    // is about to disband (last member leaving → no audience).
    const party = await prisma.party.findUnique({ where: { id: membership.partyId } });
    const remainingMembers = await prisma.partyMember.findMany({
      where: { partyId: membership.partyId, userId: { not: me.id } },
      select: { userId: true },
    });
    await prisma.partyMember.delete({ where: { id: membership.id } });
    // If empty, delete the party
    const remaining = await prisma.partyMember.count({ where: { partyId: membership.partyId } });
    if (remaining === 0) {
      await prisma.party.delete({ where: { id: membership.partyId } }).catch(() => {});
    }
    // Notify remaining members that someone left. Skip when the
    // leave empties the party (no one to notify — and a
    // disbanding party is the natural consequence of the last
    // member leaving, not a separate event).
    if (remaining > 0) {
      try {
        const { emitNotification } = await import('../lib/notify.js');
        await Promise.all(remainingMembers.map((r) =>
          emitNotification({
            userId: r.userId,
            category: 'SYSTEM',
            kind: 'party_member_left',
            title: `${me.username} left ${party?.name ?? 'the party'}`,
            body: 'Your party roster has shrunk.',
            link: '/party',
            payload: {
              partyId: membership.partyId,
              partyName: party?.name ?? null,
              leaverUsername: me.username,
              remainingCount: remaining,
            },
          }),
        ));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[parties] party_member_left emit failed', { userId: me.id, err });
      }
    }
    return { ok: true };
  });

  // POST /:id/invite — invite a user by username to join this party
  app.post<{ Params: { id: string } }>('/:id/invite', async (req, reply) => {
    const me = await requireUser(req);
    const { id } = req.params;
    const body = InviteSchema.parse(req.body);

    // Verify caller is in the party
    const myMembership = await prisma.partyMember.findUnique({ where: { userId: me.id } });
    if (!myMembership || myMembership.partyId !== id) {
      return reply.code(403).send({ error: 'Not a member of this party' });
    }

    // Find the invitee by username (case-insensitive lookup via
    // the User.usernameLower unique column).
    const invitee = await prisma.user.findUnique({
      where: { usernameLower: body.username.toLowerCase() },
    });

    // Prevent inviting yourself or someone already in the party
    if (invitee && invitee.id === me.id) {
      return reply.code(400).send({ error: 'Cannot invite yourself' });
    }
    if (invitee) {
      const existingMember = await prisma.partyMember.findUnique({
        where: { userId: invitee.id },
      });
      if (existingMember) {
        return reply.code(400).send({ error: 'User is already in a party' });
      }
    }

    // Expire any existing PENDING invites from this inviter to the
    // same username (in case they resent).
    await prisma.partyInvite.updateMany({
      where: {
        partyId: id,
        inviteeUsername: body.username,
        status: 'PENDING',
      },
      data: { status: 'EXPIRED' },
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invite = await prisma.partyInvite.create({
      data: {
        partyId: id,
        inviterId: me.id,
        inviteeId: invitee?.id ?? null,
        inviteeUsername: body.username,
        message: body.message,
        expiresAt,
      },
    });
    // Notify the invitee — but only if they're a known user
    // (the username might be a typo / unregistered player; we
    // can't deliver a notification to no one). Also capture
    // the party name before the response so the body can read
    // naturally.
    if (invitee) {
      const party = await prisma.party.findUnique({ where: { id } });
      try {
        const { emitNotification } = await import('../lib/notify.js');
        await emitNotification({
          userId: invitee.id,
          category: 'SYSTEM',
          kind: 'party_invite_received',
          title: `${me.username} invited you to ${party?.name ?? 'a party'}`,
          body: body.message ?? 'Open /party to accept or decline.',
          link: '/party',
          payload: {
            inviteId: invite.id,
            partyId: id,
            partyName: party?.name ?? null,
            inviterId: me.id,
            inviterUsername: me.username,
            message: body.message ?? null,
            expiresAt: expiresAt.toISOString(),
          },
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[parties] party_invite_received emit failed', { userId: invitee.id, err });
      }
    }
    return { invite };
  });

  // GET /invites — list current user's PENDING invites
  app.get('/invites', async (req) => {
    const me = await requireUser(req);
    const invites = await prisma.partyInvite.findMany({
      where: {
        OR: [{ inviteeId: me.id }, { inviteeUsername: me.username }],
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        party: { select: { id: true, name: true } },
        inviter: { select: { id: true, username: true, class: true, level: true } },
      },
    });
    return { invites };
  });

  // POST /invites/:id/accept — accept a pending invite
  app.post<{ Params: { id: string } }>('/invites/:id/accept', async (req, reply) => {
    const me = await requireUser(req);
    const { id } = req.params;
    const invite = await prisma.partyInvite.findUnique({ where: { id } });
    if (!invite) return reply.code(404).send({ error: 'Invite not found' });
    if (invite.status !== 'PENDING') {
      return reply.code(400).send({ error: 'Invite already responded to' });
    }
    if (invite.expiresAt < new Date()) {
      return reply.code(400).send({ error: 'Invite expired' });
    }
    // Verify the invite is for this user (by username OR inviteeId)
    const isForMe =
      invite.inviteeId === me.id || invite.inviteeUsername === me.username;
    if (!isForMe) {
      return reply.code(403).send({ error: 'Not your invite' });
    }
    // Verify the user isn't already in a party
    const existing = await prisma.partyMember.findUnique({ where: { userId: me.id } });
    if (existing) {
      return reply.code(400).send({ error: 'You are already in a party' });
    }

    await prisma.partyInvite.update({
      where: { id },
      data: { status: 'ACCEPTED', respondedAt: new Date(), inviteeId: me.id },
    });
    await prisma.partyMember.create({
      data: { partyId: invite.partyId, userId: me.id, role: 'MEMBER' },
    });
    await checkAchievements(me.id);
    // Notify the other party members that the roster grew. The
    // joiner is excluded (they're already aware). Captures the
    // inviter's username + party name before the response.
    try {
      const inviter = await prisma.user.findUnique({
        where: { id: invite.inviterId },
        select: { username: true },
      });
      const party = await prisma.party.findUnique({ where: { id: invite.partyId } });
      const others = await prisma.partyMember.findMany({
        where: { partyId: invite.partyId, userId: { not: me.id } },
        select: { userId: true },
      });
      const { emitNotification } = await import('../lib/notify.js');
      await Promise.all(others.map((o) =>
        emitNotification({
          userId: o.userId,
          category: 'SYSTEM',
          kind: 'party_member_joined',
          title: `${me.username} joined ${party?.name ?? 'the party'}`,
          body: inviter ? `Invited by ${inviter.username}.` : 'New member joined.',
          link: '/party',
          payload: {
            partyId: invite.partyId,
            partyName: party?.name ?? null,
            newMemberId: me.id,
            newMemberUsername: me.username,
            inviterId: invite.inviterId,
            inviterUsername: inviter?.username ?? null,
          },
        }),
      ));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[parties] party_member_joined emit failed', { userId: me.id, err });
    }
    return { ok: true, partyId: invite.partyId };
  });

  // POST /invites/:id/decline — decline a pending invite
  app.post<{ Params: { id: string } }>('/invites/:id/decline', async (req, reply) => {
    const me = await requireUser(req);
    const { id } = req.params;
    const invite = await prisma.partyInvite.findUnique({ where: { id } });
    if (!invite) return reply.code(404).send({ error: 'Invite not found' });
    if (invite.status !== 'PENDING') {
      return reply.code(400).send({ error: 'Invite already responded to' });
    }
    const isForMe =
      invite.inviteeId === me.id || invite.inviteeUsername === me.username;
    if (!isForMe) {
      return reply.code(403).send({ error: 'Not your invite' });
    }
    await prisma.partyInvite.update({
      where: { id },
      data: { status: 'DECLINED', respondedAt: new Date(), inviteeId: me.id },
    });
    // Notify the inviter so they know the slot is open again
    // (or to take the hint that the invitee isn't interested).
    // Only one recipient — the original inviter — so no fan-out.
    try {
      const party = await prisma.party.findUnique({ where: { id: invite.partyId } });
      const { emitNotification } = await import('../lib/notify.js');
      await emitNotification({
        userId: invite.inviterId,
        category: 'SYSTEM',
        kind: 'party_invite_declined',
        title: `${me.username} declined your invite`,
        body: party ? `No slot consumed in ${party.name}.` : 'Invite declined.',
        link: '/party',
        payload: {
          inviteId: invite.id,
          partyId: invite.partyId,
          partyName: party?.name ?? null,
          declinerId: me.id,
          declinerUsername: me.username,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[parties] party_invite_declined emit failed', { userId: me.id, err });
    }
    return { ok: true };
  });
}
