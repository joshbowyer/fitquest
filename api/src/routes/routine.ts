import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DayOfWeek } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { todayInTz, localMidnightUtc } from '../lib/timezone.js';

const patchSchema = z.object({
  weeklyGoal: z.number().int().min(1).max(14).optional(),
});

const dayUpdateSchema = z.object({
  day: z.nativeEnum(DayOfWeek),
  workout: z.boolean(),
  notes: z.string().max(200).optional().nullable(),
});

// The user's LOCAL week containing `date`: Monday-anchored.
// Returns the UTC instants of local Monday-midnight → next local
// Monday-midnight (for performedAt range queries) plus the local
// Monday date-string (the week's identity key).
//
// Was previously computed with getUTCDay()/setUTCHours — the
// SERVER's UTC week — so e.g. a Chicago user's Sunday-8pm workout
// (Monday 01:00 UTC) counted toward NEXT week, silently breaking
// streaks that were complete in the user's own frame. (The
// morning report's MISSED_WORKOUT trigger already used tz-local
// days, so the two systems disagreed about the same workout.)
function localWeekOf(date: Date, tz: string | null): { start: Date; end: Date; weekKey: string } {
  const localDate = todayInTz(tz, date);
  const d = new Date(`${localDate}T00:00:00Z`);
  const daysFromMonday = (d.getUTCDay() + 6) % 7; // 0=Mon ... 6=Sun
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  const weekKey = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 7);
  const nextKey = d.toISOString().slice(0, 10);
  return {
    start: localMidnightUtc(weekKey, tz ?? 'UTC'),
    end: localMidnightUtc(nextKey, tz ?? 'UTC'),
    weekKey,
  };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/// Whole weeks between two YYYY-MM-DD Monday keys, in date-space
/// (never mixes tz-offset instants with date-string parses).
function weeksBetweenKeys(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / WEEK_MS);
}

