import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, WorkoutType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { bestEstimatedOneRm, isPrCandidate } from '../lib/pr.js';
import { goldFromWorkout, levelFromXp, progressInLevel, xpFromWorkout } from '../lib/xp.js';
import { checkAchievements } from '../lib/achievements.js';

const SetInput = z.object({
  reps: z.number().int().min(0).max(1000),
  weight: z.number().min(0).max(2000).optional().nullable(),
  duration: z.number().int().min(0).max(60 * 60 * 6).optional().nullable(),
  rpe: z.number().min(1).max(10).optional().nullable(),
  completed: z.boolean().default(true),
  order: z.number().int().min(0).default(0),
});

const ExerciseInput = z.object({
  name: z.string().min(1).max(100),
  notes: z.string().max(500).optional(),
  order: z.number().int().min(0).default(0),
  sets: z.array(SetInput).min(1),
});

const CreateWorkoutSchema = z.object({
  type: z.nativeEnum(WorkoutType),
  name: z.string().max(100).optional(),
  duration: z.number().int().min(0).max(60 * 24).optional(),
  notes: z.string().max(2000).optional(),
  performedAt: z.string().datetime().optional(),
  exercises: z.array(ExerciseInput).min(1),
});

export async function workoutRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const [items, total] = await Promise.all([
      prisma.workout.findMany({
        where: { userId: me.id },
        orderBy: { performedAt: 'desc' },
        take: q.limit,
        skip: q.offset,
        include: { exercises: { include: { sets: { orderBy: { order: 'asc' } } }, orderBy: { order: 'asc' } } },
      }),
      prisma.workout.count({ where: { userId: me.id } }),
    ]);
    return { items, total };
  });

  app.get('/:id', async (req) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const item = await prisma.workout.findFirst({
      where: { id, userId: me.id },
      include: { exercises: { include: { sets: { orderBy: { order: 'asc' } } }, orderBy: { order: 'asc' } } },
    });
    if (!item) return { error: 'Not found' };
    return { item };
  });

  app.post('/', async (req, reply) => {
    const me = await requireUser(req);
    const body = CreateWorkoutSchema.parse(req.body);

    const totalVolumeKg = body.exercises.reduce((acc, ex) => {
      return acc + ex.sets.reduce((s, set) => {
        if (!set.completed) return s;
        return s + (set.weight ?? 0) * set.reps;
      }, 0);
    }, 0);
    const duration = body.duration ?? 0;
    const prs: Array<{ exercise: string; value: number; previousValue: number | null; type: 'ONE_RM' }> = [];

    const result = await prisma.$transaction(async (tx) => {
      const workout = await tx.workout.create({
        data: {
          userId: me.id,
          type: body.type,
          name: body.name,
          duration,
          notes: body.notes,
          performedAt: body.performedAt ? new Date(body.performedAt) : new Date(),
          exercises: {
            create: body.exercises.map((ex) => ({
              name: ex.name,
              order: ex.order,
              notes: ex.notes,
              sets: { create: ex.sets.map((s) => ({ ...s })) },
            })),
          },
        },
        include: { exercises: { include: { sets: true } } },
      });

      // PR detection for each exercise with weight*reps sets
      for (const ex of workout.exercises) {
        if (!ex.sets.length) continue;
        const bestSet = ex.sets
          .filter((s) => s.completed && (s.weight ?? 0) > 0 && s.reps > 0)
          .reduce<{ value: number; weight: number; reps: number } | null>((acc, s) => {
            const v = bestEstimatedOneRm(s.weight ?? 0, s.reps);
            if (acc == null || v > acc.value) return { value: v, weight: s.weight ?? 0, reps: s.reps };
            return acc;
          }, null);
        if (!bestSet) continue;
        const prev = await tx.pr.findFirst({
          where: { userId: me.id, exercise: ex.name, type: 'ONE_RM' },
          orderBy: { value: 'desc' },
        });
        if (isPrCandidate(ex.name, bestSet.value, prev?.value)) {
          const pr = await tx.pr.create({
            data: {
              userId: me.id,
              type: 'ONE_RM',
              exercise: ex.name,
              value: bestSet.value,
              previousValue: prev?.value ?? null,
              workoutId: workout.id,
            },
          });
          prs.push({ exercise: ex.name, value: pr.value, previousValue: pr.previousValue, type: 'ONE_RM' });
        }
      }

      // XP / gold
      const xp = xpFromWorkout({
        type: workout.type,
        totalVolumeKg,
        durationMin: duration,
        prCount: prs.length,
      });
      const gold = goldFromWorkout({ type: workout.type, prCount: prs.length, durationMin: duration });
      const newXp = me.xp + xp;
      const newGold = me.gold + gold;
      const newLevel = levelFromXp(newXp);
      await tx.user.update({
        where: { id: me.id },
        data: { xp: newXp, gold: newGold, level: newLevel },
      });

      return { workout, xp, gold, totalXp: newXp, totalGold: newGold, level: newLevel };
    });

    await checkAchievements(me.id);

    return reply.send({
      workout: result.workout,
      rewards: {
        xp: result.xp,
        gold: result.gold,
        totalXp: result.totalXp,
        totalGold: result.totalGold,
        level: result.level,
        progress: progressInLevel(result.totalXp, result.level),
        prs,
      },
    });
  });

  app.delete('/:id', async (req) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const existing = await prisma.workout.findFirst({ where: { id, userId: me.id } });
    if (!existing) return { error: 'Not found' };
    await prisma.workout.delete({ where: { id } });
    return { ok: true };
  });
}
