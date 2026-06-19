import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';

export async function achievementRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const [all, unlocked] = await Promise.all([
      prisma.achievement.findMany({ orderBy: [{ category: 'asc' }, { points: 'asc' }] }),
      prisma.userAchievement.findMany({ where: { userId: me.id } }),
    ]);
    const unlockedIds = new Set(unlocked.map((u) => u.achievementId));
    return {
      items: all.map((a) => ({
        ...a,
        unlocked: unlockedIds.has(a.id),
        unlockedAt: unlocked.find((u) => u.achievementId === a.id)?.unlockedAt ?? null,
      })),
    };
  });

  app.get('/me', async (req) => {
    const me = await requireUser(req);
    const items = await prisma.userAchievement.findMany({
      where: { userId: me.id },
      include: { achievement: true },
      orderBy: { unlockedAt: 'desc' },
    });
    return { items };
  });
}
