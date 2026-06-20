import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HabitDirection } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { checkAchievements } from '../lib/achievements.js';

const createSchema = z.object({
  name: z.string().min(1).max(80),
  direction: z.nativeEnum(HabitDirection),
  notes: z.string().max(500).optional().nullable(),
  goldReward: z.number().int().min(0).max(1000).optional(),
  xpReward: z.number().int().min(0).max(1000).optional(),
  icon: z.string().max(8).optional().nullable(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  notes: z.string().max(500).optional().nullable(),
  goldReward: z.number().int().min(0).max(1000).optional(),
  xpReward: z.number().int().min(0).max(1000).optional(),
  icon: z.string().max(8).optional().nullable(),
  archived: z.boolean().optional(),
});

export async function habitRoutes(app: FastifyInstance) {
  // GET /habits — list the user's habits with today's counts
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [habits, todayLogs] = await Promise.all([
      prisma.habit.findMany({
        where: { userId: me.id, archived: false },
        orderBy: [{ createdAt: 'asc' }],
      }),
      prisma.habitLog.findMany({
        where: { userId: me.id, loggedAt: { gte: startOfDay } },
      }),
    ]);

    // Aggregate today's counts per habit so the UI can show "✓ 2 / 3 today"
    const todayCountByHabit = new Map<string, { count: number; netDelta: number; gold: number; xp: number }>();
    for (const log of todayLogs) {
      const cur = todayCountByHabit.get(log.habitId) ?? { count: 0, netDelta: 0, gold: 0, xp: 0 };
      cur.count += 1;
      cur.netDelta += log.delta;
      cur.gold += log.goldDelta;
      cur.xp += log.xpDelta;
      todayCountByHabit.set(log.habitId, cur);
    }

    return {
      items: habits.map((h) => ({
        ...h,
        todayCount: todayCountByHabit.get(h.id)?.count ?? 0,
        todayGold: todayCountByHabit.get(h.id)?.gold ?? 0,
        todayXp: todayCountByHabit.get(h.id)?.xp ?? 0,
      })),
    };
  });

  // POST /habits — create a new habit
  app.post('/', async (req) => {
    const me = await requireUser(req);
    const body = createSchema.parse(req.body);
    const habit = await prisma.habit.create({
      data: {
        userId: me.id,
        name: body.name,
        direction: body.direction,
        notes: body.notes ?? null,
        goldReward: body.goldReward ?? 5,
        xpReward: body.xpReward ?? 2,
        icon: body.icon ?? null,
      },
    });
    return { habit };
  });

  // PATCH /habits/:id — update fields
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const body = updateSchema.parse(req.body);
    const existing = await prisma.habit.findUnique({ where: { id } });
    if (!existing || existing.userId !== me.id) {
      return reply.code(404).send({ error: 'Habit not found' });
    }
    const habit = await prisma.habit.update({ where: { id }, data: body });
    return { habit };
  });

  // DELETE /habits/:id — archive (we keep history via FK CASCADE on habit
  // would wipe logs; instead, archive and stop showing in default list)
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const existing = await prisma.habit.findUnique({ where: { id } });
    if (!existing || existing.userId !== me.id) {
      return reply.code(404).send({ error: 'Habit not found' });
    }
    await prisma.habit.update({ where: { id }, data: { archived: true } });
    return { ok: true };
  });

  // POST /habits/:id/log — toggle a check (always +1; for negative habits
  // the system applies the penalty)
  app.post<{ Params: { id: string } }>('/:id/log', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const habit = await prisma.habit.findUnique({ where: { id } });
    if (!habit || habit.userId !== me.id) {
      return reply.code(404).send({ error: 'Habit not found' });
    }
    if (habit.archived) {
      return reply.code(410).send({ error: 'Habit is archived' });
    }

    // For POSITIVE: reward. For NEGATIVE: penalty (apply negative sign
    // to both gold and xp deltas).
    const sign = habit.direction === 'POSITIVE' ? 1 : -1;
    const goldDelta = sign * habit.goldReward;
    const xpDelta = sign * habit.xpReward;
    const delta = sign; // log delta is just the sign for simplicity

    const log = await prisma.habitLog.create({
      data: {
        userId: me.id,
        habitId: habit.id,
        delta,
        goldDelta,
        xpDelta,
      },
    });

    // Apply to user's gold + xp.
    const updated = await prisma.user.update({
      where: { id: me.id },
      data: {
        gold: { increment: goldDelta },
        xp: { increment: xpDelta },
      },
      select: { gold: true, xp: true, level: true },
    });

    await checkAchievements(me.id);

    return {
      log,
      goldDelta,
      xpDelta,
      gold: updated.gold,
      xp: updated.xp,
      level: updated.level,
    };
  });

  // GET /habits/today — counts for the Today widget on Dashboard
  app.get('/today-summary', async (req) => {
    const me = await requireUser(req);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [active, todayLogs] = await Promise.all([
      prisma.habit.count({ where: { userId: me.id, archived: false } }),
      prisma.habitLog.findMany({
        where: { userId: me.id, loggedAt: { gte: startOfDay } },
      }),
    ]);
    const positives = todayLogs.filter((l) => l.delta > 0).length;
    const negatives = todayLogs.filter((l) => l.delta < 0).length;
    const gold = todayLogs.reduce((s, l) => s + l.goldDelta, 0);
    const xp = todayLogs.reduce((s, l) => s + l.xpDelta, 0);
    return {
      active,
      positives,
      negatives,
      goldDelta: gold,
      xpDelta: xp,
    };
  });
}