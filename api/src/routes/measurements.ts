import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MetricType } from '@prisma/client';
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

const CreateSchema = z.object({
  metric: z.nativeEnum(MetricType),
  value: z.number().positive().max(10000),
  unit: z.string().max(16).optional(),
  notes: z.string().max(500).optional(),
  recordedAt: z.string().datetime().optional(),
});

const UpdateSchema = CreateSchema.partial().extend({ id: z.string() });

export async function measurementRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const q = z.object({
      metric: z.nativeEnum(MetricType).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }).parse(req.query);
    const where: any = { userId: me.id };
    if (q.metric) where.metric = q.metric;
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
      },
    });
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
    }).parse(req.body);
    const m = await prisma.measurement.create({
      data: {
        userId: me.id,
        metric: 'WEIGHT',
        value: body.value,
        unit: 'kg',
        notes: body.notes,
        recordedAt: new Date(),
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
      'SLEEP_HOURS', 'SLEEP_QUALITY',
      'CALORIES', 'PROTEIN_G', 'WATER_ML',
      'MOOD', 'ENERGY', 'SORENESS', 'STRESS',
    ];
    const status = await getTodayHabitStatus(me.id, metrics);
    return { status };
  });
}
