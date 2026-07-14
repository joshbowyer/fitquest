import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CalorieGoal, CalorieSource, ClassName, PrismaRuntime } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { computeAllGeneticMaxes } from '../lib/geneticMax.js';
import { levelFromXp, progressInLevel } from '../lib/xp.js';
import { assertCanChangeClass, getClassLockStatus } from '../lib/classLock.js';
import { isCreatineActive } from './supplements.js';
import { tickHearts, heartMultiplier, HARDCORE_SUBSTANCE_CAPS } from '../lib/mode.js';

const ProfileSchema = z.object({
  class: z.nativeEnum(ClassName).optional(),
  units: z.enum(['METRIC', 'IMPERIAL']).optional(),
  sex: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
  heightCm: z.number().positive().max(260).optional().nullable(),
  wristCm: z.number().positive().max(30).optional().nullable(),
  ankleCm: z.number().positive().max(30).optional().nullable(),
  forearmLengthCm: z.number().positive().max(60).optional().nullable(),
  neckCircCm: z.number().positive().max(80).optional().nullable(),
  // Body measurements used by the Tron identity disk to scale the
  // disc radius, inner ring, and figure vertical position. Optional
  // so existing installs without these fields aren't blocked.
  // Upper bounds cover ~99.9th percentile adult humans:
  //   shoulder width: ~70cm (narrow) to ~160cm (very broad bodybuilders)
  //   waist:           ~60cm (lean)   to ~180cm (very large)
  shoulderCm: z.number().positive().max(200).optional().nullable(),
  waistCm: z.number().positive().max(200).optional().nullable(),
  weightKg: z.number().positive().max(300).optional().nullable(),
  bodyFatPct: z.number().min(2).max(60).optional().nullable(),
  birthDate: z.string().datetime().optional().nullable(),
  // "Ordained" reflects an IRL sacrament (Holy Orders), not a
  // game perk. The user sets it themselves from Profile → Identity
  // because only they know whether they've actually received it.
  // We don't prompt or surface it anywhere else.
  ordained: z.boolean().optional(),
  creatine: z.boolean().optional(),
  timezone: z.string().max(100).optional().nullable(),
  /// Calorie goal (CUT / MAINTAIN / BULK). Drives the conservative
  /// ±250 cal adjustment from calorieBaseline, and the protein
  /// target on the Nutrition page.
  goal: z.nativeEnum(CalorieGoal).optional(),
  /// User-set maintenance calorie baseline. Calorie goal =
  /// baseline + (cut -250 / maintain 0 / bulk +250).
  calorieBaseline: z.number().int().min(800).max(8000).optional(),
  /// What the baseline number represents. Affects only the UI
  /// label; the math is the same.
  calorieSource: z.nativeEnum(CalorieSource).optional(),
  /// USDA FoodData Central API key. Free signup at
  /// https://fdc.nal.usda.gov/api-key-signup.html. Empty string
  /// clears the key.
  usdaApiKey: z.string().max(200).optional().nullable(),
  /// Casual / Hardcore difficulty mode. Switches the penalty ladder
  /// on/off (hearts, streak-break, substance caps). Casual is the
  /// default and behaves identically to the legacy no-penalty app.
  mode: z.enum(['CASUAL', 'HARDCORE']).optional(),
  /// Home location for the /forecast page. Lat/lng in decimal
  /// degrees (WGS84). Latitude bounded to ±90, longitude to
  /// ±180. Empty string or null clears the override so the
  /// forecast falls back to the most-recent workout's centroid.
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});

