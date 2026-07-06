import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MetricType } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { METRICS } from '../lib/metrics.js';
import { checkAchievements } from '../lib/achievements.js';
import {
  getWeighInStreak,
  getWeighInToday,
  getWeightTrend,
  getWeighInDelta7d,
  getTodayHabitStatus,
} from '../lib/streaks.js';
import { todayInTz, localMidnightUtc } from '../lib/timezone.js';
import { MeasurementSource } from '../lib/prisma.js';

// Metrics that are derived from other data — not user-enterable.
// LEAN_MASS = weight × (1 - bf%); FFMI = lean mass / height² (with
// a height adjustment). Reject attempts to log these directly.
const DERIVED_METRICS: string[] = ['LEAN_MASS', 'FFMI'];

const CreateSchema = z.object({
  metric: z.nativeEnum(MetricType).refine(
    (m) => !DERIVED_METRICS.includes(m),
    { message: 'LEAN_MASS and FFMI are auto-calculated — see the Status panel' },
  ),
  value: z.number().positive().max(10000),
  unit: z.string().max(16).optional(),
  notes: z.string().max(500).optional(),
  recordedAt: z.string().datetime().optional(),
  /// Method used to record a body-fat or weight reading. Optional
  /// for backward compat (legacy clients always omit it). When set,
  /// the morning report's body-comp insight weighs by source
  /// confidence — DEXA/BOD_POD get full weight, calipers/BIA get
  /// partial, VISUAL/MANUAL get low confidence. See
  /// api/src/lib/measurementSource.ts for the confidence map.
  source: z.nativeEnum(MeasurementSource).optional(),
});

const UpdateSchema = CreateSchema.partial().extend({ id: z.string() });

