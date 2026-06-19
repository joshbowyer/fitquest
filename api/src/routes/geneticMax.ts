import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GeneticMaxSource, MetricType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { computeGeneticMax, computeAllGeneticMaxes } from '../lib/geneticMax.js';

const SetSchema = z.object({
  metric: z.nativeEnum(MetricType),
  value: z.number().positive().max(10000),
  source: z.nativeEnum(GeneticMaxSource).default('MANUAL'),
  notes: z.string().max(500).optional(),
});

const SetManySchema = z.object({
  items: z.array(SetSchema),
});

export async function geneticMaxRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const items = await prisma.geneticMax.findMany({ where: { userId: me.id } });
    return { items };
  });

  // Recompute formula-based maxes from current user body metrics
  app.post('/recompute', async (req) => {
    const me = await requireUser(req);
    const fresh = await prisma.user.findUnique({ where: { id: me.id } });
    if (!fresh) return { error: 'No user' };
    const formulas = computeAllGeneticMaxes({
      heightCm: fresh.heightCm,
      wristCm: fresh.wristCm,
      ankleCm: fresh.ankleCm,
      weightKg: fresh.weightKg,
      bodyFatPct: fresh.bodyFatPct,
      birthDate: fresh.birthDate,
    });
    const existing = await prisma.geneticMax.findMany({ where: { userId: me.id } });
    const byMetric = new Map(existing.map((e) => [e.metric, e]));
    const manual = new Set(existing.filter((e) => e.source === 'MANUAL').map((e) => e.metric));
    const updated: string[] = [];
    const changes: Array<{ metric: string; from: number | null; to: number }> = [];
    const removed: string[] = [];
    for (const [metric, value] of Object.entries(formulas)) {
      if (value == null) {
        // Formula no longer applies (e.g., we removed a metric from
        // Genetic Maxes). Drop any non-MANUAL row for it.
        const existing = byMetric.get(metric as any);
        if (existing && existing.source !== 'MANUAL') {
          await prisma.geneticMax.deleteMany({
            where: { userId: me.id, metric: metric as any, source: { not: 'MANUAL' } },
          });
          removed.push(metric);
          changes.push({ metric, from: existing.value, to: 0 });
        }
        continue;
      }
      if (manual.has(metric as any)) continue;
      const prev = byMetric.get(metric as any)?.value ?? null;
      await prisma.geneticMax.upsert({
        where: { userId_metric: { userId: me.id, metric: metric as any } },
        create: { userId: me.id, metric: metric as any, value, source: 'FORMULA' },
        update: { value, source: 'FORMULA' },
      });
      updated.push(metric);
      if (prev == null || Math.abs(prev - value) > 0.01) {
        changes.push({ metric, from: prev, to: value });
      }
    }
    return {
      ok: true,
      updated,
      skipped: Array.from(manual),
      removed,
      changes,
    };
  });

  app.post('/preview', async (req) => {
    const me = await requireUser(req);
    const body = z.object({
      metric: z.nativeEnum(MetricType),
    }).parse(req.body);
    const fresh = await prisma.user.findUnique({ where: { id: me.id } });
    if (!fresh) return { error: 'No user' };
    const value = computeGeneticMax(body.metric, {
      heightCm: fresh.heightCm,
      wristCm: fresh.wristCm,
      ankleCm: fresh.ankleCm,
      weightKg: fresh.weightKg,
      bodyFatPct: fresh.bodyFatPct,
      birthDate: fresh.birthDate,
    });
    return { value };
  });

  app.put('/', async (req) => {
    const me = await requireUser(req);
    const body = SetManySchema.parse(req.body);
    for (const item of body.items) {
      await prisma.geneticMax.upsert({
        where: { userId_metric: { userId: me.id, metric: item.metric } },
        create: { userId: me.id, metric: item.metric, value: item.value, source: item.source, notes: item.notes },
        update: { value: item.value, source: item.source, notes: item.notes },
      });
    }
    return { ok: true };
  });

  app.delete('/:metric', async (req) => {
    const me = await requireUser(req);
    const metric = (req.params as any).metric as MetricType;
    await prisma.geneticMax.deleteMany({ where: { userId: me.id, metric } });
    return { ok: true };
  });
}
