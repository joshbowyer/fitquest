import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PrayerType } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { checkAchievements } from '../lib/achievements.js';
import { getOrGenerateReflection, type SpiritualReflection } from '../lib/spiritualDirector.js';
import { refreshUsccbCache } from '../lib/usccb.js';

// XP awarded per prayer type (base, before Ordained boost).
const PRAYER_XP: Record<PrayerType, number> = {
  ROSARY: 50,
  MASS: 100,
  SCRIPTURE: 30,
  CONTEMPLATION: 25,
  LITURGY_HOURS: 40,
  CONFESSION: 75,
  OTHER: 20,
};

export const PRAYER_LABELS: Record<PrayerType, { label: string; icon: string; description: string; defaultMinutes: number }> = {
  ROSARY:        { label: 'Rosary',        icon: '✦', description: 'Meditated on the mysteries.', defaultMinutes: 20 },
  MASS:          { label: 'Mass',          icon: '☩', description: 'Attended the Holy Sacrifice of the Mass.', defaultMinutes: 60 },
  SCRIPTURE:      { label: 'Scripture',     icon: '✎', description: 'Read and reflected on Sacred Scripture.', defaultMinutes: 15 },
  CONTEMPLATION: { label: 'Contemplation', icon: '◌', description: 'Spent time in silent mental prayer.', defaultMinutes: 10 },
  LITURGY_HOURS: { label: 'Liturgy of the Hours', icon: '⌚', description: 'Prayed the Divine Office.', defaultMinutes: 20 },
  CONFESSION:    { label: 'Confession',    icon: '✚', description: 'Went to the Sacrament of Confession.', defaultMinutes: 15 },
  OTHER:         { label: 'Other',         icon: '◇', description: 'Other devotional practice.', defaultMinutes: 15 },
};

// XP thresholds for spiritual subclass promotion.
const SPIRITUAL_THRESHOLDS = [
  { stage: 'CATECHUMEN' as const, max: 500 },   // 0-500 XP
  { stage: 'CRUSADER' as const, max: 2500 },    // 501-2500
  { stage: 'TEMPLAR' as const, max: Infinity }, // 2501+
];

export function computeSpiritualSubclass(xp: number, ordained: boolean): 'CATECHUMEN' | 'CRUSADER' | 'TEMPLAR' {
  // Ordained boost: 5% XP multiplier on all prayers, so the user
  // reaches the same stage a little faster in raw XP terms.
  void ordained;
  if (xp < SPIRITUAL_THRESHOLDS[0]!.max) return 'CATECHUMEN';
  if (xp < SPIRITUAL_THRESHOLDS[1]!.max) return 'CRUSADER';
  return 'TEMPLAR';
}

const patchSchema = z.object({
  ordained: z.boolean(),
});

