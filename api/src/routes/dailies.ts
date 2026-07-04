import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DayOfWeek, DailyCategory, prisma } from '../lib/prisma.js';
import type { DayOfWeek as DayOfWeekType } from '@prisma/client';
import { requireUser } from '../lib/auth.js';
import { checkAchievements } from '../lib/achievements.js';
import { computeRecovery } from '../lib/recovery.js';
import { todayInTz, localMidnightUtc } from '../lib/timezone.js';

const createSchema = z.object({
  name: z.string().min(1).max(80),
  days: z.array(z.nativeEnum(DayOfWeek)).default([]),
  notes: z.string().max(500).optional().nullable(),
  // Tier-derived rewards. The client picks from a fixed set of difficulty
  // tiers (Trivial/Easy/Medium/Hard/Epic) rather than typing raw values,
  // mirroring Habitica's todo weight system. Defaults: 5g / 5xp.
  goldReward: z.number().int().min(0).max(1000).default(5),
  xpReward: z.number().int().min(0).max(1000).default(5),
  category: z.nativeEnum(DailyCategory).default('USER'),
  // Master switch for "show on /today". Custom SPIRITUAL practices
  // are created with isDaily=true by default so they appear in the
  // daily checklist immediately. Toggleable from the /spiritual
  // "Daily prayers" panel (click to add/remove).
  isDaily: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const updateSchema = createSchema.partial().extend({
  archived: z.boolean().optional(),
});

// Day-of-week index for JavaScript getDay() (0=Sun..6=Sat).
// We use the same enum values on both sides so this lookup is direct.
// TZ-aware: compute today's date in the user's tz (DST-safe noon
// anchor), then take getUTCDay — same pattern fetchDailiesForDate
// uses for the dateStr branch. Was previously `new Date().getDay()`
// which returned the SERVER's local weekday (UTC in Docker) and made
// a NYC user at 8pm EDT see tomorrow's dailies.
function todayDay(tz: string | null): DayOfWeekType {
  const dateStr = todayInTz(tz ?? null);
  const noonUtc = new Date(`${dateStr}T12:00:00Z`);
  return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][noonUtc.getUTCDay()] as DayOfWeek;
}

// Built-in daily IDs. We synthesize these on-the-fly rather than
// persisting them as Daily rows, so user edits to schedule/notes don't
// blow them away. dailyKey is the stable identifier across days.
const BUILTIN_KEYS = ['WORKOUT'] as const;

function buildBuiltins(opts: {
  routineDays: Array<{ day: DayOfWeekType; workout: boolean; notes: string | null }>;
}): Array<{
  id: string;
  name: string;
  category: 'WORKOUT';
  days: DayOfWeekType[];
  notes: string | null;
  goldReward: number;
  xpReward: number;
  sortOrder: number;
  todayDone: boolean;
}> {
  const workoutDays = opts.routineDays.filter((d) => d.workout).map((d) => d.day);
  return [
    {
      id: 'WORKOUT',
      name: 'Workout',
      category: 'WORKOUT',
      days: workoutDays,
      notes:
        opts.routineDays
          .filter((d) => d.workout && d.notes)
          .map((d) => `${d.day}: ${d.notes}`)
          .join(' · ') || null,
      goldReward: 10,
      xpReward: 15,
      sortOrder: -100,
      todayDone: false, // filled in by caller
    },
  ];
}

export async function dailyRoutes(app: FastifyInstance) {
  // GET /dailies — list all active dailies (user + built-in) for the user
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const [userDailies, routineDays] = await Promise.all([
      prisma.daily.findMany({
        where: { userId: me.id, archived: false },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.routineDay.findMany({ where: { userId: me.id } }),
    ]);
    return {
      items: userDailies,
      routineDays,
    };
  });

  // GET /dailies/today — dailies due today with completion status.
  // Combines user-defined dailies + built-in WORKOUT + built-in
  // SPIRITUAL (prayers the user committed to daily).
  /**
 * Internal helper — fetch dailies + completion status for a given
 * local date (YYYY-MM-DD in the user's tz). Used by both the
 * /today endpoint and the /morning-popup endpoint (which queries
 * yesterday's state to drive the recovery UI).
 */
async function fetchDailiesForDate(
  userId: string,
  timezone: string | null,
  dateStr: string | null,
) {
  const { localMidnightUtc, todayInTz } = await import('../lib/timezone.js');
  const tz = timezone ?? 'UTC';
  let startOfDay: Date;
  let tomorrow: Date;
  let today: DayOfWeekType;
  if (dateStr) {
    startOfDay = localMidnightUtc(dateStr, tz);
    tomorrow = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const targetLocalDate = todayInTz(tz, startOfDay);
    const dt = new Date(`${targetLocalDate}T12:00:00Z`);
    const dow = ['SUN','MON','TUE','WED','THU','FRI','SAT'][dt.getUTCDay()];
    today = dow as DayOfWeekType;
  } else {
    // Default "today" in the user's tz — was previously server-local
    // (UTC in Docker), which made a NYC user at 8pm EDT see
    // tomorrow's dailies because UTC had already rolled over.
    const todayStr = todayInTz(tz);
    startOfDay = localMidnightUtc(todayStr, tz);
    tomorrow = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    today = todayDay(tz);
  }

  const [userDailies, routineDays, todayLogs, recentWorkout] = await Promise.all([
    prisma.daily.findMany({
      where: { userId, archived: false, isDaily: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.routineDay.findMany({ where: { userId } }),
    prisma.dailyLog.findMany({
      where: { userId, loggedAt: { gte: startOfDay, lt: tomorrow } },
    }),
    prisma.workout.count({
      where: { userId, performedAt: { gte: startOfDay, lt: tomorrow } },
    }),
  ]);

  const dueUserDailies = userDailies.filter(
    (d) => d.days.length === 0 || d.days.includes(today),
  );

  const loggedKeys = new Set(todayLogs.map((l) => l.dailyKey));
  const userDailiesCompleted = dueUserDailies.filter((d) => loggedKeys.has(d.id)).length;

  const workoutDayRow = routineDays.find((r) => r.day === today);
  const isWorkoutDay = workoutDayRow?.workout ?? false;
  const builtins = buildBuiltins({ routineDays }).map((b) => ({
    ...b,
    todayDone: b.id === 'WORKOUT' ? recentWorkout > 0 : loggedKeys.has(b.id),
  }));

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { spiritualDailyPrayers: true },
  });
  const spiritualDailies = (me?.spiritualDailyPrayers ?? []).map((p) => ({
    id: `SPIRITUAL:${p}`,
    name: prayerLabel(p),
    category: 'SPIRITUAL' as const,
    days: [today] as DayOfWeekType[],
    notes: null,
    goldReward: 0,
    xpReward: 0,
    sortOrder: -50,
    todayDone: loggedKeys.has(`SPIRITUAL:${p}`),
    prayerType: p,
  }));

  const userDailiesWithStatus = dueUserDailies.map((d) => ({
    ...d,
    todayDone: loggedKeys.has(d.id),
  }));

  return {
    date: dateStr ?? null,
    today,
    userDailies: userDailiesWithStatus,
    builtins,
    spiritualDailies,
    counts: {
      total: dueUserDailies.length + builtins.length + spiritualDailies.length,
      completed:
        userDailiesCompleted +
        builtins.filter((b) => b.todayDone).length +
        spiritualDailies.filter((s) => s.todayDone).length,
      isWorkoutDay,
    },
  };
}

app.get('/today', async (req) => {
    const me = await requireUser(req);
    const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
    return fetchDailiesForDate(me.id, me.timezone, q.date ?? null);
});

  /**
   * GET /dailies/morning-popup?date=YYYY-MM-DD
   *
   * Bundled payload for the morning popup modal. Combines:
   *   - the user's dailies for `date` (default: yesterday) with
   *     completion status, so missed items are easy to tick off
   *     and avoid the MISSED_ALL_DAILIES heart-loss trigger
   *   - a one-shot yesterday recap (workout logged, sleep duration,
   *     weigh-in status, recovery score)
   *   - any Hardcore-mode heart-loss events that fired yesterday
   *     (so the popup can animate the count down)
   *
   * The popup dismisses itself and re-fetches on demand, so we
   * don't bother with caching.
   */
  app.get<{ Querystring: { date?: string } }>('/morning-popup', async (req, reply) => {
    try {
      const me = await requireUser(req);
      const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
      const { localMidnightUtc, todayInTz } = await import('../lib/timezone.js');
      const tz = me.timezone ?? 'UTC';

      // Default date = yesterday in the user's tz.
      const nowLocal = todayInTz(tz);
      const targetDate = q.date ?? (() => {
        const todayMidnight = localMidnightUtc(nowLocal, tz);
        const yesterday = new Date(todayMidnight.getTime() - 24 * 60 * 60 * 1000);
        return todayInTz(tz, yesterday);
      })();

      const startOfDay = localMidnightUtc(targetDate, tz);
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

      // Dailies for the target date (use the shared helper directly
      // — no need to round-trip through app.inject in a route).
      const dailiesForDate = await fetchDailiesForDate(me.id, tz, targetDate);

      // Yesterday recap: workout + sleep + weigh-in + recovery.
      // Each query has its own .catch so a single DB hiccup doesn't
      // take down the whole popup — the UI surfaces the field as
      // "n/a" instead. Better than a 500 that blocks the user from
      // seeing their dailies (the actionable part of the popup).
      const [workouts, sleep, latestWeight, recovery, heartLoss] = await Promise.all([
        prisma.workout.findMany({
          where: { userId: me.id, performedAt: { gte: startOfDay, lt: endOfDay } },
          select: { id: true, name: true, type: true, duration: true, performedAt: true },
          orderBy: { performedAt: 'asc' },
        }).catch(() => []),
        prisma.measurement.findFirst({
          where: { userId: me.id, metric: 'SLEEP_HOURS', recordedAt: { gte: startOfDay, lt: endOfDay } },
          orderBy: { recordedAt: 'desc' },
          select: { value: true, recordedAt: true },
        }).catch(() => null),
        prisma.measurement.findFirst({
          where: { userId: me.id, metric: 'WEIGHT' },
          orderBy: { recordedAt: 'desc' },
          select: { value: true, recordedAt: true },
        }).catch(() => null),
        // Recovery score is server-computed; re-use the engine.
        computeRecovery(me.id).catch(() => ({ score: null })),
        prisma.heartLossEvent.findMany({
          where: { userId: me.id, sourceDate: startOfDay },
          select: { id: true, kind: true, details: true, sourceDate: true },
        }).catch(() => []),
      ]);

      // Levels: read-only from user. XP-to-next-level uses the same
      // formula as the rest of the app.
      const user = await prisma.user.findUnique({
        where: { id: me.id },
        select: { level: true, xp: true, mode: true, hearts: true, heartsLastRegenAt: true },
      });

      return {
        date: targetDate,
        mode: user?.mode ?? 'CASUAL',
        level: user?.level ?? 1,
        xp: user?.xp ?? 0,
        hearts: user?.hearts ?? 5,
        // Missed dailies = not yet completed on the target date. User
        // can tap to mark them done (recovers from the missed-all-dailies
        // heart-loss trigger). Skipped dailies are NOT surfaced as
        // missed — those are legitimate opt-outs.
        dailies: dailiesForDate,
        recap: {
          workoutLogged: workouts.length > 0,
          workoutCount: workouts.length,
          workoutNames: workouts.map((w) => w.name ?? w.type).slice(0, 3),
          sleepHours: sleep?.value ?? null,
          weighInLogged: latestWeight
            ? latestWeight.recordedAt.getTime() >= startOfDay.getTime()
              && latestWeight.recordedAt.getTime() < endOfDay.getTime()
            : false,
          latestWeightKg: latestWeight?.value ?? null,
          recoveryScore: recovery?.score ?? null,
        },
        heartLoss,
      };
    } catch (err: any) {
      // Defensive: any failure here means the popup can't render,
      // but the rest of /today should still work. Return a sentinel
      // shape so the client can render the "Couldn't load morning
      // recap" fallback rather than 500ing the whole page.
      req.log.warn({ err: String(err?.message ?? err) }, 'morning-popup failed');
      return reply.code(500).send({
        error: 'morning-popup failed',
        message: err?.message ?? 'unknown',
      });
    }
  });

  // POST /dailies — create a user-defined daily
  app.post('/', async (req) => {
    const me = await requireUser(req);
    const body = createSchema.parse(req.body);
    const daily = await prisma.daily.create({
      data: {
        userId: me.id,
        name: body.name,
        days: body.days,
        notes: body.notes ?? null,
        goldReward: body.goldReward,
        xpReward: body.xpReward,
        category: body.category,
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return { daily };
  });

  // PATCH /dailies/:id — update fields
  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const body = updateSchema.parse(req.body);
    const existing = await prisma.daily.findUnique({ where: { id } });
    if (!existing || existing.userId !== me.id) {
      return reply.code(404).send({ error: 'Daily not found' });
    }
    const daily = await prisma.daily.update({ where: { id }, data: body });
    return { daily };
  });

  // DELETE /dailies/:id — archive
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const existing = await prisma.daily.findUnique({ where: { id } });
    if (!existing || existing.userId !== me.id) {
      return reply.code(404).send({ error: 'Daily not found' });
    }
    await prisma.daily.update({ where: { id }, data: { archived: true } });
    return { ok: true };
  });

  // POST /dailies/:id/complete — mark a daily complete (idempotent per day).
  // For user dailies, id is the Daily.id. For built-ins, id can be
  // 'WORKOUT' (manual override; usually auto-completes from workout log)
  // or 'SPIRITUAL:<PrayerType>' (manual after prayer log on /spiritual).
  app.post<{ Params: { id: string } }>('/:id/complete', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    // Idempotency lower bound = local midnight in the user's tz.
    // Was previously `new Date(); .setHours(0,0,0,0)` which is the
    // server's local midnight (UTC in Docker) — a NYC user could
    // complete the same daily twice in the 4h between UTC midnight
    // and local midnight the next day.
    const tz = me.timezone ?? null;
    const today = localMidnightUtc(todayInTz(tz), tz ?? 'UTC');

    // Resolve to a Daily row + dailyKey. Built-ins don't have rows but
    // we still log them via the synthetic dailyKey.
    let daily = null as null | { id: string; goldReward: number; xpReward: number; userId: string };
    let dailyKey = id;
    if (id === 'WORKOUT') {
      dailyKey = 'WORKOUT';
    } else if (id.startsWith('SPIRITUAL:')) {
      dailyKey = id;
    } else {
      daily = await prisma.daily.findUnique({ where: { id } });
      if (!daily || daily.userId !== me.id) {
        return reply.code(404).send({ error: 'Daily not found' });
      }
    }

    // Idempotency: only one log per dailyKey per day
    const existing = await prisma.dailyLog.findFirst({
      where: { userId: me.id, dailyKey, loggedAt: { gte: today } },
    });
    if (existing) return { ok: true, alreadyDone: true };

    // For non-built-ins, dailyId must point at the real row. For built-ins
    // we have to attach to *some* Daily row to satisfy the FK; use the
    // first user-defined daily if one exists, else fail with a friendly
    // message asking the user to create one.
    let dailyId: string;
    if (daily) {
      dailyId = daily.id;
    } else {
      const fallback = await prisma.daily.findFirst({
        where: { userId: me.id, archived: false },
        orderBy: { createdAt: 'asc' },
      });
      if (!fallback) {
        return reply.code(409).send({
          error:
            'Built-in dailies need at least one user daily in the database to satisfy the FK. Create any daily (e.g. "Drink water") first, then you can complete built-ins.',
        });
      }
      dailyId = fallback.id;
    }

    const goldDelta = daily?.goldReward ?? 0;
    const xpDelta = daily?.xpReward ?? 0;

    const log = await prisma.dailyLog.create({
      data: {
        userId: me.id,
        dailyId,
        dailyKey,
        goldDelta,
        xpDelta,
      },
    });

    if (goldDelta || xpDelta) {
      await prisma.user.update({
        where: { id: me.id },
        data: { gold: { increment: goldDelta }, xp: { increment: xpDelta } },
      });
    }

    await checkAchievements(me.id);

    // Home-base penance for completed prayers (SPIRITUAL:* built-ins).
    // The "completed_prayer" penance fires +4 — small but steady
    // recovery. Skipped automatically when the template is disabled.
    if (dailyKey.startsWith('SPIRITUAL:')) {
      const { firePenance } = await import('../lib/penance.js');
      await firePenance(me.id, 'completed_prayer', 'daily_completed');
    }

    return { log, goldDelta, xpDelta };
  });
}

function prayerLabel(p: string): string {
  switch (p) {
    case 'ROSARY': return 'Daily Rosary';
    case 'MASS': return 'Daily Mass';
    case 'SCRIPTURE': return 'Scripture Reading';
    case 'CONTEMPLATION': return 'Contemplation';
    case 'LITURGY_HOURS': return 'Liturgy of the Hours';
    case 'CONFESSION': return 'Confession';
    case 'OTHER': return 'Other Prayer';
    default: return p;
  }
}