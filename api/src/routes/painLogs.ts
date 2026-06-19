import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { BodyPart } from '@prisma/client';

const createSchema = z.object({
  bodyPart: z.nativeEnum(BodyPart),
  intensity: z.number().int().min(0).max(10),
  notes: z.string().max(500).optional(),
});

export async function painLogRoutes(app: FastifyInstance) {
  // GET / — recent logs (with summary by body part)
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const since = (req.query as any)?.since;
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const logs = await prisma.painLog.findMany({
      where: { userId: me.id, loggedAt: { gte: sinceDate } },
      orderBy: { loggedAt: 'desc' },
      take: 200,
    });

    // Per-body-part summary: latest intensity and average over the window
    const summary = new Map<string, { latest: number; avg: number; count: number; latestAt: string }>();
    for (const log of logs) {
      const prev = summary.get(log.bodyPart);
      if (!prev) {
        summary.set(log.bodyPart, {
          latest: log.intensity,
          avg: log.intensity,
          count: 1,
          latestAt: log.loggedAt.toISOString(),
        });
      } else {
        const total = prev.avg * prev.count + log.intensity;
        prev.count += 1;
        prev.avg = total / prev.count;
        if (log.loggedAt.getTime() > new Date(prev.latestAt).getTime()) {
          prev.latest = log.intensity;
          prev.latestAt = log.loggedAt.toISOString();
        }
      }
    }

    return {
      logs,
      summary: Object.fromEntries(summary),
    };
  });

  // POST / — log new pain
  app.post('/', async (req, reply) => {
    const me = await requireUser(req);
    const body = createSchema.parse(req.body);
    const log = await prisma.painLog.create({
      data: {
        userId: me.id,
        bodyPart: body.bodyPart,
        intensity: body.intensity,
        notes: body.notes,
      },
    });
    return log;
  });

  // DELETE /:id — remove a log
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const me = await requireUser(req);
    const { id } = req.params;
    const existing = await prisma.painLog.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    if (existing.userId !== me.id) return reply.code(403).send({ error: 'Forbidden' });
    await prisma.painLog.delete({ where: { id } });
    return { ok: true };
  });
}
