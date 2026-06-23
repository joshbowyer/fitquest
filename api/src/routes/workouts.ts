import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, SkipReason, WorkoutType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { bestEstimatedOneRm, isPrCandidate } from '../lib/pr.js';
import { goldFromWorkout, levelFromXp, progressInLevel, xpFromWorkout } from '../lib/xp.js';
import { checkAchievements } from '../lib/achievements.js';
import { computeRaidDamage } from '../lib/raidDamage.js';
import { checkRoutineProgress } from './routine.js';
import { tickHearts, heartMultiplier } from '../lib/mode.js';

/**
 * Per-exercise absolute caps for "this value is almost certainly
 * a typo" warnings. Stored values are kept (the user might be a
 * powerlifter with a 350kg deadlift) but flagged in the response so
 * the morning report can surface them.
 *
 * Heuristics:
 *   - 500kg / 1100lb on any single set: very few people lift this
 *     in raw training; if a user suddenly does, it's likely a typo
 *     (1350 vs 135) or a unit-mixup.
 *   - 200 reps in one set: probably a mis-log of total reps.
 */
const SUSPECT_WEIGHT_KG = 500;
const SUSPECT_REPS = 200;

type ValidityFlag = {
  exercise: string;
  setIndex: number;
  field: 'weight' | 'reps';
  value: number;
  reason: 'possible_typo' | 'unusually_high';
};

function flagSuspectSets(
  exercises: Array<{ name: string; sets: Array<{ weight?: number | null; reps: number }> }>,
  units: 'METRIC' | 'IMPERIAL',
): ValidityFlag[] {
  const cap = units === 'IMPERIAL' ? SUSPECT_WEIGHT_KG * 2.20462 : SUSPECT_WEIGHT_KG;
  const flags: ValidityFlag[] = [];
  for (const ex of exercises) {
    ex.sets.forEach((s, idx) => {
      if ((s.weight ?? 0) > cap) {
        // Past 1.5× the cap (i.e. > 750kg / ~1650lb) it's almost
        // certainly a typo: world-record deadlift is ~500kg, so
        // anything north of 750kg isn't a real lift, it's "I typed
        // 1350 instead of 135".
        flags.push({
          exercise: ex.name,
          setIndex: idx,
          field: 'weight',
          value: s.weight!,
          reason: s.weight! > cap * 1.5 ? 'possible_typo' : 'unusually_high',
        });
      }
      if (s.reps > SUSPECT_REPS) {
        flags.push({
          exercise: ex.name,
          setIndex: idx,
          field: 'reps',
          value: s.reps,
          reason: 'possible_typo',
        });
      }
    });
  }
  return flags;
}

const SetInput = z.object({
  reps: z.number().int().min(0).max(1000),
  // Hard cap 2000kg/4400lb — past that it's almost certainly a typo
  // (e.g. typed 1350 instead of 135). Server stores it either way
  // but flags it for the morning report.
  weight: z.number().min(0).max(2000).optional().nullable(),
  duration: z.number().int().min(0).max(60 * 60 * 6).optional().nullable(),
  // 0 means "not specified" — don't reject on min(1).
  rpe: z.number().min(0).max(10).optional().nullable(),
  completed: z.boolean().default(true),
  order: z.number().int().min(0).default(0),
  // Skip fields: a skipped set is preserved in history but excluded
  // from volume/PR math. INJURY reason is the only kind that doesn't
  // count against streaks or dailies.
  skipped: z.boolean().default(false),
  skipReason: z.nativeEnum(SkipReason).optional().nullable(),
});

const ExerciseInput = z.object({
  name: z.string().min(1).max(100),
  notes: z.string().max(500).optional(),
  order: z.number().int().min(0).default(0),
  // musclesWorked is set client-side from the name; we trust it
  // because it comes from the same static rule list the user sees.
  musclesWorked: z.array(z.string()).optional(),
  sets: z.array(SetInput).min(1),
});

