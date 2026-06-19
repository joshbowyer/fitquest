import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { checkAchievements } from '../lib/achievements.js';

const StartSchema = z.object({
  bossName: z.string().min(2).max(60),
  bossHp: z.number().int().min(100).max(1_000_000).default(5000),
});

const ContributeSchema = z.object({
  damage: z.number().int().min(1).max(10000),
  source: z.enum(['workout', 'pr', 'streak']).default('workout'),
});

export async function raidRoutes(app: FastifyInstance) {
  app.get('/active', async (req) => {
    const me = await requireUser(req);
    const membership = await prisma.partyMember.findUnique({ where: { userId: me.id } });
    if (!membership) return { raid: null };
    const raid = await prisma.raid.findFirst({
      where: { partyId: membership.partyId, status: 'ACTIVE' },
      include: {
        contributions: {
          include: { user: { select: { id: true, username: true, class: true, level: true } } },
          orderBy: { contributedAt: 'desc' },
        },
      },
    });
    return { raid };
  });

  app.get('/history', async (req) => {
    const me = await requireUser(req);
    const membership = await prisma.partyMember.findUnique({ where: { userId: me.id } });
    if (!membership) return { items: [] };
    const items = await prisma.raid.findMany({
      where: { partyId: membership.partyId, status: { not: 'ACTIVE' } },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    return { items };
  });

  app.post('/start', async (req) => {
    const me = await requireUser(req);
    const body = StartSchema.parse(req.body);
    const membership = await prisma.partyMember.findUnique({ where: { userId: me.id } });
    if (!membership) return { error: 'Join a party first' };
    if (membership.role !== 'LEADER' && membership.role !== 'OFFICER') {
      return { error: 'Only leaders/officers can start a raid' };
    }
    const active = await prisma.raid.findFirst({
      where: { partyId: membership.partyId, status: 'ACTIVE' },
    });
    if (active) return { error: 'A raid is already active' };
    const raid = await prisma.raid.create({
      data: {
        partyId: membership.partyId,
        bossName: body.bossName,
        bossHp: body.bossHp,
        bossMaxHp: body.bossHp,
      },
    });
    return { raid };
  });

  app.post('/:id/contribute', async (req) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const body = ContributeSchema.parse(req.body);
    const raid = await prisma.raid.findUnique({ where: { id } });
    if (!raid) return { error: 'Raid not found' };
    if (raid.status !== 'ACTIVE') return { error: 'Raid is not active' };
    const membership = await prisma.partyMember.findUnique({ where: { userId: me.id } });
    if (!membership || membership.partyId !== raid.partyId) {
      return { error: 'Not a member of this raid party' };
    }
    const contribution = await prisma.raidContribution.create({
      data: { raidId: id, userId: me.id, damage: body.damage, source: body.source },
    });
    const newHp = Math.max(0, raid.bossHp - body.damage);
    const status = newHp <= 0 ? 'VICTORY' : 'ACTIVE';
    const updated = await prisma.raid.update({
      where: { id },
      data: {
        bossHp: newHp,
        status,
        endedAt: status === 'VICTORY' ? new Date() : null,
      },
    });
    if (status === 'VICTORY') {
      // Reward each member
      const members = await prisma.partyMember.findMany({ where: { partyId: raid.partyId } });
      const totalDamage = await prisma.raidContribution.aggregate({
        where: { raidId: id },
        _sum: { damage: true },
      });
      const total = totalDamage._sum.damage ?? body.damage;
      // Soulstone drop: ~8% chance per member per victory. Stays rare.
      // (We roll once per member rather than once per raid so a 4-person
      // party isn't 4x more likely to drop than a solo raid.)
      const SOULSTONE_CHANCE = 0.08;
      for (const m of members) {
        const myContribs = await prisma.raidContribution.aggregate({
          where: { raidId: id, userId: m.userId },
          _sum: { damage: true },
        });
        const my = myContribs._sum.damage ?? 0;
        const share = Math.round((my / total) * 200) + 50; // 50 base + share
        const u = await prisma.user.findUnique({ where: { id: m.userId } });
        if (!u) continue;
        const soulstoneDropped = Math.random() < SOULSTONE_CHANCE;
        await prisma.user.update({
          where: { id: m.userId },
          data: {
            xp: u.xp + share,
            gold: u.gold + Math.floor(share / 4),
            ...(soulstoneDropped ? { soulstones: u.soulstones + 1 } : {}),
          },
        });
        await checkAchievements(m.userId);
      }
    }
    return { contribution, raid: updated };
  });
}