export async function spiritualRoutes(app: FastifyInstance) {
  // GET /spiritual — current state + recent logs
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const [logs, recentCount] = await Promise.all([
      prisma.prayerLog.findMany({
        where: { userId: me.id },
        orderBy: { loggedAt: 'desc' },
        take: 30,
      }),
      prisma.prayerLog.count({
        where: {
          userId: me.id,
          loggedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const currentClass = me.spiritualSubclass ?? computeSpiritualSubclass(me.spiritualXp, me.ordained);
    // For the threshold, show the next promotion's required XP.
// SPIRITUAL_THRESHOLDS[idx].max = XP needed to LEAVE the current stage.
// So if you're CATECHUMEN (idx=0), the next promotion threshold is 500.
const idx = SPIRITUAL_THRESHOLDS.findIndex((t) => t.stage === currentClass);
    const nextThreshold =
      idx >= 0 && idx < SPIRITUAL_THRESHOLDS.length - 1
        ? SPIRITUAL_THRESHOLDS[idx]!.max
        : null;
    const ordinalBonus = me.ordained ? 1.05 : 1.0;

    return {
      xp: me.spiritualXp,
      subclass: currentClass,
      ordained: me.ordained,
      ordainedAt: me.ordainedAt?.toISOString() ?? null,
      ordinalBonus,
      // First-visit reminder shows the picker card on the Spiritual
      // tab, but ONLY for users with no prayer logs yet. We never
      // push non-ordained people to "choose" ordination — the button
      // is there for priests/deacons/etc. who have actually received
      // Holy Orders IRL and want to flip it on (+5% XP).
      showOrdainPicker: !me.ordained && logs.length === 0,
      nextThreshold,
      logsThisWeek: recentCount,
      logs,
      prayerTypes: PRAYER_LABELS,
      // User-defined spiritual practices (USER + SPIRITUAL dailies).
      // They appear alongside the built-ins in the "Log a Prayer"
      // grid and can be logged with the same XP/gold reward flow.
      customPractices: await prisma.daily.findMany({
        where: { userId: me.id, category: 'SPIRITUAL', archived: false },
        orderBy: { createdAt: 'asc' },
      }),
    };
  });

  // POST /spiritual/log — log a prayer. Pass either `type` (built-in)
// or `dailyId` (custom user-defined practice). Custom practices use
// the daily's gold/xp rewards instead of the built-in PRAYER_XP.
const logSchema = z.union([
  z.object({
    type: z.nativeEnum(PrayerType),
    dailyId: z.undefined().optional(),
    durationMin: z.number().int().min(1).max(360).optional(),
    notes: z.string().max(500).optional(),
  }),
  z.object({
    type: z.undefined().optional(),
    dailyId: z.string().min(1),
    durationMin: z.number().int().min(1).max(360).optional(),
    notes: z.string().max(500).optional(),
  }),
]);

  // POST /spiritual/log — log a prayer
  app.post('/log', async (req) => {
    const me = await requireUser(req);
    const body = logSchema.parse(req.body);

    let baseXp = 0;
    let baseGold = 0;
    let type: PrayerType | null = null;
    let dailyId: string | null = null;
    let defaultMin = 15;

    if (body.dailyId) {
      // User-defined custom practice — use the daily's rewards.
      const daily = await prisma.daily.findFirst({
        where: { id: body.dailyId, userId: me.id, category: 'SPIRITUAL', archived: false },
      });
      if (!daily) return { error: 'Practice not found' };
      dailyId = daily.id;
      baseXp = daily.xpReward;
      baseGold = daily.goldReward;
      defaultMin = 15;
    } else if (body.type) {
      type = body.type;
      baseXp = PRAYER_XP[body.type];
      baseGold = 0; // built-ins are xp-only
      defaultMin = PRAYER_LABELS[body.type].defaultMinutes;
    } else {
      return { error: 'Must provide type or dailyId' };
    }

    // Ordained: +5% XP on all prayers
    const xp = me.ordained ? Math.round(baseXp * 1.05) : baseXp;

    const log = await prisma.prayerLog.create({
      data: {
        userId: me.id,
        type,
        dailyId,
        durationMin: body.durationMin ?? defaultMin,
        notes: body.notes,
        xpAwarded: xp,
        goldAwarded: baseGold,
      },
    });
    const newXp = me.spiritualXp + xp;
    const newClass = computeSpiritualSubclass(newXp, me.ordained);
    const promoted = me.spiritualSubclass !== newClass;
    await prisma.user.update({
      where: { id: me.id },
      data: {
        spiritualXp: newXp,
        spiritualSubclass: newClass,
        ...(baseGold ? { gold: { increment: baseGold } } : {}),
      },
    });
    // Run achievement checks after every prayer log so spiritual
    // achievements (First Vespers, Daily Office Devotee, etc.) unlock
    // immediately.
    const newly = await checkAchievements(me.id);
    return { log, newXp, subclass: newClass, promoted, newlyUnlocked: newly };
  });

  // PATCH /spiritual/ordain — one-time choice: become Ordained
  app.patch('/ordain', async (req) => {
    const me = await requireUser(req);
    const body = patchSchema.parse(req.body);
    if (me.ordained === body.ordained) {
      return { ok: true, noop: true };
    }
    const updated = await prisma.user.update({
      where: { id: me.id },
      data: {
        ordained: body.ordained,
        ordainedAt: body.ordained ? new Date() : null,
      },
    });
    return { ok: true, ordained: updated.ordained };
  });

  // PATCH /spiritual/dailies — choose which prayers are daily obligations.
  // These surface as built-in dailies on /today.
  app.patch('/dailies', async (req) => {
    const me = await requireUser(req);
    const body = z.object({
      prayers: z.array(z.nativeEnum(PrayerType)).max(7),
    }).parse(req.body);
    await prisma.user.update({
      where: { id: me.id },
      data: { spiritualDailyPrayers: body.prayers },
    });
    return { ok: true, prayers: body.prayers };
  });

  // GET /spiritual/director
  // Returns today's LLM reflection on the daily Mass readings,
  // tailored to the user's recent state. Cached for the day; force
  // via POST /spiritual/director/regenerate. Returns 204 if no
  // USCCB reading is available (e.g. date outside the feed window).
  app.get('/director', async (req, reply) => {
    const me = await requireUser(req);
    const result: SpiritualReflection | null = await getOrGenerateReflection(me.id);
    if (!result) return reply.code(204).send();
    return result;
  });

  // POST /spiritual/director/regenerate — force a fresh reflection.
  app.post('/director/regenerate', async (req, reply) => {
    const me = await requireUser(req);
    const result: SpiritualReflection | null = await getOrGenerateReflection(me.id, { force: true });
    if (!result) return reply.code(204).send();
    return result;
  });

  // POST /spiritual/refresh-readings — admin/debug: force a refresh
  // of the USCCB daily-readings cache. Not guarded by requireAdmin
  // because the cache is read-only data; users triggering a refresh
  // just means the next reflection gets a fresher reading.
  app.post('/refresh-readings', async () => {
    const result = await refreshUsccbCache();
    return result;
  });
}