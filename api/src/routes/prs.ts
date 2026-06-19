import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';

export async function prRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const q = (req.query as any) ?? {};
    const where: any = { userId: me.id };
    if (q.exercise) where.exercise = q.exercise;
    const items = await prisma.pr.findMany({
      where,
      orderBy: { achievedAt: 'desc' },
      take: 100,
    });
    return { items };
  });

  app.get('/best', async (req) => {
    const me = await requireUser(req);
    const prs = await prisma.pr.findMany({ where: { userId: me.id } });
    const bestByExercise = new Map<string, typeof prs[number]>();
    for (const p of prs) {
      const cur = bestByExercise.get(p.exercise);
      if (!cur || p.value > cur.value) bestByExercise.set(p.exercise, p);
    }
    return { items: Array.from(bestByExercise.values()) };
  });
}
