import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PrayerType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';

// XP awarded per prayer type (base, before Ordained boost).
const PRAYER_XP: Record<PrayerType, number> = {
  ROSARY: 50,
  MASS: 100,
  SCRIPTURE: 30,
  CONTEMPLATION: 25,
  LITURGY_HOURS: 40,
  CONFESSION: 35,
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

const logSchema = z.object({
  type: z.nativeEnum(PrayerType),
  durationMin: z.number().int().min(1).max(360).optional(),
  notes: z.string().max(500).optional(),
});

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
    const idx = SPIRITUAL_THRESHOLDS.findIndex((t) => t.stage === currentClass);
    const nextThreshold =
      idx >= 0 && idx < SPIRITUAL_THRESHOLDS.length - 1
        ? SPIRITUAL_THRESHOLDS[idx + 1]!.max
        : null;
    const ordinalBonus = me.ordained ? 1.05 : 1.0;

    return {
      xp: me.spiritualXp,
      subclass: currentClass,
      ordained: me.ordained,
      ordainedAt: me.ordainedAt?.toISOString() ?? null,
      ordinalBonus,
      // Ordained requires a one-time choice. Show the picker UI
      // if not yet ordained AND no logs exist.
      showOrdainPicker: !me.ordained && logs.length === 0,
      nextThreshold,
      logsThisWeek: recentCount,
      logs,
      prayerTypes: PRAYER_LABELS,
    };
  });

  // POST /spiritual/log — log a prayer
  app.post('/log', async (req) => {
    const me = await requireUser(req);
    const body = logSchema.parse(req.body);

    const baseXp = PRAYER_XP[body.type];
    // Ordained: +5% XP on all prayers
    const xp = me.ordained ? Math.round(baseXp * 1.05) : baseXp;

    const log = await prisma.prayerLog.create({
      data: {
        userId: me.id,
        type: body.type,
        durationMin: body.durationMin ?? PRAYER_LABELS[body.type].defaultMinutes,
        notes: body.notes,
        xpAwarded: xp,
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
      },
    });
    return { log, newXp, subclass: newClass, promoted };
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
}