export async function routineRoutes(app: FastifyInstance) {
  // GET /routine — current streak, weekly goal, this-week progress
  app.get('/', async (req) => {
    const me = await requireUser(req);

    let routine = await prisma.routine.findUnique({ where: { userId: me.id } });
    if (!routine) {
      routine = await prisma.routine.create({
        data: { userId: me.id, weeklyGoal: 3 },
      });
    }

    const week = localWeekOf(new Date(), me.timezone ?? null);

    const thisWeekWorkouts = await prisma.workout.count({
      where: {
        userId: me.id,
        performedAt: { gte: week.start, lt: week.end },
      },
    });

    // Streak bonus: how much extra XP/gold the user is getting
    // from their streak right now. Formula:
    //   bonus = 1 + min(0.5, 0.05 * currentStreak)
    // So streak 1 → 1.05x, streak 5 → 1.25x, streak 10 → 1.5x (cap).
    const streakBonus = Math.min(1.5, 1 + 0.05 * routine.currentStreak);

    // Detect streak reset: if the user missed last week and the
    // streak is still non-zero, the streak should have reset.
    // We compute it lazily: if lastCompletedWeek is more than one
    // week behind, currentStreak is effectively 0.
    let effectiveStreak = routine.currentStreak;
    if (routine.lastCompletedWeek) {
      const weeksBehind = weeksBetweenKeys(routine.lastCompletedWeek, week.weekKey);
      if (weeksBehind >= 2) {
        effectiveStreak = 0;
        // Lazily reset in the DB
        await prisma.routine.update({
          where: { userId: me.id },
          data: { currentStreak: 0 },
        });
      }
    }

    // weekStart/weekEnd are LOCAL date strings (Mon..Sun of the
    // user's week), not UTC-instant slices.
    const weekEndKey = (() => {
      const d = new Date(`${week.weekKey}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 6);
      return d.toISOString().slice(0, 10);
    })();
    return {
      weeklyGoal: routine.weeklyGoal,
      thisWeekCount: thisWeekWorkouts,
      thisWeekCleared: thisWeekWorkouts >= routine.weeklyGoal,
      weekStart: week.weekKey,
      weekEnd: weekEndKey,
      currentStreak: effectiveStreak,
      longestStreak: routine.longestStreak,
      lastCompletedWeek: routine.lastCompletedWeek,
      streakBonus, // multiplier applied to XP/gold/damage right now
      progress: Math.min(1, thisWeekWorkouts / routine.weeklyGoal),
    };
  });

  // PATCH /routine — update weekly goal
  app.patch('/', async (req) => {
    const me = await requireUser(req);
    const body = patchSchema.parse(req.body);

    const routine = await prisma.routine.upsert({
      where: { userId: me.id },
      create: { userId: me.id, weeklyGoal: body.weeklyGoal ?? 3 },
      update: { weeklyGoal: body.weeklyGoal },
    });
    return { weeklyGoal: routine.weeklyGoal };
  });

  // GET /routine/days — per-day-of-week schedule (Sun-Sat)
  app.get('/days', async (req) => {
    const me = await requireUser(req);
    const rows = await prisma.routineDay.findMany({ where: { userId: me.id } });
    // Ensure all 7 days are present (default workout=false) so the
    // frontend can render the full week even on a fresh account.
    const allDays: Array<DayOfWeek> = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const map = new Map(rows.map((r) => [r.day, r]));
    return {
      days: allDays.map((d) => ({
        day: d,
        workout: map.get(d)?.workout ?? false,
        notes: map.get(d)?.notes ?? null,
      })),
    };
  });

  // PUT /routine/days — replace the full schedule (idempotent upsert).
  app.put('/days', async (req) => {
    const me = await requireUser(req);
    const body = z.object({
      days: z.array(dayUpdateSchema),
    }).parse(req.body);
    for (const d of body.days) {
      await prisma.routineDay.upsert({
        where: { userId_day: { userId: me.id, day: d.day } },
        create: {
          userId: me.id,
          day: d.day,
          workout: d.workout,
          notes: d.notes ?? null,
        },
        update: {
          workout: d.workout,
          notes: d.notes ?? null,
        },
      });
    }
    return { ok: true };
  });
}

/**
 * Called after a workout save. If the user hit their weekly goal,
 * bump the streak. Returns info about what changed (used by the
 * workout response).
 */
export async function checkRoutineProgress(userId: string): Promise<{
  streakIncremented: boolean;
  newStreak: number;
  crossedGoalThisWeek: boolean;
}> {
  const routine = await prisma.routine.upsert({
    where: { userId },
    create: { userId, weeklyGoal: 3 },
    update: {},
  });

  // Week boundaries in the USER's timezone (see localWeekOf).
  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const week = localWeekOf(new Date(), userRow?.timezone ?? null);

  const thisWeekCount = await prisma.workout.count({
    where: { userId, performedAt: { gte: week.start, lt: week.end } },
  });

  const cleared = thisWeekCount >= routine.weeklyGoal;
  const weekKey = week.weekKey;

  let newStreak = routine.currentStreak;
  let incremented = false;
  let crossedThisWeek = false;

  if (cleared) {
    if (routine.lastCompletedWeek === weekKey) {
      // Already counted this week — nothing to do.
    } else if (routine.lastCompletedWeek) {
      // Check if lastCompletedWeek was last week (consecutive)
      const weeksAhead = weeksBetweenKeys(routine.lastCompletedWeek, weekKey);
      if (weeksAhead === 1) {
        newStreak = routine.currentStreak + 1;
        incremented = true;
      } else if (weeksAhead > 1) {
        newStreak = 1; // Reset, this is the first new week
        incremented = true;
      }
    } else {
      newStreak = 1;
      incremented = true;
      crossedThisWeek = true;
    }

    if (incremented || crossedThisWeek) {
      await prisma.routine.update({
        where: { userId },
        data: {
          currentStreak: newStreak,
          longestStreak: Math.max(routine.longestStreak, newStreak),
          lastCompletedWeek: weekKey,
          streakUpdatedAt: new Date(),
        },
      });
    }
  }

  return {
    streakIncremented: incremented || crossedThisWeek,
    newStreak,
    crossedGoalThisWeek: cleared && routine.lastCompletedWeek !== weekKey,
  };
}