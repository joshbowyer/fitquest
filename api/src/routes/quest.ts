import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import {
  WORLDS,
  getWorld,
  getLevel,
  computeRequirementProgress,
  type World,
  type WorldLevel,
  type RequirementProgress,
} from '../lib/worlds.js';

export async function questRoutes(app: FastifyInstance) {
  // GET /worlds — list all worlds with the user's progress attached
  app.get('/worlds', async (req) => {
    const me = await requireUser(req);
    const sinceDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recentWorkouts = await prisma.workout.findMany({
      where: { userId: me.id, performedAt: { gte: sinceDate } },
      include: { exercises: { include: { sets: true } } },
      orderBy: { performedAt: 'desc' },
    });
    const sleepHistory = await loadSleepHistory(me.id);
    const recoveryHistory = await loadRecoveryHistory(me.id);
    const progress = await prisma.userWorldProgress.findMany({ where: { userId: me.id } });
    // WorldBoss rows hold the per-world current cycle. Static
    // worlds (spire, glade, etc.) never reset so their cycle is
    // always 1. Breach cycles each time the user kills the Maw.
    const bossRows = await prisma.worldBoss.findMany({ where: { userId: me.id } });
    const cycleByWorld = new Map<string, number>(
      bossRows.map((b: { worldId: string; cycle: number }) => [b.worldId, b.cycle]),
    );

    return WORLDS.map((w) => attachProgress(
      w,
      cycleByWorld.get(w.id) ?? 1,
      me,
      recentWorkouts,
      sleepHistory,
      recoveryHistory,
      progress,
    ));
  });

  // GET /worlds/:id — single world with full levels + progress
  app.get<{ Params: { id: string } }>('/worlds/:id', async (req, reply) => {
    const me = await requireUser(req);
    const { id } = req.params;
    const world = getWorld(id);
    if (!world) return reply.code(404).send({ error: 'World not found' });

    const sinceDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recentWorkouts = await prisma.workout.findMany({
      where: { userId: me.id, performedAt: { gte: sinceDate } },
      include: { exercises: { include: { sets: true } } },
      orderBy: { performedAt: 'desc' },
    });
    const sleepHistory = await loadSleepHistory(me.id);
    const recoveryHistory = await loadRecoveryHistory(me.id);
    const progress = await prisma.userWorldProgress.findMany({
      where: { userId: me.id, levelId: { startsWith: `${id}-` } },
    });
    const bossRow = await prisma.worldBoss.findUnique({
      where: { userId_worldId: { userId: me.id, worldId: id } },
      select: { cycle: true },
    });
    return attachProgress(
      world,
      bossRow?.cycle ?? 1,
      me,
      recentWorkouts,
      sleepHistory,
      recoveryHistory,
      progress,
    );
  });

  // POST /check — re-check all levels after a workout / sleep log /
  // recovery change. Auto-completes any newly-cleared levels.
  app.post('/check', async (req) => {
    const me = await requireUser(req);
    const sinceDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recentWorkouts = await prisma.workout.findMany({
      where: { userId: me.id, performedAt: { gte: sinceDate } },
      include: { exercises: { include: { sets: true } } },
      orderBy: { performedAt: 'desc' },
    });
    const sleepHistory = await loadSleepHistory(me.id);
    const recoveryHistory = await loadRecoveryHistory(me.id);

    const results: Array<{ levelId: string; cleared: boolean; progress: RequirementProgress }> = [];
    for (const world of WORLDS) {
      for (const lvl of world.levels) {
        const progress = computeRequirementProgress(
          lvl.requirement,
          me.weightKg,
          recentWorkouts,
          sleepHistory,
          recoveryHistory,
        );
        const existing = await prisma.userWorldProgress.findUnique({
          where: { userId_levelId: { userId: me.id, levelId: lvl.id } },
        });
        const wasCompleted = existing?.completed ?? false;
        if (progress.cleared && !wasCompleted) {
          // Auto-complete this level and grant rewards
          await prisma.userWorldProgress.upsert({
            where: { userId_levelId: { userId: me.id, levelId: lvl.id } },
            create: {
              userId: me.id,
              levelId: lvl.id,
              completed: true,
              completedAt: new Date(),
              attempts: 1,
              bestScore: 100,
            },
            update: {
              completed: true,
              completedAt: existing?.completedAt ?? new Date(),
              attempts: { increment: 1 },
            },
          });
          await prisma.user.update({
            where: { id: me.id },
            data: {
              xp: { increment: lvl.xp },
              gold: { increment: lvl.gold },
            },
          });
          results.push({ levelId: lvl.id, cleared: true, progress });
        } else {
          results.push({
            levelId: lvl.id,
            cleared: wasCompleted || progress.cleared,
            progress,
          });
        }
      }
    }
    return { results };
  });
}

// Helper: load sleep history from the user's measurements (we treat
// any SLEEP measurement as a sleep log).
async function loadSleepHistory(userId: string) {
  const sleeps = await prisma.measurement.findMany({
    where: { userId, metric: 'SLEEP_HOURS' },
    orderBy: { recordedAt: 'desc' },
    take: 90,
  });
  return sleeps.map((s: { recordedAt: Date; value: number }) => ({
    date: s.recordedAt.toISOString().slice(0, 10),
    hours: s.value,
  }));
}

// Helper: load recovery score history. Compute the same way as
// api/src/lib/recovery.ts but for past dates.
async function loadRecoveryHistory(userId: string) {
  // For now just return empty — recovery score computation requires
  // multiple metrics; we can expand this later when the user has
  // enough history.
  return [];
}

// Helper: attach user progress to a world. `cycle` is the current
// world-cycle the user is on (1 for static worlds, 1..N for the
// Breach world where the Maw resets). Progress rows for OTHER
// cycles are kept for history but ignored here.
function attachProgress(
  world: World,
  cycle: number,
  user: { id: string; level: number; weightKg: number | null; bodyweightKg?: number | null },
  recentWorkouts: Array<{
    exercises: Array<{
      name: string;
      sets: Array<{ weight: number | null; reps: number; duration: number | null }>;
    }>;
  }>,
  sleepHistory: Array<{ date: string; hours: number }>,
  recoveryHistory: Array<{ date: string; score: number }>,
  progress: Array<{ levelId: string; cycle: number; completed: boolean; completedAt: Date | null; attempts: number; bestScore: number }>,
): World & {
  levels: Array<WorldLevel & { progress: RequirementProgress | null; completed: boolean; completedAt: string | null }>;
  cycle: number;
} {
  // Filter progress to just the current cycle for this world
  const progressForCycle = progress.filter((p) => p.cycle === cycle);
  const progressByLevel = new Map(progressForCycle.map((p) => [p.levelId, p]));
  const levels = world.levels.map((lvl) => {
    const reqProgress = computeRequirementProgress(
      lvl.requirement,
      user.weightKg,
      recentWorkouts,
      sleepHistory,
      recoveryHistory,
    );
    const existing = progressByLevel.get(lvl.id);
    const completed = existing?.completed ?? reqProgress.cleared;
    return {
      ...lvl,
      progress: reqProgress,
      completed,
      completedAt: existing?.completedAt?.toISOString() ?? null,
    };
  });
  return { ...world, levels, cycle };
}