export async function userRoutes(app: FastifyInstance) {
  app.get('/me', async (req) => {
    const me = await requireUser(req);
    // Tick hearts on every /me read so the UI always reflects the
    // current regen state, even if the user has been offline for
    // days. tickHearts is a no-op for Casual mode (returns 5).
    const hearts = await tickHearts(me.id);
    // Count active Soulstones (unconsumed + not-yet-disintegrated).
    // Used by the classLock block below + the shop endpoint.
    const now = new Date();
    const soulstoneCount = await prisma.soulstone.count({
      where: { userId: me.id, consumed: false, expiresAt: { gt: now } },
    });
    return {
      id: me.id,
      email: me.email,
      username: me.username,
      level: me.level,
      xp: me.xp,
      gold: me.gold,
      soulstones: soulstoneCount,
      class: me.class,
      units: me.units,
      heightCm: me.heightCm,
      wristCm: me.wristCm,
      ankleCm: me.ankleCm,
      forearmLengthCm: me.forearmLengthCm,
      neckCircCm: me.neckCircCm,
      shoulderCm: me.shoulderCm,
      waistCm: me.waistCm,
      sex: me.sex,
      weightKg: me.weightKg,
      bodyFatPct: me.bodyFatPct,
      birthDate: me.birthDate,
      createdAt: me.createdAt,
      classChangedAt: me.classChangedAt,
      classLock: getClassLockStatus(me.class, me.classChangedAt, me.birthDate, soulstoneCount, undefined, me.timezone ?? null),
      progress: progressInLevel(me.xp, me.level),
      ordained: me.ordained,
      spiritualDailyPrayers: me.spiritualDailyPrayers,
      // `creatine` (boolean) is the legacy User field; `creatineActive`
      // is the new auto-derived flag (true when ≥3 of last 7 days have
      // a Creatine log). The lean-mass calc uses creatineActive.
      creatine: me.creatine,
      creatineActive: await isCreatineActive(me.id),
      timezone: me.timezone,
      // Casual / Hardcore mode + heart state. Hearts is read-tick'd
      // above so the value here is fresh. multiplier is computed
      // here too so the UI doesn't have to redo the math.
      mode: me.mode ?? 'CASUAL',
      hearts,
      heartMultiplier: heartMultiplier(hearts, me.mode ?? 'CASUAL'),
      hardcoreCaps: HARDCORE_SUBSTANCE_CAPS,
      latitude: me.latitude,
      longitude: me.longitude,
    };
  });

  app.patch('/me', async (req) => {
    const me = await requireUser(req);
    const body = ProfileSchema.parse(req.body);

    // Class lock check. If the user is mid-cooldown, allow the change
    // only if they have a Soulstone to spend. assertCanChangeClass
    // returns { useSoulstone: true } in that case. The Soulstone
    // consumption is performed below: pick the oldest active (non-
    // expired, unconsumed) Soulstone row and mark it consumed.
    let soulstoneConsumed = false;
    if (body.class !== undefined && body.class !== me.class) {
      const activeSoulstoneCount = await prisma.soulstone.count({
        where: { userId: me.id, consumed: false, expiresAt: { gt: new Date() } },
      });
      const verdict = assertCanChangeClass(me, body.class, activeSoulstoneCount, me.timezone ?? null);
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
        units: (body as any).units ?? undefined,
        sex: body.sex === undefined ? undefined : body.sex,
        heightCm: body.heightCm === undefined ? undefined : body.heightCm,
        wristCm: body.wristCm === undefined ? undefined : body.wristCm,
        ankleCm: body.ankleCm === undefined ? undefined : body.ankleCm,
        forearmLengthCm: body.forearmLengthCm === undefined ? undefined : body.forearmLengthCm,
        neckCircCm: body.neckCircCm === undefined ? undefined : body.neckCircCm,
        shoulderCm: body.shoulderCm === undefined ? undefined : body.shoulderCm,
        waistCm: body.waistCm === undefined ? undefined : body.waistCm,
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
        ...(body.creatine !== undefined ? { creatine: body.creatine } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone || null } : {}),
        ...(body.mode !== undefined ? { mode: body.mode } : {}),
        ...(body.goal !== undefined ? { goal: body.goal } : {}),
        ...(body.calorieBaseline !== undefined ? { calorieBaseline: body.calorieBaseline } : {}),
        ...(body.calorieSource !== undefined ? { calorieSource: body.calorieSource } : {}),
        ...(body.usdaApiKey !== undefined
          ? { usdaApiKey: body.usdaApiKey === '' ? null : body.usdaApiKey }
          : {}),
        // Lat/lng clear-on-null: PATCHing with null wipes the
        // override so /forecast falls back to the workout-centroid
        // auto-detect.
        ...(body.latitude !== undefined
          ? { latitude: body.latitude === null ? null : body.latitude }
          : {}),
        ...(body.longitude !== undefined
          ? { longitude: body.longitude === null ? null : body.longitude }
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

    // Consume the oldest active Soulstone row. We pick by
    // `droppedAt ASC` (FIFO) so the user always burns the stone
    // closest to its TTL — the most "expendable" — leaving them
    // with the freshest stone in their inventory.
    if (soulstoneConsumed) {
      const oldest = await prisma.soulstone.findFirst({
        where: { userId: me.id, consumed: false, expiresAt: { gt: new Date() } },
        orderBy: { droppedAt: 'asc' },
      });
      if (oldest) {
        await prisma.soulstone.update({
          where: { id: oldest.id },
          data: { consumed: true, consumedAt: new Date() },
        });
      }
    }

    // Re-count for the response (one fewer now).
    const newSoulstoneCount = await prisma.soulstone.count({
      where: { userId: me.id, consumed: false, expiresAt: { gt: new Date() } },
    });

    return { ok: true, soulstoneConsumed, soulstones: newSoulstoneCount };
  });

  // Spend a Soulstone to remove the class lock WITHOUT changing the
  // class. The user clicks "Use 1 Soulstone to change class" on the
  // /profile banner; this endpoint consumes one Soulstone and resets
  // classChangedAt to null so the lock status flips back to
  // unlocked. The user then picks their new class via the regular
  // class-pick modal (no second Soulstone charge).
  //
  // Separating this from PATCH /me keeps the "click a class tile to
  // switch to it" flow untouched — that flow still consumes one
  // Soulstone in PATCH /me when a Soulstone is needed.
  app.post('/me/unlock-class', async (req, reply) => {
    const me = await requireUser(req);

    // Only useful while a lock is actually active. Without a class
    // picked there's nothing to unlock; with a pick but no
    // classChangedAt, the lock is already off.
    if (!me.class || !me.classChangedAt) {
      return reply.code(400).send({
        error: 'Class is not locked.',
        code: 'CLASS_NOT_LOCKED',
      });
    }

    const activeSoulstoneCount = await prisma.soulstone.count({
      where: { userId: me.id, consumed: false, expiresAt: { gt: new Date() } },
    });
    if (activeSoulstoneCount <= 0) {
      return reply.code(400).send({
        error: 'No Soulstones available.',
        code: 'NO_SOULSTONE',
      });
    }

    // FIFO: burn the oldest active stone (closest to TTL, so the
    // user keeps the freshest one in inventory).
    const oldest = await prisma.soulstone.findFirst({
      where: { userId: me.id, consumed: false, expiresAt: { gt: new Date() } },
      orderBy: { droppedAt: 'asc' },
    });
    if (oldest) {
      await prisma.soulstone.update({
        where: { id: oldest.id },
        data: { consumed: true, consumedAt: new Date() },
      });
    }

    // Reset the lock. getClassLockStatus treats null classChangedAt
    // as "not locked", so the user can pick freely now. The next
    // class pick will stamp a fresh classChangedAt and start a new
    // year-long cooldown.
    await prisma.user.update({
      where: { id: me.id },
      data: { classChangedAt: null },
    });

    const newSoulstoneCount = await prisma.soulstone.count({
      where: { userId: me.id, consumed: false, expiresAt: { gt: new Date() } },
    });

    return { ok: true, soulstones: newSoulstoneCount };
  });

  app.get('/me/stats', async (req) => {
    const me = await requireUser(req);
    const soulstoneCount = await prisma.soulstone.count({
      where: { userId: me.id, consumed: false, expiresAt: { gt: new Date() } },
    });
    return {
      level: me.level,
      xp: me.xp,
      gold: me.gold,
      soulstones: soulstoneCount,
      progress: progressInLevel(me.xp, me.level),
      nextLevel: levelFromXp(me.xp + 1) > me.level ? me.level + 1 : me.level,
    };
  });

  // Per-user sidebar order. Returns the saved array of route paths
  // (or null if the user hasn't reordered yet). The frontend uses
  // null to fall back to the canonical default order.
  app.get('/me/nav-order', async (req) => {
    const me = await requireUser(req);
    return { order: me.navOrder ?? null };
  });

  // Persist the user's preferred sidebar order. Body is
  // { order: string[] } — array of route paths. We accept any
  // length and validate against the canonical NAV list on the
  // client; the server just stores whatever the client sends so
  // adding a new nav item doesn't require a schema migration.
  app.put('/me/nav-order', async (req, reply) => {
    const me = await requireUser(req);
    const body = req.body as { order?: unknown };
    if (!Array.isArray(body.order)) {
      return reply.code(400).send({ error: 'order must be an array of route paths' });
    }
    // Defensive: cap length, force strings, drop empties.
    const cleaned = body.order
      .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 100)
      .slice(0, 100);
    if (cleaned.length === 0) {
      // Empty array = "use default" — clear the column.
      // navOrder is a Json? column, so the only spelling Prisma
      // accepts for "set to NULL" is PrismaRuntime.JsonNull — a
      // bare `null` throws PrismaClientValidationError at runtime.
      await prisma.user.update({ where: { id: me.id }, data: { navOrder: PrismaRuntime.JsonNull } });
      return { ok: true, order: null };
    }
    await prisma.user.update({
      where: { id: me.id },
      data: { navOrder: cleaned as any },
    });
    return { ok: true, order: cleaned };
  });
}
