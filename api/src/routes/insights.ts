import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { computeRecovery } from '../lib/recovery.js';
import { computeCorrelations } from '../lib/correlations.js';
import { generateInsights, getInsightsSummary } from '../lib/insights.js';

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
    return { items: await computeCorrelations(me.id) };
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
    const weeks = 12;
    const since = new Date();
    since.setDate(since.getDate() - weeks * 7);

    const workouts = await prisma.workout.findMany({
      where: { userId: me.id, performedAt: { gte: since } },
      select: {
        performedAt: true,
        duration: true,
        exercises: {
          select: {
            sets: {
              where: { completed: true, skipped: false },
              select: { weight: true, reps: true },
            },
          },
        },
      },
    });

    // Bucket by ISO week (Monday-start). Pad to 12 weeks so the chart
    // shows empty weeks for periods of no training.
    const buckets: Record<string, { volume: number; sessions: number; minutes: number }> = {};
    for (let i = 0; i < weeks; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i * 7);
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      monday.setHours(0, 0, 0, 0);
      buckets[monday.toISOString().slice(0, 10)] = { volume: 0, sessions: 0, minutes: 0 };
    }
    for (const w of workouts) {
      const monday = new Date(w.performedAt);
      monday.setDate(w.performedAt.getDate() - ((w.performedAt.getDay() + 6) % 7));
      monday.setHours(0, 0, 0, 0);
      const key = monday.toISOString().slice(0, 10);
      if (!buckets[key]) continue;
      const vol = w.exercises.reduce(
        (s, ex) =>
          s + ex.sets.reduce((ss, st) => ss + (st.weight ?? 0) * (st.reps ?? 0), 0),
        0,
      );
      buckets[key].volume += vol;
      buckets[key].sessions += 1;
      buckets[key].minutes += Math.round((w.duration ?? 0) / 60);
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
