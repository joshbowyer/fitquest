import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DayOfWeek, DailyCategory } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { checkAchievements } from '../lib/achievements.js';

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
function todayDay(): DayOfWeek {
  return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date().getDay()] as DayOfWeek;
}

// Built-in daily IDs. We synthesize these on-the-fly rather than
// persisting them as Daily rows, so user edits to schedule/notes don't
// blow them away. dailyKey is the stable identifier across days.
const BUILTIN_KEYS = ['WORKOUT'] as const;

function buildBuiltins(opts: {
  routineDays: Array<{ day: DayOfWeek; workout: boolean; notes: string | null }>;
}): Array<{
  id: string;
  name: string;
  category: 'WORKOUT';
  days: DayOfWeek[];
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
  app.get('/today', async (req) => {
    const me = await requireUser(req);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const tomorrow = new Date(startOfDay);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const today = todayDay();

    const [userDailies, routineDays, todayLogs, recentWorkout] = await Promise.all([
      prisma.daily.findMany({
        // Only dailies the user has marked as "show on /today".
        // Custom practices with isDaily=false are still loggable
        // (visible in the prayer picker on /spiritual) but don't
        // auto-appear in the daily checklist. This mirrors the
        // built-in PrayerType toggle on User.spiritualDailyPrayers.
        where: { userId: me.id, archived: false, isDaily: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.routineDay.findMany({ where: { userId: me.id } }),
      prisma.dailyLog.findMany({
        where: { userId: me.id, loggedAt: { gte: startOfDay, lt: tomorrow } },
      }),
      prisma.workout.count({
        where: { userId: me.id, performedAt: { gte: startOfDay, lt: tomorrow } },
      }),
    ]);

    // Filter user dailies to ones due today (empty days[] = every day)
    const dueUserDailies = userDailies.filter(
      (d) => d.days.length === 0 || d.days.includes(today),
    );

    // Logged keys for fast lookup
    const loggedKeys = new Set(todayLogs.map((l) => l.dailyKey));
    const userDailiesCompleted = dueUserDailies.filter((d) => loggedKeys.has(d.id)).length;

    // Built-in: WORKOUT (auto-completes if a workout was logged today)
    const workoutDayRow = routineDays.find((r) => r.day === today);
    const isWorkoutDay = workoutDayRow?.workout ?? false;
    const builtins = buildBuiltins({ routineDays }).map((b) => ({
      ...b,
      todayDone: b.id === 'WORKOUT' ? recentWorkout > 0 : loggedKeys.has(b.id),
    }));

    // Built-in: SPIRITUAL dailies (prayers the user committed to)
    const spiritualDailies = (me.spiritualDailyPrayers ?? []).map((p) => ({
      id: `SPIRITUAL:${p}`,
      name: prayerLabel(p),
      category: 'SPIRITUAL' as const,
      days: [today] as DayOfWeek[],
      notes: null,
      goldReward: 0,
      xpReward: 0,
      sortOrder: -50,
      todayDone: loggedKeys.has(`SPIRITUAL:${p}`),
      prayerType: p,
    }));

    // Look up the logged dailyIds for user-dailies too
    const userDailiesWithStatus = dueUserDailies.map((d) => ({
      ...d,
      todayDone: loggedKeys.has(d.id),
    }));

    return {
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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