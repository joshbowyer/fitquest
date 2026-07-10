import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { computeRecovery } from '../lib/recovery.js';
import {
  computeCorrelations,
  snapshotCorrelations,
  fetchCorrelationHistory,
} from '../lib/correlations.js';
import { generateInsights, getInsightsSummary } from '../lib/insights.js';
import { setVolumeKg } from '../lib/exerciseVolume.js';
import { todayInTz, localMidnightUtc, localDayKey } from '../lib/timezone.js';

export async function insightRoutes(app: FastifyInstance) {
  app.get('/summary', async (req) => {
    const me = await requireUser(req);
    return getInsightsSummary(me.id);
  });

  app.get('/recovery', async (req) => {
    const me = await requireUser(req);
    return computeRecovery(me.id);
  });

  app.get('/correlations', async (req) => {
    const me = await requireUser(req);
    // Support ?lag=N to override the lag set when the user toggles
    // the lag badge in the UI; default to all three (0/1/2 days)
    // so the first render shows the full picture.
    const q = req.query as { lag?: string };
    const lags = q.lag != null ? [Number(q.lag)] : [0, 1, 2];
    return { items: await computeCorrelations(me.id, { lags }) };
  });

  // Per-row trend history. Drives the 12-week sparkline next to
  // each correlation so the user can see whether a pattern is
  // strengthening, fading, or oscillating.
  app.get('/correlations/history', async (req) => {
    const me = await requireUser(req);
    const q = req.query as {
      habit?: string;
      outcome?: string;
      lookbackDays?: string;
      lagDays?: string;
      weeks?: string;
    };
    if (!q.habit || !q.outcome) {
      return { points: [] };
    }
    const points = await fetchCorrelationHistory(me.id, q.habit, q.outcome, {
      lookbackDays: q.lookbackDays ? Number(q.lookbackDays) : 60,
      lagDays: q.lagDays ? Number(q.lagDays) : 0,
      weeks: q.weeks ? Number(q.weeks) : 12,
    });
    return { points };
  });

  // Manual trigger for the nightly snapshot. Useful after a bulk
  // weigh-in import so the user doesn't have to wait for 03:30 to
  // see fresh correlations.
  app.post('/correlations/snapshot', async (req) => {
    const me = await requireUser(req);
    const result = await snapshotCorrelations(me.id);
    return result;
  });

  app.get('/tips', async (req) => {
    const me = await requireUser(req);
    return { items: await generateInsights(me.id) };
  });

  // Weekly volume + sessions for the deep-dive /insights page.
  // Aggregates the last 12 weeks. Used for the "weekly volume" and
  // "session count" overlay charts.
  app.get('/weekly-volume', async (req) => {
    const me = await requireUser(req);
    const meWithWeight = me.weightKg
      ? me
      : await prisma.user.findUnique({ where: { id: me.id }, select: { weightKg: true } });
    const userWeightKg = meWithWeight?.weightKg ?? 0;
    const weeks = 12;
    const since = new Date();
    since.setDate(since.getDate() - weeks * 7);

    const workouts = await prisma.workout.findMany({
      where: { userId: me.id, performedAt: { gte: since } },
      select: {
        performedAt: true,
        durationSec: true,
        exercises: {
          select: {
            name: true,
            sets: {
              where: { completed: true, skipped: false },
              select: { weight: true, reps: true },
            },
          },
        },
      },
    });

    // Bucket by ISO week (Monday-start) in the USER's tz. Was using
    // server-local (UTC) week boundaries + UTC bucket keys — for a
    // NYC user that misbucketed workouts near the local/UTC day
    // boundary and labelled weeks with UTC dates that didn't match
    // the user's wall clock.
    const tz = me.timezone ?? null;
    const mondayDateStrInTz = (at: Date): string => {
      // Get the local date of `at` in tz, then walk back to the
      // Monday of that week (still in tz) and return its YYYY-MM-DD.
      const localDate = localDayKey(at, tz);
      const midnight = localMidnightUtc(localDate, tz ?? 'UTC');
      const dow = midnight.getUTCDay(); // 0=Sun..6=Sat
      const daysBack = (dow + 6) % 7;
      const mondayInstant = new Date(midnight.getTime() - daysBack * 86400000);
      return localDayKey(mondayInstant, tz);
    };
    const buckets: Record<string, { volume: number; sessions: number; minutes: number }> = {};
    for (let i = 0; i < weeks; i++) {
      const d = new Date(Date.now() - i * 7 * 86400000);
      const key = mondayDateStrInTz(d);
      buckets[key] = { volume: 0, sessions: 0, minutes: 0 };
    }
    for (const w of workouts) {
      const key = mondayDateStrInTz(new Date(w.performedAt));
      if (!buckets[key]) continue;
      const vol = w.exercises.reduce(
        (s, ex) =>
          s + ex.sets.reduce((ss, st) => ss + setVolumeKg(st, ex.name, userWeightKg), 0),
        0,
      );
      buckets[key].volume += vol;
      buckets[key].sessions += 1;
      buckets[key].minutes += Math.round((w.durationSec ?? 0) / 60);
    }
    const items = Object.entries(buckets)
      .map(([week, v]) => ({ week, ...v }))
      .sort((a, b) => a.week.localeCompare(b.week));
    return { items, weeks };
  });

  // Anti-staleness diagnostics. Detects:
  //   - Lifts with no new 1RM in 4+ weeks (top 5 by current PR)
  //   - Conditioning gap (no cardio session in 14d if last 4w averaged 1+/wk)
  //   - 1RM stalls (3+ sessions at same load, no progression)
  //   - Body comp plateau (no weight change in 28d while training 3+/wk)
  app.get('/anti-staleness', async (req) => {
    const me = await requireUser(req);
    const flags: Array<{ kind: string; severity: 'info' | 'warning'; title: string; detail: string; }> = [];

    // Per-exercise 1RM age: find the top 5 lifts by current 1RM, then
    // check the days since the last new PR for each.
    const top = await prisma.pr.findMany({
      where: { userId: me.id, type: 'ONE_RM' },
      orderBy: { value: 'desc' },
      take: 5,
    });
    if (top.length > 0) {
      for (const pr of top) {
        // How many days since this PR was set?
        const daysAgo = Math.floor(
          (Date.now() - new Date(pr.achievedAt).getTime()) / (1000 * 60 * 60 * 24),
        );
        // How many times has the user trained this exercise since?
        const sincePr = new Date(pr.achievedAt);
        const sessions = await prisma.exercise.count({
          where: {
            name: pr.exercise,
            workout: { userId: me.id, performedAt: { gte: sincePr } },
          },
        });
        if (daysAgo >= 28 && sessions >= 4) {
          flags.push({
            kind: 'lift_plateau',
            severity: daysAgo >= 56 ? 'warning' : 'info',
            title: `${pr.exercise} hasn't moved in ${daysAgo} days`,
            detail: `You've trained this ${sessions} times since the last PR. Consider a deload week, pause reps, or a 5/3/1 wave.`,
          });
        }
      }
    }

    // Conditioning gap
    const cardio14 = await prisma.workout.count({
      where: {
        userId: me.id,
        type: 'CARDIO',
        performedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
      },
    });
    const cardioPrior = await prisma.workout.count({
      where: {
        userId: me.id,
        type: 'CARDIO',
        performedAt: {
          gte: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
          lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        },
      },
    });
    if (cardioPrior >= 4 && cardio14 === 0) {
      flags.push({
        kind: 'conditioning_gap',
        severity: 'warning',
        title: 'No cardio in 14 days',
        detail: `You averaged ${Math.round(cardioPrior / 2)} sessions/week before. A 20-30min Zone 2 walk would help HRV and recovery.`,
      });
    }

    // Body comp plateau: weight not changed in 28d with active training
    const w28 = await prisma.measurement.findMany({
      where: {
        userId: me.id,
        metric: 'WEIGHT',
        recordedAt: { gte: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { recordedAt: 'asc' },
    });
    const sessions28 = await prisma.workout.count({
      where: { userId: me.id, performedAt: { gte: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000) } },
    });
    if (w28.length >= 4 && sessions28 >= 8) {
      const min = Math.min(...w28.map((m) => m.value));
      const max = Math.max(...w28.map((m) => m.value));
      const drift = Math.abs(max - min);
      const units = me.units === 'IMPERIAL' ? 'lb' : 'kg';
      if (drift < (me.units === 'IMPERIAL' ? 1 : 0.5)) {
        flags.push({
          kind: 'bodycomp_plateau',
          severity: 'info',
          title: `Weight unchanged for 28d (${drift.toFixed(1)} ${units} drift)`,
          detail: sessions28 >= 12
            ? 'High training volume with no body-comp change. Recalibrate calories: +200 if bulking, -200 if cutting.'
            : 'Solid maintenance. If recomposition stalled, audit protein (target 1.6-2.2g/kg) and weekly volume per muscle.',
        });
      }
    }

    return { flags };
  });
}
