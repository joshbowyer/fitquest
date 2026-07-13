import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { WorkoutSource } from '../lib/prisma.js';
import { parseFit, isFitBuffer, type FitImportResult, type FitKind } from '../lib/fit.js';
import { checkAchievements } from '../lib/achievements.js';
import { checkRoutineProgress } from './routine.js';
import { activityTitle } from '../lib/geo.js';
import { importExport, ImportError, validatePayload } from '../lib/import.js';
import { awardXpGold } from '../lib/award.js';
import { tickHearts, heartMultiplier } from '../lib/mode.js';
import { levelFromXp, xpFromWorkout, goldFromWorkout } from '../lib/xp.js';
import { todayInTz, localMidnightUtc } from '../lib/timezone.js';
import { computeRaidDamage } from '../lib/raidDamage.js';
import { getEquippedBonus } from '../lib/equipment.js';

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB — well above any FIT we'll see

const bodyLimit = 60 * 1024 * 1024; // Fastify body limit; pair with our 50MB cap

// Source for a FIT ingest. Mirrors the WorkoutSource enum on the
// Workout row. The FitQuestBridge APK sets `source: 'BRIDGE'` in
// every batch upload so the /import page can separate auto-uploaded
// activities from web drags. Unknown / missing values default to
// WEB (same as the Workout column default) so old clients keep
// working without an explicit field.
const ImportSourceSchema = z.nativeEnum(WorkoutSource).optional();

type CreatedRecord =
  | { kind: 'workout'; id: string; summary: string }
  | { kind: 'measurement'; metric: string; id: string; value: number }
  | { kind: 'daily_log'; id: string; dailyKey: string };

type FileResult = {
  filename: string;
  fitKind: FitKind;
  sourceTimestamp: string | null;
  created: CreatedRecord[];
  skipped: { reason: string }[];
};

