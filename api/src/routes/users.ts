import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ClassName } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { computeAllGeneticMaxes } from '../lib/geneticMax.js';
import { levelFromXp, progressInLevel } from '../lib/xp.js';

const ProfileSchema = z.object({
  class: z.nativeEnum(ClassName).optional(),
  units: z.enum(['METRIC', 'IMPERIAL']).optional(),
  heightCm: z.number().positive().max(260).optional().nullable(),
  wristCm: z.number().positive().max(30).optional().nullable(),
  ankleCm: z.number().positive().max(30).optional().nullable(),
  weightKg: z.number().positive().max(300).optional().nullable(),
  bodyFatPct: z.number().min(2).max(60).optional().nullable(),
  birthDate: z.string().datetime().optional().nullable(),
});

export async function userRoutes(app: FastifyInstance) {
  app.get('/me', async (req) => {
    const user = await requireUser(req);
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      level: user.level,
      xp: user.xp,
      gold: user.gold,
      class: user.class,
      units: user.units,
      heightCm: user.heightCm,
      wristCm: user.wristCm,
      ankleCm: user.ankleCm,
      weightKg: user.weightKg,
      bodyFatPct: user.bodyFatPct,
      birthDate: user.birthDate,
      createdAt: user.createdAt,
      progress: progressInLevel(user.xp, user.level),
    };
  });

  app.patch('/me', async (req) => {
    const me = await requireUser(req);
    const body = ProfileSchema.parse(req.body);
    const updated = await prisma.user.update({
      where: { id: me.id },
      data: {
        class: body.class ?? undefined,
        units: (body as any).units ?? undefined,
        heightCm: body.heightCm === undefined ? undefined : body.heightCm,
        wristCm: body.wristCm === undefined ? undefined : body.wristCm,
        ankleCm: body.ankleCm === undefined ? undefined : body.ankleCm,
        weightKg: body.weightKg === undefined ? undefined : body.weightKg,
        bodyFatPct: body.bodyFatPct === undefined ? undefined : body.bodyFatPct,
        birthDate: body.birthDate === undefined ? undefined : (body.birthDate ? new Date(body.birthDate) : null),
      },
    });

    // Re-compute formula-based genetic maxes (skip those with MANUAL source).
    const formulas = computeAllGeneticMaxes({
      heightCm: updated.heightCm,
      wristCm: updated.wristCm,
      ankleCm: updated.ankleCm,
      weightKg: updated.weightKg,
      bodyFatPct: updated.bodyFatPct,
      birthDate: updated.birthDate,
    });
    const existing = await prisma.geneticMax.findMany({ where: { userId: updated.id } });
    const manual = new Map(existing.filter((e) => e.source === 'MANUAL').map((e) => [e.metric, e.value]));
    for (const [metric, value] of Object.entries(formulas)) {
      if (value == null) continue;
      if (manual.has(metric as any)) continue; // respect manual overrides
      await prisma.geneticMax.upsert({
        where: { userId_metric: { userId: updated.id, metric: metric as any } },
        create: { userId: updated.id, metric: metric as any, value, source: 'FORMULA' },
        update: { value, source: 'FORMULA' },
      });
    }

    return { ok: true };
  });

  app.get('/me/stats', async (req) => {
    const me = await requireUser(req);
    return {
      level: me.level,
      xp: me.xp,
      gold: me.gold,
      progress: progressInLevel(me.xp, me.level),
      nextLevel: levelFromXp(me.xp + 1) > me.level ? me.level + 1 : me.level,
    };
  });
}