export async function measurementRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const q = z.object({
      metric: z.nativeEnum(MetricType).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      // Optional: only return measurements within the last N days.
      // Used by the /insights overlay chart to fetch 30/60/90 day windows.
      days: z.coerce.number().int().min(1).max(365).optional(),
    }).parse(req.query);
    const where: any = { userId: me.id };
    if (q.metric) where.metric = q.metric;
    if (q.days) {
      // days=1 is the "today" case (used by the daily totals bar
      // for water + the water intake panel). Naive `now - 1 day`
      // leaks yesterday's late-evening entries (e.g. water at 6pm
      // yesterday still shows up at 10am today), which is the bug
      // we just fixed. For days=1, snap the lower bound to local
      // midnight in the user's timezone; for days>1, the loose
      // "last N days" window is fine and matches what the
      // /insights chart wants.
      const since = q.days === 1
        ? localMidnightUtc(todayInTz(me.timezone ?? null), me.timezone ?? 'UTC')
        : new Date(Date.now() - q.days * 24 * 60 * 60 * 1000);
      where.recordedAt = { gte: since };
    }
    // Newest-first so existing callers (MetricTrendChart, MetricDetailModal)
    // can read items[0] as the latest. Callers that need chronological
    // order (e.g. the /insights overlay) reverse client-side.
    const items = await prisma.measurement.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      take: q.limit,
    });
    return { items };
  });

  app.get('/latest', async (req) => {
    const me = await requireUser(req);
    const all = await prisma.measurement.findMany({
      where: { userId: me.id },
      orderBy: { recordedAt: 'desc' },
    });
    const latestByMetric = new Map<string, typeof all[number]>();
    for (const m of all) {
      if (!latestByMetric.has(m.metric)) latestByMetric.set(m.metric, m);
    }
    return { items: Array.from(latestByMetric.values()) };
  });

  app.post('/', async (req) => {
    const me = await requireUser(req);
    const body = CreateSchema.parse(req.body);
    const m = await prisma.measurement.create({
      data: {
        userId: me.id,
        metric: body.metric,
        value: body.value,
        unit: body.unit ?? METRICS[body.metric].unit,
        notes: body.notes,
        recordedAt: body.recordedAt ? new Date(body.recordedAt) : new Date(),
        // Default to UNKNOWN if the client didn't specify — preserves
        // the existing row shape and the morning-report's confidence
        // logic treats UNKNOWN as low.
        source: body.source ?? MeasurementSource.UNKNOWN,
      },
    });
    // Fire a checkin_* penance based on the metric's cadence bucket.
    // skip-cadence metrics (derived, e.g. LEAN_MASS) don't get a
    // penance since the user didn't actually log them. Best-effort —
    // an error here doesn't fail the measurement insert.
    try {
      const { DEFAULT_CADENCE } = await import('../lib/checkIns.js');
      const cadence = DEFAULT_CADENCE[body.metric as keyof typeof DEFAULT_CADENCE];
      if (cadence === 'AM' || cadence === 'PM' || cadence === 'WEEKLY') {
        const { firePenance } = await import('../lib/penance.js');
        await firePenance(me.id, `checkin_${cadence.toLowerCase()}` as any, 'auto_decay');
      }
    } catch (err) {
      console.warn('[measurements] checkin penance fire failed', err);
    }
    await checkAchievements(me.id);
    return { item: m };
  });

  app.patch('/:id', async (req) => {
    const me = await requireUser(req);
    const body = UpdateSchema.parse({ ...(req.body as any), id: (req.params as any).id });
    const existing = await prisma.measurement.findFirst({
      where: { id: body.id, userId: me.id },
    });
    if (!existing) return { error: 'Not found' };
    const m = await prisma.measurement.update({
      where: { id: body.id },
      data: {
        metric: body.metric,
        value: body.value,
        unit: body.unit,
        notes: body.notes,
        recordedAt: body.recordedAt ? new Date(body.recordedAt) : undefined,
      },
    });
    return { item: m };
  });

  app.delete('/:id', async (req) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const existing = await prisma.measurement.findFirst({ where: { id, userId: me.id } });
    if (!existing) return { error: 'Not found' };
    await prisma.measurement.delete({ where: { id } });
    return { ok: true };
  });

  // ---- Daily weigh-in shortcuts -----------------------------------------

  app.get('/weigh-in/status', async (req) => {
    const me = await requireUser(req);
    const [today, streak] = await Promise.all([
      getWeighInToday(me.id),
      getWeighInStreak(me.id),
    ]);
    return { today, streak };
  });

  app.get('/weigh-in/trend', async (req) => {
    const me = await requireUser(req);
    const q = z.object({ days: z.coerce.number().int().min(2).max(90).default(7) }).parse(req.query);
    const [series, delta7d] = await Promise.all([
      getWeightTrend(me.id, q.days),
      getWeighInDelta7d(me.id),
    ]);
    return { series, delta7d };
  });

  app.post('/weigh-in', async (req) => {
    const me = await requireUser(req);
    const body = z.object({
      value: z.number().positive().max(500),
      notes: z.string().max(500).optional(),
      // Optional ISO timestamp; defaults to "now". Used by the
      // Endurain export importer to backdate weigh-ins from a
      // bulk CSV (otherwise they'd all collapse onto today and
      // wreck the trend chart).
      recordedAt: z.string().datetime().optional(),
    }).parse(req.body);
    const m = await prisma.measurement.create({
      data: {
        userId: me.id,
        metric: 'WEIGHT',
        value: body.value,
        unit: 'kg',
        notes: body.notes,
        recordedAt: body.recordedAt ? new Date(body.recordedAt) : new Date(),
      },
    });
    const [today, streak] = await Promise.all([
      getWeighInToday(me.id),
      getWeighInStreak(me.id),
    ]);
    const unlocked = await checkAchievements(me.id);
    return { measurement: m, today, streak, unlocked };
  });

  // ---- Batch habit log -------------------------------------------------

  const BatchItem = z.object({
    metric: z.nativeEnum(MetricType),
    value: z.number().min(0).max(10000),
    notes: z.string().max(500).optional(),
  });

  app.post('/batch', async (req) => {
    const me = await requireUser(req);
    const body = z.object({
      items: z.array(BatchItem).min(1).max(20),
      date: z.string().datetime().optional(), // defaults to now
    }).parse(req.body);
    const recordedAt = body.date ? new Date(body.date) : new Date();
    const created = await prisma.$transaction(
      body.items.map((it) =>
        prisma.measurement.create({
          data: {
            userId: me.id,
            metric: it.metric,
            value: it.value,
            unit: METRICS[it.metric].unit,
            notes: it.notes,
            recordedAt,
          },
        })
      )
    );
    const unlocked = await checkAchievements(me.id);
    return { items: created, unlocked };
  });

  app.get('/habits/today', async (req) => {
    const me = await requireUser(req);
    const q = z.object({
      metrics: z.string().optional(), // comma-separated MetricType
    }).parse(req.query);
    const metrics = q.metrics ? q.metrics.split(',') : [
      // Default habit metrics shown on /today and the dashboard
      // check-in panel. WEIGHT is included so a weigh-in via the
      // dashboard's Daily Weigh-In block shows up on the Today
      // page without a separate refresh.
      'SLEEP_HOURS', 'SLEEP_QUALITY',
      'CALORIES', 'PROTEIN_G', 'WATER_ML',
      'MOOD', 'ENERGY', 'SORENESS', 'STRESS',
      'WEIGHT',
    ];
    const status = await getTodayHabitStatus(me.id, metrics);
    return { status };
  });
}
