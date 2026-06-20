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
    await prisma.partyMember.delete({ where: { id: membership.id } });
    // If empty, delete the party
    const remaining = await prisma.partyMember.count({ where: { partyId: membership.partyId } });
    if (remaining === 0) {
      await prisma.party.delete({ where: { id: membership.partyId } }).catch(() => {});
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

    // Find the invitee by username (case-insensitive)
    const invitee = await prisma.user.findUnique({
      where: { username: body.username },
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
    return { ok: true };
  });
}