const CardioInput = z.object({
  distanceKm: z.number().min(0).max(10000).optional(),
  durationSec: z.number().int().min(0).max(60 * 60 * 24).optional(),
  pace: z.enum(['WALK_CASUAL', 'WALK_BRISK', 'JOG', 'RUN', 'SPRINT', 'CRUISE', 'INTERVALS']).optional(),
  elevationGainM: z.number().min(-1000).max(20000).optional(),
  avgHr: z.number().int().min(20).max(250).optional(),
  maxHr: z.number().int().min(20).max(250).optional(),
  avgPaceSecPerKm: z.number().int().min(0).max(60 * 30).optional(),
  source: z.enum(['MANUAL', 'GPS']).optional(),
}).optional();

const CreateWorkoutSchema = z.object({
  type: z.nativeEnum(WorkoutType),
  name: z.string().max(100).optional(),
  duration: z.number().int().min(0).max(60 * 24).optional(),
  notes: z.string().max(2000).optional(),
  performedAt: z.string().datetime().optional(),
  // Non-set cardio block. Optional. Lets the user log a hike / run /
  // cycle / row / swim as a single distance + duration + pace entry
  // without a full exercise breakdown. Independent of `type` so
  // future HIKING / RUNNING / CYCLING types can reuse the same shape.
  cardio: CardioInput,
  // A workout is valid if it has any of: exercises, a cardio block,
  // or (for freeform MOBILITY/OTHER types like jumprope / rock
  // climbing / yoga) a name + duration. The freeform path is the
  // newest addition — those types never have exercises or cardio
  // fields, so we can't require either.
  exercises: z.array(ExerciseInput).default([]),
}).refine(
  (d) =>
    (d.exercises?.length ?? 0) > 0
    || !!d.cardio
    || (d.type === 'MOBILITY' || d.type === 'OTHER')
        && (d.name?.trim().length ?? 0) > 0
        && (d.duration ?? 0) > 0,
  { message: 'Provide exercises, a cardio block, or (for freeform types) a name + duration.' },
);

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

  app.get('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const item = await prisma.workout.findFirst({
      where: { id, userId: me.id },
      include: { exercises: { include: { sets: { orderBy: { order: 'asc' } } }, orderBy: { order: 'asc' } } },
    });
    if (!item) return reply.code(404).send({ error: 'Workout not found' });
    return { item };
  });

  app.post('/', async (req, reply) => {
    const me = await requireUser(req);
    const body = CreateWorkoutSchema.parse(req.body);

    // Check for suspect values BEFORE inserting. Stored as-is (the
    // user might be a powerlifter with a 350kg deadlift) but returned
    // in the response so the client can show a confirm / correction UI.
    const validityFlags = flagSuspectSets(body.exercises, me.units);

    const totalVolumeKg = body.exercises.reduce((acc, ex) => {
      return acc + ex.sets.reduce((s, set) => {
        if (!set.completed || set.skipped) return s;
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
          // Non-set cardio block. Prisma Json? column — pass `null`
          // (not undefined) when the user didn't fill it in so the
          // stored value is consistent across rows.
          cardio: body.cardio ?? null,
          exercises: {
            create: body.exercises.map((ex) => ({
              name: ex.name,
              order: ex.order,
              notes: ex.notes,
              musclesWorked: (ex.musclesWorked ?? []) as any,
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
          .filter((s) => s.completed && !s.skipped && (s.weight ?? 0) > 0 && s.reps > 0)
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

      // XP / gold. Apply heart multiplier when the user is in
      // Hardcore mode with 0 hearts — halves both rewards until
      // they tick back up. Casual mode always returns 1.0 so the
      // math is identical to before.
      const currentHearts = await tickHearts(me.id);
      const mult = heartMultiplier(currentHearts);
      const baseXp = xpFromWorkout({
        type: workout.type,
        totalVolumeKg,
        durationMin: duration,
        prCount: prs.length,
      });
      const baseGold = goldFromWorkout({ type: workout.type, prCount: prs.length, durationMin: duration });
      const xp = Math.round(baseXp * mult);
      const gold = Math.round(baseGold * mult);
      const newXp = me.xp + xp;
      const newGold = me.gold + gold;
      const newLevel = levelFromXp(newXp);
      // leveledUp drives the level-up pulse animation on the client.
      // Also include the level-before so the bus can render the
      // before/after without an extra GET.
      const previousLevel = me.level;
      await tx.user.update({
        where: { id: me.id },
        data: { xp: newXp, gold: newGold, level: newLevel },
      });

      return {
        workout,
        xp,
        gold,
        totalXp: newXp,
        totalGold: newGold,
        level: newLevel,
        previousLevel,
        leveledUp: newLevel > previousLevel,
      };
    });

    await checkAchievements(me.id);

    // Check routine progress — if the user hit their weekly goal,
    // bump their streak. Returns whether the streak just incremented
    // so the workout response can show a celebratory message.
    const routineProgress = await checkRoutineProgress(me.id);

    // Raid damage: compute from workout, apply class multiplier, contribute
    // to the active raid for the user's party (if any). Even if no raid is
    // active, we still return the computed damage so the UI can show what
    // *would* have been dealt.
    const raidDamage = computeRaidDamage(
      {
        type: body.type,
        durationMin: duration,
        exercises: body.exercises.map((ex) => ({
          name: ex.name,
          sets: ex.sets,
        })),
      },
      me.class,
    );

    let raidContribution: { id: string; damage: number; source: string; raidId: string } | null = null;
    if (me.class && raidDamage.total > 0) {
      const membership = await prisma.partyMember.findUnique({ where: { userId: me.id } });
      if (membership) {
        const raid = await prisma.raid.findFirst({
          where: { partyId: membership.partyId, status: 'ACTIVE' },
        });
        if (raid) {
          // Apply party-wide buffs. Today the only buff is the team-
          // workout completion grant (10% raid damage for 24h per
          // roadmap §30). Buffs that have expired are ignored.
          const buff = await prisma.partyBuff.findUnique({
            where: { partyId: membership.partyId },
          });
          const buffActive = buff && buff.expiresAt > new Date();
          // Heart multiplier stacks with the team-workout buff. At 0
          // hearts the user deals half damage to the boss; the buff
          // then adds its percent on top.
          const buffedDamage = buffActive
            ? Math.round(raidDamage.total * mult * (1 + (buff?.raidDmgBonusPct ?? 0) / 100))
            : Math.round(raidDamage.total * mult);
          const newHp = Math.max(0, raid.bossHp - buffedDamage);
          const status = newHp <= 0 ? 'VICTORY' : 'ACTIVE';
          const [contribution] = await prisma.$transaction([
            prisma.raidContribution.create({
              data: {
                raidId: raid.id,
                userId: me.id,
                damage: buffedDamage,
                source: 'workout',
              },
            }),
            prisma.raid.update({
              where: { id: raid.id },
              data: {
                bossHp: newHp,
                status,
                endedAt: status === 'VICTORY' ? new Date() : null,
              },
            }),
          ]);
          raidContribution = {
            id: contribution.id,
            damage: contribution.damage,
            source: contribution.source,
            raidId: contribution.raidId,
          };
          // On victory, distribute XP+gold to all members (mirror the
          // manual contribute flow).
          if (status === 'VICTORY') {
            const members = await prisma.partyMember.findMany({ where: { partyId: raid.partyId } });
            const totalAgg = await prisma.raidContribution.aggregate({
              where: { raidId: raid.id },
              _sum: { damage: true },
            });
            const total = totalAgg._sum.damage ?? raidDamage.total;
            // Same Soulstone drop rate as manual contribute.
            const SOULSTONE_CHANCE = 0.08;
            for (const m of members) {
              const myAgg = await prisma.raidContribution.aggregate({
                where: { raidId: raid.id, userId: m.userId },
                _sum: { damage: true },
              });
              const my = myAgg._sum.damage ?? 0;
              const share = Math.round((my / total) * 200) + 50;
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
        }
      }
    }

    return reply.send({
      workout: result.workout,
      rewards: {
        xp: result.xp,
        gold: result.gold,
        totalXp: result.totalXp,
        totalGold: result.totalGold,
        level: result.level,
        previousLevel: result.previousLevel,
        leveledUp: result.leveledUp,
        progress: progressInLevel(result.totalXp, result.level),
        // Hearts + mode so the frontend can refresh the Hearts card
        // and the rewards multiplier chip without a separate /users/me.
        hearts: currentHearts,
        heartMultiplier: mult,
        mode: me.mode ?? 'CASUAL',
        prs,
      },
      // Validity flags surface in the morning report / a quick toast
      // on the workout logger so the user can correct typos before
      // the values get cemented into PR history.
      validityFlags,
      raid: {
        damage: raidDamage,
        contribution: raidContribution,
      },
      routine: routineProgress,
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
