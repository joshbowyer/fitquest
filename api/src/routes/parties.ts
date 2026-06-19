import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { checkAchievements } from '../lib/achievements.js';

const CreateSchema = z.object({ name: z.string().min(2).max(60) });

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
}
