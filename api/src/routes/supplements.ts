import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';

const supplementSchema = z.object({
  name: z.string().min(1).max(60),
  doseMg: z.number().int().min(0).max(100000).optional().nullable(),
  takenAt: z.string().datetime().optional(),
});

/**
 * Returns true if the user has logged `name` (case-insensitive) at
 * least `minDays` distinct days within the past `daysBack` days.
 * Used to auto-derive "creatine active" without needing a sticky
 * boolean on the User.
 */
async function hasSupplementAtLeastNDays(
  userId: string,
  name: string,
  minDays: number,
  daysBack: number,
): Promise<{ active: boolean; daysLastWeek: number }> {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const logs = await prisma.supplementLog.findMany({
    where: {
      userId,
      name: { equals: name, mode: 'insensitive' },
      takenAt: { gte: since },
    },
    select: { takenAt: true },
  });
  const days = new Set<string>();
  for (const l of logs) {
    const d = new Date(l.takenAt);
    days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }
  return { active: days.size >= minDays, daysLastWeek: days.size };
}

export async function supplementRoutes(app: FastifyInstance) {
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
    const since = new Date();
    since.setDate(since.getDate() - 7);
    since.setHours(0, 0, 0, 0);
    const logs = await prisma.supplementLog.findMany({
      where: { userId: me.id, takenAt: { gte: since } },
      orderBy: { takenAt: 'desc' },
    });
    // Distinct days per name
    const byName = new Map<string, { days: Set<string>; latestDoseMg: number | null; latestAt: string }>();
    for (const l of logs) {
      const key = l.name.toLowerCase();
      const d = new Date(l.takenAt);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
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
    // Creatine active = logged on ≥3 of last 7 days
    const creatine = items.find((i) => i.name.toLowerCase() === 'creatine') ?? null;
    const creatineActive = !!creatine && creatine.daysLast7 >= 3;
    return { items, creatine, creatineActive };
  });

  // POST /supplements — log a dose taken today (or at `takenAt`)
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

  // DELETE /supplements/:id — remove a log entry
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    const existing = await prisma.supplementLog.findUnique({ where: { id } });
    if (!existing || existing.userId !== me.id) {
      return reply.code(404).send({ error: 'Log not found' });
    }
    await prisma.supplementLog.delete({ where: { id } });
    return { ok: true };
  });
}

// Helper exported so other routes (e.g. /users/me) can show
// "creatine active" status without re-implementing the rule.
export async function isCreatineActive(userId: string): Promise<boolean> {
  const { active } = await hasSupplementAtLeastNDays(userId, 'creatine', 3, 7);
  return active;
}