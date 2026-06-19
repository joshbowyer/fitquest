import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { WORLDS, getWorld, getLevel } from '../lib/worlds';
import { requireUser } from '../lib/auth.js';

const attemptSchema = z.object({
  score: z.number().int().min(0).max(100),
});

export async function questRoutes(app: FastifyInstance) {
  // GET /quest/worlds — list all worlds with the user's progress attached
  app.get('/worlds', async (req) => {
    const me = await requireUser(req);
    const userId = me.id;
    const rows = await prisma.userWorldProgress.findMany({ where: { userId } });
    const progressByLevel = new Map(
      rows.map((r: { levelId: string }) => [r.levelId, r]),
    );

    return WORLDS.map((w) => ({
      ...w,
      levels: w.levels.map((l) => ({
        ...l,
        progress: progressByLevel.get(l.id) ?? null,
      })),
    }));
  });

  // GET /quest/worlds/:id — single world with full levels
  app.get<{ Params: { id: string } }>('/worlds/:id', async (req, reply) => {
    const me = await requireUser(req);
    const userId = me.id;
    const { id } = req.params;
    const world = getWorld(id);
    if (!world) return reply.code(404).send({ error: 'World not found' });

    const rows = await prisma.userWorldProgress.findMany({
      where: { userId, levelId: { startsWith: `${id}-` } },
    });
    const progressByLevel = new Map(
      rows.map((r: { levelId: string }) => [r.levelId, r]),
    );

    return {
      ...world,
      levels: world.levels.map((l) => ({
        ...l,
        progress: progressByLevel.get(l.id) ?? null,
      })),
    };
  });

  // POST /quest/levels/:id/attempt — record an attempt
  app.post<{ Params: { id: string } }>('/levels/:id/attempt', async (req, reply) => {
    const me = await requireUser(req);
    const userId = me.id;
    const { id } = req.params;
    const body = attemptSchema.parse(req.body);
    const ref = getLevel(id);
    if (!ref) return reply.code(404).send({ error: 'Level not found' });
    const { level } = ref;

    // Compute win chance from level difficulty. We don't want to gate
    // too hard on real measurements — the Quest tab is exploratory.
    // difficulty 1 needs ≥20, higher difficulties need ~12/level.
    const win = body.score >= Math.max(20, level.difficulty * 12);

    const prev = await prisma.userWorldProgress.findUnique({
      where: { userId_levelId: { userId, levelId: id } },
    });
    const wasCompleted = prev?.completed ?? false;

    const updated = await prisma.userWorldProgress.upsert({
      where: { userId_levelId: { userId, levelId: id } },
      create: {
        userId,
        levelId: id,
        attempts: 1,
        bestScore: body.score,
        completed: win,
        completedAt: win ? new Date() : null,
      },
      update: {
        attempts: { increment: 1 },
        bestScore: { set: Math.max(prev?.bestScore ?? 0, body.score) },
        completed: prev?.completed || win,
        completedAt:
          prev?.completedAt ?? (win ? new Date() : null),
      },
    });

    // Award XP + gold on first completion.
    if (win && !wasCompleted) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          xp: { increment: level.xp },
          gold: { increment: level.gold },
        },
      });
    }

    return {
      level,
      result: {
        won: win,
        score: body.score,
        xpAwarded: win && !wasCompleted ? level.xp : 0,
        goldAwarded: win && !wasCompleted ? level.gold : 0,
        attempts: updated.attempts,
        bestScore: updated.bestScore,
        completed: updated.completed,
      },
    };
  });
}