// Helper that actually performs the persistence for one parsed FIT.
//
// Persistence mirrors the manual POST /workouts pipeline (see
// routes/workouts.ts around lines 217-823). For each ParsedActivity
// from the FIT decoder we run the same command sequence:
//
//   1. Upsert the Workout row keyed on (userId, performedAt).
//   2. PR detection (over the workout's exercises.sets — for FIT
//      imports, the parser only emits top-level activity metrics,
//      no nested sets, so PR detection is naturally a no-op; we
//      still run the loop for parity).
//   3. Award XP + gold via the centralized awardXpGold path
//      (applies the heart multiplier and recomputes level).
//   4. DailyLog: idempotent per-day WORKOUT log row.
//
// All four live in one prisma.$transaction block so a partial
// failure rolls back the workout. The post-commit side effects
// (checkAchievements / checkRoutineProgress / skill matching /
// penances / raid damage / breach damage / portal-leak damage)
// fire OUTSIDE the transaction, best-effort. Each is gated by
// `!wasUpdate` so re-importing the same FIT file does not double
// credit XP/gold or re-run combat math.
//
// `wasUpdate` is detected by pre-checking the (userId, performedAt)
// unique key BEFORE the upsert — Prisma's upsert doesn't return
// a "was this a create or update" flag, and the previous
// "<5s createdAt" heuristic was unreliable (a re-import within 5s
// of the original would double-credit). The pre-check is robust
// against any time gap.
// Exported only so the unit test in src/__tests__/import.test.ts can
// exercise the persist() pipeline without going through the
// full HTTP route. The route handlers in this file are the only
// production callers; tests import this directly.
export async function persist(
  userId: string,
  fit: FitImportResult,
  importSource: WorkoutSource = WorkoutSource.WEB,
  sourceFilename: string | null = null,
): Promise<CreatedRecord[]> {
  const created: CreatedRecord[] = [];

  // Pre-fetch a fallback Daily row id so we can attach WORKOUT daily
  // logs (FK requires it). One shared row per file is fine — it's just
  // a structural requirement.
  const fallbackDaily = await prisma.daily.findFirst({
    where: { userId, archived: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  // User state we need throughout the pipeline. Fetched once so we
  // don't round-trip per callback. Mirrors the workouts.ts pattern
  // of hoisting user scalars out of the transaction.
  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { xp: true, gold: true, level: true, class: true, mode: true, weightKg: true },
  });
  if (!userRow) {
    // No-op safety: caller should have already 401'd. Keep
    // behavior of not crashing.
    return created;
  }

  // Heart multiplier is read once and reused inside (XP / gold)
  // and outside (raid damage). Hoisted out so the post-commit
  // raid math doesn't ReferenceError when we reference `mult`
  // outside the transaction scope — same pattern workouts.ts
  // uses (see routes/workouts.ts:251-252).
  const currentHearts = await tickHearts(userId);
  const mult = heartMultiplier(currentHearts, userRow.mode ?? 'CASUAL');

  // TZ-aware "today" lower bound for the DailyLog idempotency check.
  // Matches the dailies.ts /complete endpoint pattern so a NYC user
  // doesn't see the same WORKOUT daily double-logged across the UTC
  // vs. local midnight boundary.
  const userTzRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const userTz = userTzRow?.timezone ?? null;
  const todayLocal = localMidnightUtc(todayInTz(userTz), userTz ?? 'UTC');

  if (fit.workouts && fit.workouts.length > 0) {
    for (const w of fit.workouts) {
      // FIT totalTimerTime is whole seconds; Workout.durationSec is
      // stored as whole seconds (matches the manual /workouts POST
      // path and the schema doc). Store seconds verbatim so a
      // 3m23s jump-rope session is exactly 203s, not rounded to 3.
      const durationSec = w.durationSec;
      const notes = [
        w.subSport ? `${w.sport}/${w.subSport}` : w.sport,
        w.distanceMeters ? `${(w.distanceMeters / 1000).toFixed(2)} km` : null,
        w.avgHeartRate ? `avg HR ${w.avgHeartRate}` : null,
        w.maxHeartRate ? `max HR ${w.maxHeartRate}` : null,
        w.totalCalories ? `${w.totalCalories} kcal` : null,
        w.avgPower ? `avg ${w.avgPower}W` : null,
        w.normalizedPower ? `NP ${w.normalizedPower}W` : null,
        w.rpe != null ? `RPE ${w.rpe}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      // Map sport -> WorkoutType
      const type =
        w.sport === 'running' || w.sport === 'walking' || w.sport === 'hiking'
          ? 'CARDIO'
          : w.sport === 'cycling' || w.sport === 'swimming'
          ? 'CARDIO'
          : w.sport === 'training' || w.sport === 'strength_training' || w.sport === 'tactical'
          ? 'STRENGTH'
          : w.sport === 'yoga' || w.sport === 'pilates'
          ? 'MOBILITY'
          : 'OTHER';

      // Resolve the activity title once. The previous code called
      // activityTitle twice (create + update blocks) — wasteful
      // because each call may issue a Nominatim reverse-geocode.
      const title = await activityTitle(w.sport, w.trackpoints);

      // ============================================================
      // Atomic block: workout upsert + PR detection + XP/gold +
      // idempotent DailyLog. Either all land or none do. Mirrors
      // routes/workouts.ts:254-448 (the inner $transaction block).
      // ============================================================
      const result = await prisma.$transaction(async (tx) => {
        // Detect re-import BEFORE the upsert. The previous design
        // used a "<5s createdAt" heuristic on the post-upsert row,
        // which was unreliable (any re-import within 5s double-paid
        // rewards). The unique (userId, performedAt) index lets us
        // do this with a single pre-check that is robust against
        // any time gap.
        const existing = await tx.workout.findUnique({
          where: { userId_performedAt: { userId, performedAt: w.startTime } },
          select: { id: true },
        });
        const wasUpdate = !!existing;

        // Upsert keyed on the (userId, performedAt) unique index.
        // Update path is restricted to mutable fields (notes, name,
        // trackJson, sourceFilename, durationSec). Top-level scalars
        // (type, importSource) shouldn't change on re-import.
        const workoutRow = await tx.workout.upsert({
          where: { userId_performedAt: { userId, performedAt: w.startTime } },
          create: {
            userId,
            type: type as any,
            name: title,
            durationSec,
            notes: `[FIT] ${notes}`,
            importSource,
            sourceFilename,
            performedAt: w.startTime,
            trackJson: (w.trackpoints ?? []) as any,
          },
          update: {
            name: title,
            durationSec,
            notes: `[FIT] ${notes}`,
            sourceFilename,
            trackJson: (w.trackpoints ?? []) as any,
          },
        });

        // PR detection. The FIT parser only emits top-level
        // activity metrics (no nested exercise/set rows), so the
        // workout.exercises list comes back empty from the upsert
        // include and the loop body naturally doesn't run. Loop
        // kept here for parity with workouts.ts — if a future FIT
        // parser starts surfacing structured sets, the PR pipeline
        // just works.
        const prs: Array<{ exercise: string; value: number; previousValue: number | null; type: 'ONE_RM' | 'HOLD' }> = [];
        const workoutForPrs = await tx.workout.findUnique({
          where: { id: workoutRow.id },
          include: { exercises: { include: { sets: true } } },
        });
        if (workoutForPrs && workoutForPrs.exercises.length > 0) {
          const prLib = await import('../lib/pr.js');
          for (const ex of workoutForPrs.exercises) {
            if (!ex.sets.length) continue;
            // ---- HOLD PR (static holds: Dead Hang, Plank, L-Sit, ...) ----
            if (prLib.isStaticHoldExercise(ex.name)) {
              const bestHold = prLib.bestHoldDurationSec(ex.sets);
              if (bestHold != null) {
                const prevHold = await tx.pr.findFirst({
                  where: { userId, exercise: ex.name, type: 'HOLD' },
                  orderBy: { value: 'desc' },
                });
                if (prLib.isPrCandidate(ex.name, bestHold, prevHold?.value)) {
                  const pr = await tx.pr.create({
                    data: {
                      userId,
                      type: 'HOLD',
                      exercise: ex.name,
                      value: bestHold,
                      previousValue: prevHold?.value ?? null,
                      workoutId: workoutRow.id,
                    },
                  });
                  prs.push({ exercise: ex.name, value: pr.value, previousValue: pr.previousValue, type: 'HOLD' });
                }
              }
            }
            // ---- ONE_RM PR (weight×reps sets) ----
            const bestSet = ex.sets
              .filter((s) => s.completed && !s.skipped && (s.weight ?? 0) > 0 && s.reps > 0)
              .reduce<{ value: number; weight: number; reps: number } | null>((acc, s) => {
                const v = prLib.bestEstimatedOneRm(s.weight ?? 0, s.reps);
                if (acc == null || v > acc.value) return { value: v, weight: s.weight ?? 0, reps: s.reps };
                return acc;
              }, null);
            if (!bestSet) continue;
            const prev = await tx.pr.findFirst({
              where: { userId, exercise: ex.name, type: 'ONE_RM' },
              orderBy: { value: 'desc' },
            });
            if (prLib.isPrCandidate(ex.name, bestSet.value, prev?.value)) {
              const pr = await tx.pr.create({
                data: {
                  userId,
                  type: 'ONE_RM',
                  exercise: ex.name,
                  value: bestSet.value,
                  previousValue: prev?.value ?? null,
                  workoutId: workoutRow.id,
                },
              });
              prs.push({ exercise: ex.name, value: pr.value, previousValue: pr.previousValue, type: 'ONE_RM' });
            }
          }
        }

        // XP / gold. Apply the graduated Hardcore heart multiplier.
        // Skipped on re-uploads (`wasUpdate`) — the original
        // upload already paid out (matches workouts.ts).
        const previousLevel = userRow.level;
        let xp = 0;
        let gold = 0;
        let newXp = userRow.xp;
        let newGold = userRow.gold;
        let newLevel = userRow.level;
        let dailyXpDelta = 0;
        let dailyGoldDelta = 0;
        let dailyLogId: string | null = null;
        if (!wasUpdate) {
          const baseXp = xpFromWorkout({
            type: workoutRow.type as any,
            totalVolumeKg: 0, // FIT imports don't surface per-set volume
            durationMin: durationSec / 60,
            prCount: prs.length,
          });
          const baseGold = goldFromWorkout({
            type: workoutRow.type,
            prCount: prs.length,
            durationMin: durationSec / 60,
          });
          xp = Math.round(baseXp * mult);
          gold = Math.round(baseGold * mult);
          newXp = userRow.xp + xp;
          newGold = userRow.gold + gold;
          newLevel = Math.max(userRow.level, levelFromXp(newXp));
          await tx.user.update({
            where: { id: userId },
            data: { xp: newXp, gold: newGold, level: newLevel },
          });

          // DailyLog: replaced the old hardcoded goldDelta:10 /
          // xpDelta:15 insert (which bypassed the heart multiplier
          // and never matched what awardXpGold actually credits)
          // with the day-key idempotency the /dailies/:id/complete
          // endpoint uses (find-or-skip keyed on the local midnight
          // in the user's tz). The WORKOUT built-in's documented
          // reward is 10g / 15xp (see routes/dailies.ts:76-77); we
          // apply the heart mult and write a DailyLog with the
          // ACTUAL deltas so the audit row reflects what really
          // happened — matches the dailies.ts pattern.
          if (fallbackDaily) {
            const todaysLog = await tx.dailyLog.findFirst({
              where: {
                userId,
                dailyKey: 'WORKOUT',
                loggedAt: { gte: todayLocal },
              },
            });
            if (!todaysLog) {
              const baseDailyXp = 15;
              const baseDailyGold = 10;
              dailyXpDelta = Math.round(baseDailyXp * mult);
              dailyGoldDelta = Math.round(baseDailyGold * mult);
              const logRow = await tx.dailyLog.create({
                data: {
                  userId,
                  dailyId: fallbackDaily.id,
                  dailyKey: 'WORKOUT',
                  goldDelta: dailyGoldDelta,
                  xpDelta: dailyXpDelta,
                  loggedAt: w.startTime,
                  sourceFilename,
                },
              });
              dailyLogId = logRow.id;
            }
          }
        }

        return {
          workout: workoutRow,
          xp,
          gold,
          totalXp: newXp,
          totalGold: newGold,
          level: newLevel,
          previousLevel,
          leveledUp: newLevel > previousLevel,
          wasUpdate,
          dailyXpDelta,
          dailyGoldDelta,
          dailyLogId,
        };
      });

      created.push({
        kind: 'workout',
        id: result.workout.id,
        summary: `${w.sport} · ${Math.round(durationSec / 60)}m`,
      });
      if (result.dailyLogId) {
        created.push({
          kind: 'daily_log',
          id: result.dailyLogId,
          dailyKey: 'WORKOUT',
        });
      }

      // ============================================================
      // Post-commit pipeline. Mirrors routes/workouts.ts:450-823 —
      // ALL of these fire per-workout post-transaction and are
      // gated by `!wasUpdate` so re-imports don't double-credit.
      // Each is wrapped best-effort (try/catch + log) so a single
      // failure can't roll back the workout commit (matches
      // workouts.ts:486-487 / 762-764 / 784-785).
      // ============================================================

      // 4. Activity → skill matching pass. Same shape as
      //    workouts.ts:461-488. Falls through silently when the
      //    user has no class (locked out of skills entirely).
      if (!result.wasUpdate) try {
        const skillLib = await import('../lib/skillMatching.js');
        const eligible = await skillLib.findEligibleSkillUnlocks(
          userId,
          userRow.weightKg ?? 0,
        );
        for (const e of eligible) {
          try {
            await prisma.pendingSkillUnlock.create({
              data: {
                userId,
                skillId: e.skillId,
                workoutId: e.matchedSet.workoutId,
                matchedSetId: e.matchedSet.setId,
                setReps: e.matchedSet.reps,
                setWeight: e.matchedSet.weight,
                setDuration: e.matchedSet.duration,
                exerciseName: e.matchedSet.exerciseName,
                workoutDate: e.matchedSet.workoutDate,
              },
            });
          } catch (err: any) {
            if (err?.code !== 'P2002') throw err;
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[import] skill matching failed', err);
      }

      // 5. Penances. The two big workout-commit repair events fire
      //    here (matching workouts.ts:500-522):
      //      - MOBILITY workouts → +6 shield (logged_mobility)
      //      - CARDIO ≥30 min    → +8 shield (logged_cardio_30)
      //    Stretch-keyword detection is skipped for FIT imports
      //    because no exercise names are carried in the parse
      //    (only the top-level type field).
      if (!result.wasUpdate) try {
        const penanceLib = await import('../lib/penance.js');
        const fires: Array<{ key: 'logged_mobility' | 'logged_cardio_30'; source: 'workout_commit' }> = [];
        if (type === 'MOBILITY') {
          fires.push({ key: 'logged_mobility', source: 'workout_commit' });
        }
        if (type === 'CARDIO' && durationSec >= 30 * 60) {
          fires.push({ key: 'logged_cardio_30', source: 'workout_commit' });
        }
        if (fires.length > 0) {
          await penanceLib.firePenances(userId, fires);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[import] penance fire failed', err);
      }

      // 6. Raid damage. Compute from workout (returns total=0 for
      //    FIT imports because they have no per-set contribution
      //    data), apply class multiplier, contribute to the active
      //    raid for the user's party. Skipped on re-uploads.
      //    Mirrors workouts.ts:524-695. The victory / XP-share
      //    block is retained for completeness even though it
      //    won't fire in practice (FIT imports yield total=0).
      if (!result.wasUpdate) try {
        const { equip } = await getEquippedBonus(userId);
        const raidDamage = computeRaidDamage(
          {
            type: type as any,
            durationMin: durationSec / 60,
            exercises: [], // FIT imports don't surface per-set data
          },
          userRow.class,
          equip,
        );
        if (userRow.class && raidDamage.total > 0) {
          const membership = await prisma.partyMember.findUnique({ where: { userId } });
          if (membership) {
            const raid = await prisma.raid.findFirst({
              where: { partyId: membership.partyId, status: 'ACTIVE' },
            });
            if (raid) {
              const buff = await prisma.partyBuff.findUnique({
                where: { partyId: membership.partyId },
              });
              const buffActive = buff && buff.expiresAt > new Date();
              const buffedDamage = buffActive
                ? Math.round(raidDamage.total * mult * (1 + (buff?.raidDmgBonusPct ?? 0) / 100))
                : Math.round(raidDamage.total * mult);
              const [contribution] = await prisma.$transaction([
                prisma.raidContribution.create({
                  data: {
                    raidId: raid.id,
                    userId,
                    damage: buffedDamage,
                    source: 'workout',
                  },
                }),
                prisma.raid.update({
                  where: { id: raid.id },
                  data: { bossHp: { decrement: buffedDamage } },
                }),
              ]);
              const claimed = await prisma.raid.updateMany({
                where: { id: raid.id, status: 'ACTIVE', bossHp: { lte: 0 } },
                data: { status: 'VICTORY', endedAt: new Date(), bossHp: 0 },
              });
              if (claimed.count === 1) {
                // On victory, distribute XP + gold to all members
                // via the centralized awardXpGold path (applies
                // each member's own heart multiplier + recomputes
                // their level — matches workouts.ts:603-654).
                const members = await prisma.partyMember.findMany({ where: { partyId: raid.partyId } });
                const totalAgg = await prisma.raidContribution.aggregate({
                  where: { raidId: raid.id },
                  _sum: { damage: true },
                });
                const totalDamage = totalAgg._sum.damage ?? raidDamage.total;
                for (const m of members) {
                  const myAgg = await prisma.raidContribution.aggregate({
                    where: { raidId: raid.id, userId: m.userId },
                    _sum: { damage: true },
                  });
                  const my = myAgg._sum.damage ?? 0;
                  const share = Math.round((my / totalDamage) * 200) + 50;
                  await awardXpGold(m.userId, { xp: share, gold: Math.floor(share / 4) });
                }
              }
              // (raidContribution intentionally not surfaced to the
              // batch response — see workouts.ts for the
              // single-commit response shape; imports are
              // batch-shaped.)
              void contribution;
            }
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[import] raid damage hook failed', err);
      }

      // 7. Breach damage. Lazy-unlocks at level 10; below that
      //    the function is a no-op. Mirrors workouts.ts:697-765.
      if (!result.wasUpdate) try {
        const breachLib = await import('../lib/breach.js');
        await breachLib.unlockBreachIfReady(userId, result.level);
        await breachLib.tickCooldown(userId);
        await breachLib.applyWorkoutDamage(userId, result.workout.id);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[import] breach damage hook failed', err);
      }

      // 8. Portal-leak damage. Same auto-apply pattern as
      //    workouts.ts:767-786. dedup is by workoutId inside the
      //    lib so re-imports won't double-damage (the C2 dup fix
      //    lives in the lib, not here).
      if (!result.wasUpdate) try {
        const leakLib = await import('../lib/portalLeaks.js');
        await leakLib.applyLeakDamage(userId, result.workout.id);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[import] leak damage hook failed', err);
      }

      // 9. Per-workout post-commit: achievements + routine
      //    progress. Both fire best-effort and re-uploads skip
      //    the achievements pass. Matches workouts.ts:450 + 493.
      if (!result.wasUpdate) {
        await checkAchievements(userId);
      }
      await checkRoutineProgress(userId);

      // 10. Race-time inference: infer a 1-mile or 5K time from
      //     CARDIO FIT activities when plausible. Runs regardless
      //     of wasUpdate (it's idempotent in itself — findFirst
      //     against an existing measurement, only writes if
      //     faster). Preserved verbatim from the original.
      await maybeInferStandardDistance(userId, w, result.workout.id);
    }
  }

  if (fit.measurements && fit.measurements.length > 0) {
    for (const m of fit.measurements) {
      // Upsert on the unique (userId, metric, recordedAt) tuple so
      // re-importing the same .fit file (or its mirror backup) is a
      // no-op rather than piling up duplicate rows. If a row already
      // exists for this triple, update the value/unit/notes — the
      // FIT file is treated as the source of truth on conflict.
      const created_row = await prisma.measurement.upsert({
        where: {
          userId_metric_recordedAt: {
            userId,
            metric: m.metric as any,
            recordedAt: m.recordedAt,
          },
        },
        create: {
          userId,
          metric: m.metric as any,
          value: m.value,
          unit: unitFor(m.metric),
          notes: m.notes ?? null,
          recordedAt: m.recordedAt,
          sourceFilename,
        },
        update: {
          value: m.value,
          unit: unitFor(m.metric),
          notes: m.notes ?? null,
          sourceFilename,
        },
      });
      created.push({
        kind: 'measurement',
        metric: m.metric,
        id: created_row.id,
        value: m.value,
      });
    }
  }

  return created;
}

function unitFor(metric: string): string {
  switch (metric) {
    case 'SLEEP_HOURS':
      return 'h';
    case 'SLEEP_QUALITY':
      return '/10';
    // SLEEP_ONSET is fractional hours (e.g. 22.5 = 10:30 PM). The
    // chart treats it as unitless clock time, but we record the
    // canonical unit so future "what unit is this?" lookups resolve.
    case 'SLEEP_ONSET':
      return 'h';
    case 'HRV':
      return 'ms';
    case 'RESTING_HR':
      return 'bpm';
    case 'STRESS':
      return '/100';
    case 'BODY_BATTERY':
      return '/100';
    case 'STEPS':
      return '';
    case 'RESPIRATION_RATE':
      return 'brpm';
    case 'VO2_MAX':
      return 'ml/kg/min';
    default:
      return '';
  }
}

export async function importRoutes(app: FastifyInstance) {
  // Configure body limit for this scope
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit },
    (_req, payload, done) => done(null, payload),
  );

  // POST /import — single .fit file (binary body)
  app.post('/', { bodyLimit }, async (req, reply) => {
    const me = await requireUser(req);
    const buf = req.body as Buffer | undefined;
    if (!buf || !Buffer.isBuffer(buf)) {
      return reply.code(400).send({ error: 'Expected .fit binary in request body' });
    }
    if (buf.length > MAX_FILE_BYTES) {
      return reply.code(413).send({ error: `File exceeds ${MAX_FILE_BYTES} bytes` });
    }
    if (!isFitBuffer(buf)) {
      return reply.code(400).send({ error: 'Not a FIT file (bad header)' });
    }
    const fit = parseFit(buf, me.timezone ?? 'UTC');
    // Single-file endpoint accepts ?source=BRIDGE for parity with
    // /batch. We don't expect anyone to use this path with the
    // bridge (it always batches) but keeping the API symmetric
    // means any future client can flag its origin.
    const singleSource = ImportSourceSchema.parse((req.query as any)?.source ?? undefined) ?? WorkoutSource.WEB;
    const created = await persist(me.id, fit, singleSource, 'upload.fit');
    const fileResult: FileResult = {
      filename: 'upload.fit',
      fitKind: fit.kind,
      sourceTimestamp: fit.sourceTimestamp,
      created,
      skipped: fit.skipped ?? [],
    };
    return { files: [fileResult] };
  });

  // POST /import/batch — accepts JSON { files: [{ filename, contentBase64 }] }.
// The frontend reads each File as ArrayBuffer, base64-encodes it, and
// posts them in one request. This is more portable than multipart and
// avoids the @fastify/multipart streaming quirks across versions. We
// re-parse each file as a buffer on the server side and process it.
//
// Optional `source` field ('WEB' | 'BRIDGE' | 'BULK_REPROCESS')
// identifies the ingest surface. Default WEB so old clients keep
// working. The FitQuestBridge APK sets `source: 'BRIDGE'` on every
// batch so the /import page can distinguish auto-uploads.
  app.post('/batch', { bodyLimit }, async (req, reply) => {
    const me = await requireUser(req);
    const body = z.object({
      files: z.array(z.object({
        filename: z.string().min(1).max(200),
        contentBase64: z.string().min(1),
      })).min(1).max(50),
      source: ImportSourceSchema,
    }).parse(req.body);
    const source: WorkoutSource = body.source ?? WorkoutSource.WEB;
    const results: FileResult[] = [];
    for (const f of body.files) {
      try {
        const buf = Buffer.from(f.contentBase64, 'base64');
        if (buf.length > MAX_FILE_BYTES) {
          results.push({
            filename: f.filename,
            fitKind: 'unknown',
            sourceTimestamp: null,
            created: [],
            skipped: [{ reason: `File exceeds ${MAX_FILE_BYTES} bytes` }],
          });
          continue;
        }
        if (!isFitBuffer(buf)) {
          results.push({
            filename: f.filename,
            fitKind: 'unknown',
            sourceTimestamp: null,
            created: [],
            skipped: [{ reason: 'Not a FIT file (bad header)' }],
          });
          continue;
        }
        const fit = parseFit(buf, me.timezone ?? 'UTC');
        const created = await persist(me.id, fit, source, f.filename);
        results.push({
          filename: f.filename,
          fitKind: fit.kind,
          sourceTimestamp: fit.sourceTimestamp,
          created,
          skipped: fit.skipped ?? [],
        });
      } catch (e: any) {
        results.push({
          filename: f.filename,
          fitKind: 'unknown',
          sourceTimestamp: null,
          created: [],
          skipped: [{ reason: `Decode failed: ${e?.message ?? 'unknown'}` }],
        });
      }
    }
    return { files: results };
  });

  // GET /import/summary — recent imports for the UI
  app.get('/summary', async (req) => {
    const me = await requireUser(req);
    const [recentWorkouts, recentSleep, recentSleepOnset, recentHrv] = await Promise.all([
      prisma.workout.findMany({
        where: { userId: me.id, notes: { startsWith: '[FIT]' } },
        orderBy: { performedAt: 'desc' },
take: 10,
      select: { id: true, name: true, notes: true, performedAt: true, durationSec: true },
    }),
      prisma.measurement.findMany({
        where: { userId: me.id, metric: 'SLEEP_HOURS' },
        orderBy: { recordedAt: 'desc' },
        take: 7,
        select: { id: true, value: true, recordedAt: true },
      }),
      prisma.measurement.findMany({
        where: { userId: me.id, metric: 'SLEEP_ONSET' },
        orderBy: { recordedAt: 'desc' },
        take: 7,
        select: { id: true, value: true, recordedAt: true },
      }),
      prisma.measurement.findMany({
        where: { userId: me.id, metric: 'HRV' },
        orderBy: { recordedAt: 'desc' },
        take: 7,
        select: { id: true, value: true, recordedAt: true, notes: true },
      }),
    ]);
    return { recentWorkouts, recentSleep, recentSleepOnset, recentHrv };
  });

  // GET /import/bridge-summary — recent FIT files ingested via
  // the FitQuestBridge APK (importSource = BRIDGE). The /import
  // page renders this in a collapsed panel below the existing
  // "Recent imports" block so the user can confirm the bridge is
  // doing its job without mixing it into the manually-imported
  // log.
  //
  // We group by local-date in the user's tz (matching how the
  // /import page renders "Today / Tomorrow" elsewhere) so a
  // bridge batch that uploads several files around midnight
  // doesn't split weirdly across days. The activity names come
  // straight from the Workout row — `notes` is auto-populated by
  // the FIT parser with `<sport>/<subsport> · <distance> · …`.
  app.get('/bridge-summary', async (req) => {
    const me = await requireUser(req);
    const days = Math.max(1, Math.min(60, Number((req.query as any)?.days) || 14));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await prisma.workout.findMany({
      where: {
        userId: me.id,
        importSource: WorkoutSource.BRIDGE,
        performedAt: { gte: since },
      },
      orderBy: { performedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        name: true,
        notes: true,
        performedAt: true,
        durationSec: true,
      },
    });

    // Group by local-date string. We use Intl.DateTimeFormat so
    // the bucket respects the user's tz (vs. UTC). This is the
    // same pattern the /forecast page uses.
    const tz = me.timezone ?? 'UTC';
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const byDate = new Map<string, {
      date: string;
      count: number;
      totalDurationMin: number;
      items: Array<{ id: string; name: string | null; notes: string | null; performedAt: string; durationSec: number | null }>;
    }>();
    for (const r of rows) {
      const date = fmt.format(r.performedAt); // YYYY-MM-DD in tz
      const bucket = byDate.get(date) ?? {
        date,
        count: 0,
        totalDurationMin: 0,
        items: [],
      };
      bucket.count += 1;
      bucket.totalDurationMin += Math.round((r.durationSec ?? 0) / 60);
      bucket.items.push({
        id: r.id,
        name: r.name,
        notes: r.notes,
        performedAt: r.performedAt.toISOString(),
        durationSec: r.durationSec,
      });
      byDate.set(date, bucket);
    }
    const groups = Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? 1 : -1));

    return {
      days,
      totalCount: rows.length,
      groups,
    };
  });

  // ============================================================
  // POST /import/data — accept a user-export JSON payload and
  // re-create rows under the current user. Distinct from the
  // FIT-import endpoints above: those ingest wearable data,
  // this ingests our own user-data export.
  //
  // Body: { payload: ExportPayload, dryRun?: boolean, wipeFirst?: boolean }
  //
  // Body limit: 64 MB. A real user export with years of workouts
  // + measurements can run 15-30 MB; we leave headroom for big
  // imports. Caps at 64 MB to prevent runaway uploads.
  // ============================================================
  app.post('/data', { bodyLimit: 64 * 1024 * 1024 }, async (req, reply) => {
    const me = await requireUser(req);
    const body = z.object({
      payload: z.unknown(),
      dryRun: z.boolean().optional(),
      wipeFirst: z.boolean().optional(),
    }).parse(req.body);
    try {
      validatePayload(body.payload);
    } catch (e) {
      if (e instanceof ImportError) {
        return reply.code(400).send({ error: e.message });
      }
      throw e;
    }
    const result = await importExport(me.id, body.payload as any, {
      dryRun: body.dryRun,
      wipeFirst: body.wipeFirst,
    });
    return reply.send(result);
  });

  // GET /import/bridge-history — every bridge-uploaded item
  // the user has, across all three tables (Workout, Measurement,
  // DailyLog), grouped by sourceFilename. The Import page
  // renders this in a collapsed-by-default panel so the user can
  // see exactly which .fit files the bridge has uploaded
  // (including pure-sleep, pure-HRV, monitor-only files that
  // never produced a Workout row).
  //
  // If a row has sourceFilename IS NULL (legacy bridge uploads
  // before the sourceFilename migration), it's grouped under
  // "(unknown filename)" so it still surfaces in the list.
  app.get('/bridge-history', async (req) => {
    const me = await requireUser(req);
    const userId = me.id;

    // Three parallel reads, one per table. All filtered to
    // importSource = BRIDGE (well — Measurement + DailyLog don't
    // carry importSource; the bridge is the only writer that
    // sets sourceFilename on those tables, so the filename
    // filter alone is sufficient).
    const [workoutRows, measurementRows, dailyLogRows] = await Promise.all([
      prisma.workout.findMany({
        where: { userId, importSource: WorkoutSource.BRIDGE },
        orderBy: { performedAt: 'desc' },
        select: { id: true, name: true, notes: true, performedAt: true, durationSec: true, sourceFilename: true },
      }),
      prisma.measurement.findMany({
        where: { userId, sourceFilename: { not: null } },
        orderBy: { recordedAt: 'desc' },
        select: { id: true, metric: true, value: true, unit: true, recordedAt: true, sourceFilename: true, notes: true },
      }),
      prisma.dailyLog.findMany({
        where: { userId, sourceFilename: { not: null } },
        orderBy: { loggedAt: 'desc' },
        select: { id: true, dailyKey: true, loggedAt: true, sourceFilename: true, goldDelta: true, xpDelta: true },
      }),
    ]);

    // Normalize all rows into a single shape keyed by the
    // originating table. Union'd before grouping so a file
    // that produced 1 workout + 3 measurements + 2 daily-logs
    // shows all 6 rows under the same filename.
    type Item =
      | { kind: 'workout'; id: string; name: string | null; durationSec: number | null; performedAt: string; notes: string | null }
      | { kind: 'measurement'; id: string; metric: string; value: number; unit: string; recordedAt: string; notes: string | null }
      | { kind: 'daily_log'; id: string; dailyKey: string; loggedAt: string; goldDelta: number; xpDelta: number };
    const all: Array<{ filename: string; ts: string; item: Item }> = [];
    for (const w of workoutRows) {
      all.push({
        filename: w.sourceFilename ?? '(unknown)',
        ts: w.performedAt.toISOString(),
        item: { kind: 'workout', id: w.id, name: w.name, durationSec: w.durationSec, performedAt: w.performedAt.toISOString(), notes: w.notes },
      });
    }
    for (const m of measurementRows) {
      all.push({
        filename: m.sourceFilename ?? '(unknown)',
        ts: m.recordedAt.toISOString(),
        item: { kind: 'measurement', id: m.id, metric: m.metric, value: m.value, unit: m.unit, recordedAt: m.recordedAt.toISOString(), notes: m.notes },
      });
    }
    for (const d of dailyLogRows) {
      all.push({
        filename: d.sourceFilename ?? '(unknown)',
        ts: d.loggedAt.toISOString(),
        item: { kind: 'daily_log', id: d.id, dailyKey: d.dailyKey, loggedAt: d.loggedAt.toISOString(), goldDelta: d.goldDelta, xpDelta: d.xpDelta },
      });
    }

    // Group by filename.
    type FileGroup = {
      filename: string;
      firstAt: string;
      lastAt: string;
      counts: { workout: number; measurement: number; daily_log: number };
      items: Item[];
    };
    const byFile = new Map<string, FileGroup>();
    for (const { filename, ts, item } of all) {
      let g = byFile.get(filename);
      if (!g) {
        g = { filename, firstAt: ts, lastAt: ts, counts: { workout: 0, measurement: 0, daily_log: 0 }, items: [] };
        byFile.set(filename, g);
      }
      g.items.push(item);
      g.counts[item.kind] += 1;
      if (ts > g.lastAt) g.lastAt = ts;
      if (ts < g.firstAt) g.firstAt = ts;
    }
    // Newest file first.
    const files = Array.from(byFile.values()).sort((a, b) =>
      b.lastAt.localeCompare(a.lastAt),
    );
    const totalItems = all.length;
    return { totalFiles: files.length, totalItems, files };
  });
}
/**
 * Infer a 1-mile or 5K time from an imported CARDIO activity. We
 * compare the activity's distance to the target distance, allowing a
 * ±20% margin so that "ran a touch over a mile" still counts as a
 * mile (rounding-by-watch is common) but "ran a 5K loop plus an extra
 * mile warm-up" doesn't get mis-logged as a 5K.
 *
 * We only log when:
 *  - sport is running-like (run, walk, hike, trail)
 *  - duration is plausibly a race effort (4-15 min for 1mi, 14-50 min for 5K)
 *  - the inferred time would be FASTER than the user's existing best
 *    (so we don't pollute the dashboard with slower times)
 */
async function maybeInferStandardDistance(
  userId: string,
  w: { sport: string; subSport?: string; distanceMeters?: number; durationSec: number; startTime: Date },
  workoutId: string,
): Promise<void> {
  if (w.distanceMeters == null || w.distanceMeters <= 0) return;
  if (w.durationSec < 60) return; // ignore ultra-short

  const runningLike = ['running', 'walking', 'hiking', 'trail_running'];
  if (!runningLike.includes(w.sport)) return;

  const targets: Array<{
    metric: 'ONE_MILE_TIME' | 'FIVE_K_TIME';
    meters: number;
    margin: number; // fraction
    minSec: number;
    maxSec: number;
  }> = [
    { metric: 'ONE_MILE_TIME', meters: 1609.34, margin: 0.20, minSec: 4 * 60, maxSec: 15 * 60 },
    { metric: 'FIVE_K_TIME',    meters: 5000,    margin: 0.20, minSec: 14 * 60, maxSec: 50 * 60 },
  ];

  for (const t of targets) {
    const low = t.meters * (1 - t.margin);
    const high = t.meters * (1 + t.margin);
    if (w.distanceMeters < low || w.distanceMeters > high) continue;
    if (w.durationSec < t.minSec || w.durationSec > t.maxSec) continue;

    // Only log if it's faster than the user's existing best.
    const existing = await prisma.measurement.findFirst({
      where: { userId, metric: t.metric },
      orderBy: { value: 'asc' },
    });
    if (existing && existing.value <= w.durationSec) continue;

    await prisma.measurement.create({
      data: {
        userId,
        metric: t.metric,
        value: w.durationSec,
        unit: 's',
        notes: `Inferred from FIT activity ${workoutId.slice(-6)} (${(w.distanceMeters / t.meters).toFixed(2)}× target distance)`,
        recordedAt: w.startTime,
      },
    });
  }
}
