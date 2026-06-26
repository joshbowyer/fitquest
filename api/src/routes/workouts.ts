import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, SkipReason, WorkoutType } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { bestEstimatedOneRm, isPrCandidate } from '../lib/pr.js';
import { goldFromWorkout, levelFromXp, progressInLevel, xpFromWorkout } from '../lib/xp.js';
import { checkAchievements } from '../lib/achievements.js';
import { computeRaidDamage } from '../lib/raidDamage.js';
import { checkRoutineProgress } from './routine.js';
import { tickHearts, heartMultiplier } from '../lib/mode.js';
import { setVolumeKg } from '../lib/exerciseVolume.js';
import { checkSetPlausibility } from '../lib/exerciseLimits.js';

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
  reason: 'possible_typo' | 'unusually_high' | string;
  severity?: 'flag' | 'block';
};

function flagSuspectSets(
  exercises: Array<{ name: string; sets: Array<{ weight?: number | null; reps: number }> }>,
  units: 'METRIC' | 'IMPERIAL',
  userWeightKg: number = 0,
): ValidityFlag[] {
  const flags: ValidityFlag[] = [];
  // Imperial users entered in lb but the body-fat / weight math
  // runs in kg. We assume the client converted before sending
  // (CreateWorkoutSchema's `units` field tells the client to), but
  // the per-exercise limits are still in kg — flag if the absolute
  // weight is wildly out of the metric envelope even for an
  // imperial entry (extra safety net against a missed conversion).
  const absoluteCapKg = units === 'IMPERIAL' ? SUSPECT_WEIGHT_KG * 2.20462 : SUSPECT_WEIGHT_KG;
  for (const ex of exercises) {
    ex.sets.forEach((s, idx) => {
      const weightKg = s.weight ?? 0;
      const reps = s.reps;
      // Per-exercise plausibility (the new primary check).
      const verdict = checkSetPlausibility(ex.name, weightKg, reps, userWeightKg);
      if (verdict.severity) {
        flags.push({
          exercise: ex.name,
          setIndex: idx,
          field: 'weight',
          value: weightKg,
          reason: verdict.reason ?? 'implausible',
          severity: verdict.severity,
        });
      }
      // Old blanket cap (kept as a final safety net — anything above
      // ~750kg / 1650lb is essentially guaranteed to be a typo).
      if (weightKg > absoluteCapKg) {
        flags.push({
          exercise: ex.name,
          setIndex: idx,
          field: 'weight',
          value: weightKg,
          reason: weightKg > absoluteCapKg * 1.5 ? 'possible_typo' : 'unusually_high',
          severity: weightKg > absoluteCapKg * 1.5 ? 'block' : 'flag',
        });
      }
      if (reps > SUSPECT_REPS) {
        flags.push({
          exercise: ex.name,
          setIndex: idx,
          field: 'reps',
          value: reps,
          reason: 'possible_typo',
          severity: 'block',
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
  // Live-mode timing. All three optional so bulk-mode workouts
  // (legacy + the user's opted-in bulk path) keep working untouched.
  //  startedAt    = user opened the entry for this set
  //  completedAt  = user tapped Continue
  //  restSeconds  = seconds rested before this set, computed by the
  //                 client at commit time from completedAt of the
  //                 previous set. First set of the workout = null.
  startedAt: z.string().datetime().optional().nullable(),
  completedAt: z.string().datetime().optional().nullable(),
  restSeconds: z.number().int().min(0).max(60 * 60 * 6).optional().nullable(),
});

const ExerciseInput = z.object({
  name: z.string().min(1).max(100),
  notes: z.string().max(500).optional(),
  order: z.number().int().min(0).default(0),
  // musclesWorked is set client-side from the name; we trust it
  // because it comes from the same static rule list the user sees.
  musclesWorked: z.array(z.string()).optional(),
  sets: z.array(SetInput).min(1),
  // Live-mode timing at the exercise level. Both optional for the
  // same reason as Set.startedAt / completedAt — bulk-mode workouts
  // don't carry them and the API shouldn't require them.
  startedAt: z.string().datetime().optional().nullable(),
  completedAt: z.string().datetime().optional().nullable(),
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
    // Pass the user's current weight through to per-exercise
    // plausibility so bodyweight exercises (plank, nordic curl)
    // get flagged against the user's actual mass, not a generic
    // 80kg fallback.
    const validityFlags = flagSuspectSets(body.exercises, me.units, me.weightKg ?? 0);

    // Bodyweight-aware volume: pushups at weight=0 count as
    // 0.64 × bodyweight × reps, not bodyweight × reps. Pulls the
    // user's current weight so the coefficient is applied against
    // a live measurement (changes when they bulk/cut).
    const meWithWeight = me.weightKg
      ? me
      : await prisma.user.findUnique({ where: { id: me.id }, select: { weightKg: true } });
    const userWeightKg = meWithWeight?.weightKg ?? 0;
    const totalVolumeKg = body.exercises.reduce((acc, ex) => {
      return acc + ex.sets.reduce((s, set) => {
        if (!set.completed || set.skipped) return s;
        return s + setVolumeKg(set, ex.name, userWeightKg);
      }, 0);
    }, 0);
    const duration = body.duration ?? 0;
    const prs: Array<{ exercise: string; value: number; previousValue: number | null; type: 'ONE_RM' }> = [];

    // Heart multiplier is read once and reused both inside the
    // transaction (XP / gold) and after it (raid damage). Hoisted
    // out so the post-commit raid math doesn't ReferenceError when
    // we reference `mult` outside the transaction scope.
    const currentHearts = await tickHearts(me.id);
    const mult = heartMultiplier(currentHearts);

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
          // Per-set plausibility flags from flagSuspectSets (Bench
          // > 350kg, Squat > 1000 reps, blanket > 500kg, etc.).
          // Persisted so the morning report can surface them — without
          // this, an "is this PR for real?" toast only shows on the
          // workout detail screen the day of, then scrolls off.
          // Stored as null (not []) when no flags, so empty workouts
          // don't bloat the row.
          validityFlags: validityFlags.length > 0 ? (validityFlags as any) : null,
          exercises: {
            create: body.exercises.map((ex) => ({
              name: ex.name,
              order: ex.order,
              notes: ex.notes,
              musclesWorked: (ex.musclesWorked ?? []) as any,
              // Live-mode exercise timing. Spread after the literal
              // fields so a future field collision can't accidentally
              // overwrite the client's value with undefined.
              ...(ex.startedAt ? { startedAt: new Date(ex.startedAt) } : {}),
              ...(ex.completedAt ? { completedAt: new Date(ex.completedAt) } : {}),
              sets: {
                create: ex.sets.map((s) => ({
                  reps: s.reps,
                  weight: s.weight ?? null,
                  duration: s.duration ?? null,
                  rpe: s.rpe ?? null,
                  completed: s.completed,
                  order: s.order,
                  skipped: s.skipped,
                  skipReason: s.skipReason ?? null,
                  // Same pattern as the exercise fields above — only
                  // forward each timestamp when the client sent it.
                  // Sending `undefined` would round-trip as null which
                  // the API contract treats as "no live-mode data",
                  // same as not sending the field at all, but the
                  // conditional spread keeps the payload tidy.
                  ...(s.startedAt ? { startedAt: new Date(s.startedAt) } : {}),
                  ...(s.completedAt ? { completedAt: new Date(s.completedAt) } : {}),
                  ...(s.restSeconds != null ? { restSeconds: s.restSeconds } : {}),
                })),
              },
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

    // Home-base penances on workout commit. The two big repair
    // events: MOBILITY workouts +6 and CARDIO ≥ 30min +8. Fire
    // both when applicable. No-op when the templates are disabled
    // or the user's shield is already clamped.
    {
      const penanceLib = await import('../lib/penance.js');
      const fires: Array<{ key: 'logged_mobility' | 'logged_cardio_30' | 'log_stretch'; source: 'workout_commit' }> = [];
      if (body.type === 'MOBILITY') {
        fires.push({ key: 'logged_mobility', source: 'workout_commit' });
      }
      if (body.type === 'CARDIO' && duration >= 30) {
        fires.push({ key: 'logged_cardio_30', source: 'workout_commit' });
      }
      // Stretch / yoga exercises are typically named explicitly
      // (Stretch, Yoga, Foam Roll, Hip Opener, etc). The user fires
      // this manually as a small per-session bump regardless of
      // workout type — the only criterion is the exercise name
      // matching a stretch keyword.
      const stretchKeywords = /\b(stretch|yoga|foam\s*roll|hip\s*open|shoulder\s*mob|thoracic|mobility\s*flow)\b/i;
      const hadStretch = (body.exercises ?? []).some((e) => stretchKeywords.test(e.name ?? ''));
      if (hadStretch) {
        fires.push({ key: 'log_stretch', source: 'workout_commit' });
      }
      if (fires.length > 0) {
        await penanceLib.firePenances(me.id, fires);
      }
    }

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

    // ============================================================
    // Breach damage — apply inline with workout commit so the UI
    // updates in one round trip. Lazy-unlocks at level 10 (the
    // function is a no-op below that).
    // ============================================================
    let breachDamage: {
      dealt: number;
      matchType: string;
      bossHpAfter: number;
      killed: boolean;
      pendingReward: any;
      unlocked: boolean;
    } | null = null;
    try {
      const breachLib = await import('../lib/breach.js');
      const userBefore = await prisma.user.findUnique({
        where: { id: me.id },
        select: { level: true },
      });
      const beforeLevel = userBefore?.level ?? 1;
      const unlockResult = await breachLib.unlockBreachIfReady(me.id, result.level);
      await breachLib.tickCooldown(me.id);
      const damageResult = await breachLib.applyWorkoutDamage(me.id, result.workout.id);
      if (damageResult) {
        let pendingReward: any = null;
        if (damageResult.killed) {
          const progress = await breachLib.getOrCreateProgress(me.id);
          const boss = progress.currentBossId
            ? await prisma.breachBoss.findUnique({ where: { id: progress.currentBossId } })
            : null;
          if (boss) pendingReward = breachLib.rewardForKill(boss, result.level);
        }
        breachDamage = {
          dealt: damageResult.dealt,
          matchType: damageResult.matchType,
          bossHpAfter: damageResult.bossHpAfter,
          killed: damageResult.killed,
          pendingReward,
          unlocked: !!(unlockResult?.unlockedAt && unlockResult.unlockedAt.getTime() >= Date.now() - 1000) || beforeLevel < 10 && result.level >= 10,
          // Home-base shield tier multiplier that was applied to
          // this hit. 0.5× (FORTIFIED halves damage), 1.0×
          // (STABLE default), 1.25× (COMPROMISED), 2.0× (BREACHED).
          // UI surfaces this in the damage floater so the user
          // understands why the same workout did less/more.
          shieldMult: damageResult.shieldMult,
          shieldTier: damageResult.shieldTier,
        };
      }
    } catch (err) {
      // Breach is best-effort. A failed damage calc shouldn't break
      // the workout commit — log + continue without breachDamage.
      console.error('[breach] damage hook failed', err);
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
      // Breach status — null when LOCKED or no progress row yet.
      // `unlocked: true` triggers the level-10 cutscene on the
      // client.
      breach: breachDamage,
    });
  });

  // Portal-leak damage — best-effort. If the user has an active
  // leak, the workout commit also deals damage to (or feeds) it.
  // Wrapped in try/catch so a leak bug can't block the workout
  // commit response.
  app.post('/:id/leak-damage', async (req) => {
    const me = await requireUser(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.workout.findFirst({ where: { id, userId: me.id } });
    if (!existing) return { error: 'Not found' };
    const { applyLeakDamage } = await import('../lib/portalLeaks.js');
    try {
      const result = await applyLeakDamage(me.id, id);
      return result ?? { skipped: true };
    } catch (e: any) {
      return { skipped: true, reason: e?.message ?? 'unknown' };
    }
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
