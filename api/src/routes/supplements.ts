import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TrackedItemCategory, TrackedItemUnit } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { todayInTz, localMidnightUtc, localDayKey } from '../lib/timezone.js';

// ---- Schemas ----

const TrackedItemCreateSchema = z.object({
  name: z.string().min(1).max(60),
  category: z.nativeEnum(TrackedItemCategory),
  defaultDose: z.number().positive().max(100000),
  doseUnit: z.nativeEnum(TrackedItemUnit),
  notes: z.string().max(200).optional().nullable(),
});

const TrackedItemUpdateSchema = z.object({
  defaultDose: z.number().positive().max(100000).optional(),
  doseUnit: z.nativeEnum(TrackedItemUnit).optional(),
  notes: z.string().max(200).optional().nullable(),
  category: z.nativeEnum(TrackedItemCategory).optional(),
});

// ---- Historical supplement log (kept for the morning report's
// "supplements adherence %" metric). New tracking uses the
// UserTrackedItem + DailyTrackedItem tables. ----

const supplementSchema = z.object({
  name: z.string().min(1).max(60),
  doseMg: z.number().int().min(0).max(100000).optional().nullable(),
  takenAt: z.string().datetime().optional(),
});

export async function supplementsRoutes(app: FastifyInstance) {
  // ================================================================
  // TRACKED ITEMS — persistent catalog + daily check-off
  // ================================================================

  // GET /supplements/tracked
  // List all tracked items, grouped by category, with today's
  // check-off status inline so the UI renders in one round-trip.
  app.get('/tracked', async (req) => {
    const me = await requireUser(req);
    const date = todayInTz(me.timezone);
    const [items, todayLogs] = await Promise.all([
      prisma.userTrackedItem.findMany({
        where: { userId: me.id },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      }),
      prisma.dailyTrackedItem.findMany({
        where: { userId: me.id, date },
      }),
    ]);
    const todayByItem = new Map(todayLogs.map((l) => [l.itemId, l]));
    return {
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category,
        defaultDose: i.defaultDose,
        doseUnit: i.doseUnit,
        notes: i.notes,
        createdAt: i.createdAt.toISOString(),
        today: todayByItem.has(i.id)
          ? {
              logId: todayByItem.get(i.id)!.id,
              dose: todayByItem.get(i.id)!.dose,
              doseUnit: todayByItem.get(i.id)!.doseUnit,
              checkedAt: todayByItem.get(i.id)!.createdAt.toISOString(),
            }
          : null,
      })),
    };
  });

  // POST /supplements/tracked
  // Add a new item to the user's catalog. Case-insensitive dedupe
  // on (name, category) so re-adding "Vitamin D3" returns the existing
  // row rather than 409ing.
  app.post('/tracked', async (req, reply) => {
    const me = await requireUser(req);
    const body = TrackedItemCreateSchema.parse(req.body);
    const existing = await prisma.userTrackedItem.findFirst({
      where: {
        userId: me.id,
        name: { equals: body.name, mode: 'insensitive' },
        category: body.category,
      },
    });
    if (existing) {
      return reply.code(200).send({ item: existing, deduplicated: true });
    }
    const item = await prisma.userTrackedItem.create({
      data: {
        userId: me.id,
        name: body.name,
        category: body.category,
        defaultDose: body.defaultDose,
        doseUnit: body.doseUnit,
        notes: body.notes ?? null,
      },
    });
    return reply.send({ item, deduplicated: false });
  });

  // PATCH /supplements/tracked/:id
  // Update defaultDose, doseUnit, notes, or category. Today's
  // check-off snapshot is preserved (we copy the current defaultDose
  // into the daily row at check-off time, so editing the default
  // doesn't rewrite history).
  app.patch<{ Params: { id: string } }>('/tracked/:id', async (req, reply) => {
    const me = await requireUser(req);
    const id = req.params.id;
    const body = TrackedItemUpdateSchema.parse(req.body);
    const existing = await prisma.userTrackedItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== me.id) {
      return reply.code(404).send({ error: 'Item not found' });
    }
    const item = await prisma.userTrackedItem.update({
      where: { id },
      data: {
        defaultDose: body.defaultDose ?? undefined,
        doseUnit: body.doseUnit ?? undefined,
        notes: body.notes === undefined ? undefined : body.notes,
        category: body.category ?? undefined,
      },
    });
    return { item };
  });

  // DELETE /supplements/tracked/:id
  // Removes the item AND all its daily logs (cascade).
  app.delete<{ Params: { id: string } }>('/tracked/:id', async (req, reply) => {
    const me = await requireUser(req);
    const id = req.params.id;
    const existing = await prisma.userTrackedItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== me.id) {
      return reply.code(404).send({ error: 'Item not found' });
    }
    await prisma.userTrackedItem.delete({ where: { id } });
    return { ok: true };
  });

  // POST /supplements/tracked/:id/check
  // Check off the item for today. Idempotent: if already checked,
  // returns the existing log. Optional body { dose, doseUnit }
  // overrides the default (rare; amounts usually don't vary).
  app.post<{ Params: { id: string } }>('/tracked/:id/check', async (req, reply) => {
    const me = await requireUser(req);
    const id = req.params.id;
    const date = todayInTz(me.timezone);
    const body = z
      .object({
        dose: z.number().positive().max(100000).optional(),
        doseUnit: z.nativeEnum(TrackedItemUnit).optional(),
      })
      .parse(req.body ?? {});
    const item = await prisma.userTrackedItem.findUnique({ where: { id } });
    if (!item || item.userId !== me.id) {
      return reply.code(404).send({ error: 'Item not found' });
    }
    const log = await prisma.dailyTrackedItem.upsert({
      where: { userId_itemId_date: { userId: me.id, itemId: id, date } },
      create: {
        userId: me.id,
        itemId: id,
        date,
        dose: body.dose ?? item.defaultDose,
        doseUnit: body.doseUnit ?? item.doseUnit,
      },
      update: {
        dose: body.dose ?? item.defaultDose,
        doseUnit: body.doseUnit ?? item.doseUnit,
      },
    });
    return { log };
  });

  // DELETE /supplements/tracked/:id/check
  // Uncheck the item for today.
  app.delete<{ Params: { id: string } }>('/tracked/:id/check', async (req, reply) => {
    const me = await requireUser(req);
    const id = req.params.id;
    const date = todayInTz(me.timezone);
    const existing = await prisma.dailyTrackedItem.findUnique({
      where: { userId_itemId_date: { userId: me.id, itemId: id, date } },
    });
    if (!existing) return { ok: true, alreadyUnchecked: true };
    await prisma.dailyTrackedItem.delete({ where: { id: existing.id } });
    return { ok: true };
  });

  // ================================================================
  // HISTORICAL — kept for the morning report's adherence metric
  // ================================================================

  // GET /supplements — recent supplement logs (last 30 days)
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const logs = await prisma.supplementLog.findMany({
      where: { userId: me.id, takenAt: { gte: since } },
      orderBy: { takenAt: 'desc' },
      take: 200,
    });
    return { items: logs };
  });

  // GET /supplements/summary — last 7 days rolled up, per name
  app.get('/summary', async (req) => {
    const me = await requireUser(req);
    const tz = me.timezone ?? null;
    // Lower bound = local midnight 7 days ago in the user's tz.
    // Was `new Date(); setDate(-7); setHours(0,0,0,0)` which is UTC
    // anchored — off by ±1 day at each edge for non-UTC users.
    const since = new Date(localMidnightUtc(todayInTz(tz), tz ?? 'UTC').getTime() - 7 * 24 * 60 * 60 * 1000);
    const logs = await prisma.supplementLog.findMany({
      where: { userId: me.id, takenAt: { gte: since } },
      orderBy: { takenAt: 'desc' },
    });
    const byName = new Map<string, { days: Set<string>; latestDoseMg: number | null; latestAt: string }>();
    for (const l of logs) {
      const key = l.name.toLowerCase();
      // Bucket by the user's local date — was previously server-local
      // (UTC), which double-counted or skipped days for non-UTC users.
      const dayKey = localDayKey(new Date(l.takenAt), tz);
      const cur = byName.get(key) ?? { days: new Set<string>(), latestDoseMg: null, latestAt: l.takenAt.toISOString() };
      cur.days.add(dayKey);
      cur.latestDoseMg = l.doseMg ?? cur.latestDoseMg;
      if (new Date(l.takenAt).getTime() > new Date(cur.latestAt).getTime()) cur.latestAt = l.takenAt.toISOString();
      byName.set(key, cur);
    }
    const items = Array.from(byName.entries()).map(([name, v]) => ({
      name,
      daysLast7: v.days.size,
      latestDoseMg: v.latestDoseMg,
      latestAt: v.latestAt,
    }));
    const creatine = items.find((i) => i.name.toLowerCase() === 'creatine') ?? null;
    const creatineActive = !!creatine && creatine.daysLast7 >= 3;
    return { items, creatine, creatineActive };
  });

  // POST /supplements — log a dose (kept for one-off ad-hoc logs
  // not tied to a tracked item; e.g. "I took 2 aspirin just now")
  app.post('/', async (req) => {
    const me = await requireUser(req);
    const body = supplementSchema.parse(req.body);
    const takenAt = body.takenAt ? new Date(body.takenAt) : new Date();
    const log = await prisma.supplementLog.create({
      data: {
        userId: me.id,
        name: body.name,
        doseMg: body.doseMg ?? null,
        takenAt,
      },
    });
    return { log };
  });

  // DELETE /supplements/:id
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const id = req.params.id;
    const existing = await prisma.supplementLog.findUnique({ where: { id } });
    if (!existing || existing.userId !== me.id) {
      return reply.code(404).send({ error: 'Log not found' });
    }
    await prisma.supplementLog.delete({ where: { id } });
    return { ok: true };
  });
}

/**
 * Helper exported so other routes (e.g. /users/me) can show
 * "creatine active" status without re-implementing the rule.
 * Computed from the historical SupplementLog table (the same way it
 * was before the new tracking system landed). Uses 3-of-last-7-days.
 */
export async function isCreatineActive(userId: string): Promise<boolean> {
  // Look up the user's tz — exported helpers don't have `me` in scope.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const tz = user?.timezone ?? null;
  const since = new Date(
    localMidnightUtc(todayInTz(tz), tz ?? 'UTC').getTime() - 7 * 24 * 60 * 60 * 1000,
  );
  const logs = await prisma.supplementLog.findMany({
    where: {
      userId,
      name: { equals: 'creatine', mode: 'insensitive' },
      takenAt: { gte: since },
    },
    select: { takenAt: true },
  });
  const days = new Set<string>();
  for (const l of logs) {
    // Bucket by user's local date — was server-local UTC, which
    // miscounted days at the UTC/local boundary.
    days.add(localDayKey(new Date(l.takenAt), tz));
  }
  return days.size >= 3;
}
