import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ClassName } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { computeAllGeneticMaxes } from '../lib/geneticMax.js';
import { levelFromXp, progressInLevel } from '../lib/xp.js';
import { assertCanChangeClass, getClassLockStatus } from '../lib/classLock.js';

const ProfileSchema = z.object({
  class: z.nativeEnum(ClassName).optional(),
  units: z.enum(['METRIC', 'IMPERIAL']).optional(),
  sex: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
  heightCm: z.number().positive().max(260).optional().nullable(),
  wristCm: z.number().positive().max(30).optional().nullable(),
  ankleCm: z.number().positive().max(30).optional().nullable(),
  forearmLengthCm: z.number().positive().max(60).optional().nullable(),
  neckCircCm: z.number().positive().max(80).optional().nullable(),
  weightKg: z.number().positive().max(300).optional().nullable(),
  bodyFatPct: z.number().min(2).max(60).optional().nullable(),
  birthDate: z.string().datetime().optional().nullable(),
  // "Ordained" reflects an IRL sacrament (Holy Orders), not a
  // game perk. The user sets it themselves from Profile → Identity
  // because only they know whether they've actually received it.
  // We don't prompt or surface it anywhere else.
  ordained: z.boolean().optional(),
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
      soulstones: user.soulstones,
      class: user.class,
      units: user.units,
      heightCm: user.heightCm,
      wristCm: user.wristCm,
      ankleCm: user.ankleCm,
      forearmLengthCm: user.forearmLengthCm,
      neckCircCm: user.neckCircCm,
      sex: user.sex,
      weightKg: user.weightKg,
      bodyFatPct: user.bodyFatPct,
      birthDate: user.birthDate,
      createdAt: user.createdAt,
      classChangedAt: user.classChangedAt,
      classLock: getClassLockStatus(user.class, user.classChangedAt, user.birthDate, user.soulstones),
      progress: progressInLevel(user.xp, user.level),
      ordained: user.ordained,
    };
  });

  app.patch('/me', async (req) => {
    const me = await requireUser(req);
    const body = ProfileSchema.parse(req.body);

    // Class lock check. If the user is mid-cooldown, allow the change
    // only if they have a Soulstone to spend. assertCanChangeClass
    // returns { useSoulstone: true } in that case.
    let soulstoneConsumed = false;
    if (body.class !== undefined && body.class !== me.class) {
      const verdict = assertCanChangeClass(me, body.class);
      soulstoneConsumed = verdict.useSoulstone;
    }

    const updated = await prisma.user.update({
      where: { id: me.id },
      data: {
        class: body.class ?? undefined,
        // Stamp classChangedAt only when the class actually changes. The
        // first pick counts as a change, so we also stamp when going
        // from null to a class. If a Soulstone was used, we still stamp
        // the change (so the next unlock is another year away).
        ...(body.class !== undefined && body.class !== me.class
          ? { classChangedAt: new Date() }
          : {}),
        // Decrement Soulstone if one was used.
        ...(soulstoneConsumed ? { soulstones: { decrement: 1 } } : {}),
        units: (body as any).units ?? undefined,
        sex: body.sex === undefined ? undefined : body.sex,
        heightCm: body.heightCm === undefined ? undefined : body.heightCm,
        wristCm: body.wristCm === undefined ? undefined : body.wristCm,
        ankleCm: body.ankleCm === undefined ? undefined : body.ankleCm,
        forearmLengthCm: body.forearmLengthCm === undefined ? undefined : body.forearmLengthCm,
        neckCircCm: body.neckCircCm === undefined ? undefined : body.neckCircCm,
        weightKg: body.weightKg === undefined ? undefined : body.weightKg,
        bodyFatPct: body.bodyFatPct === undefined ? undefined : body.bodyFatPct,
        birthDate: body.birthDate === undefined ? undefined : (body.birthDate ? new Date(body.birthDate) : null),
        // Stamp ordainedAt only on the true→false transition is a no-op;
        // the true→false transition is allowed but wipes the date so the
        // user can re-set later. We don't ever auto-ordain.
        ...(body.ordained !== undefined
          ? {
              ordained: body.ordained,
              // First time becoming ordained: stamp the date.
              ...(body.ordained === true && me.ordainedAt == null
                ? { ordainedAt: new Date() }
                : body.ordained === false
                ? { ordainedAt: null }
                : {}),
            }
          : {}),
      },
    });

    // Re-compute formula-based genetic maxes (skip those with MANUAL source).
    const formulas = computeAllGeneticMaxes({
      sex: updated.sex,
      heightCm: updated.heightCm,
      wristCm: updated.wristCm,
      ankleCm: updated.ankleCm,
      forearmLengthCm: updated.forearmLengthCm,
      neckCircCm: updated.neckCircCm,
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

    return { ok: true, soulstoneConsumed, soulstones: updated.soulstones };
  });

  app.get('/me/stats', async (req) => {
    const me = await requireUser(req);
    return {
      level: me.level,
      xp: me.xp,
      gold: me.gold,
      soulstones: me.soulstones,
      progress: progressInLevel(me.xp, me.level),
      nextLevel: levelFromXp(me.xp + 1) > me.level ? me.level + 1 : me.level,
    };
  });
}
