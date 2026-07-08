import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { localDayKey } from '../lib/timezone.js';
import {
  WORLDS,
  getWorld,
  getLevel,
  classForWorld,
  computeRequirementProgress,
  type World,
  type WorldLevel,
  type RequirementProgress,
} from '../lib/worlds.js';
import { rollLootRarity, pickItemOfRarity } from '../lib/portalLeaks.js';
import {
  applyCombatPetXp,
  getDeployedCombatPet,
  PET_XP_PER_QUEST_LEVEL_CLEAR,
} from '../lib/petStats.js';
import { computeRecoveryHistory } from '../lib/recovery.js';

// Coerce the Prisma `cardio` JSONB column (typed as `JsonValue`
// when selected) into the narrow `{distanceKm?, durationSec?}`
// shape `computeRequirementProgress` expects. The Prisma JSON
// type is `string | number | boolean | null | JsonObject |
// JsonArray` for any read field — we know at the call sites that
// `cardio` is always either `null` or our own write shape. The
// function defensively `typeof`-checks each numeric field before
// using it, so a bad value just falls through to the duration
// proxy rather than throwing.
function cardioShape(cardio: unknown): { distanceKm?: number | null; durationSec?: number | null } | null {
  if (cardio == null) return null;
  if (typeof cardio !== 'object') return null;
  const o = cardio as Record<string, unknown>;
  const dk = typeof o.distanceKm === 'number' ? o.distanceKm : null;
  const ds = typeof o.durationSec === 'number' ? o.durationSec : null;
  return { distanceKm: dk, durationSec: ds };
}

export async function questRoutes(app: FastifyInstance) {
  // GET /worlds — list all worlds with the user's progress attached
  app.get('/worlds', async (req) => {
    const me = await requireUser(req);
    const sinceDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recentWorkouts = await prisma.workout.findMany({
      where: { userId: me.id, performedAt: { gte: sinceDate } },
      // `cardio` is the workout-level JSONB block (distanceKm /
      // durationSec). The sprint / 5K / distance scans in
      // computeRequirementProgress prefer it over the per-set
      // duration proxy when present. Selecting it explicitly
      // here keeps the field on the row the function consumes.
      select: {
        id: true,
        performedAt: true,
        cardio: true,
        exercises: { select: { name: true, sets: true } },
      },
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
      // Narrow `cardio` (Prisma JSONB column → `JsonValue`) into
      // the {distanceKm, durationSec} shape the progress computer
      // expects. Keeps the rest of the file type-clean.
      recentWorkouts.map((rw: any) => ({ ...rw, cardio: cardioShape(rw.cardio) })),
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
      // Mirror the /worlds findMany: select the workout-level
      // `cardio` JSONB plus the lightweight exercise/set fields
      // the quest computation actually reads. (A full
      // `include` would also drag validity flags / trackJson /
      // postNotes through the wire for no reason.)
      select: {
        id: true,
        performedAt: true,
        cardio: true,
        exercises: { select: { name: true, sets: true } },
      },
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
    // Narrow the Prisma `cardio` JSONB column to the shape the
    // progress computer expects. Done at the route boundary so
    // the rest of the file deals in the narrow type.
    const workoutsForQuest = recentWorkouts.map((w: any) => ({
      ...w,
      cardio: cardioShape(w.cardio),
    }));
    return attachProgress(
      world,
      bossRow?.cycle ?? 1,
      me,
      workoutsForQuest,
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
      // Mirror /worlds + /worlds/:id: select `cardio` + the
      // lightweight exercise/set fields. The full include drags
      // validity flags / trackJson for no reason here.
      select: {
        id: true,
        performedAt: true,
        cardio: true,
        exercises: { select: { name: true, sets: true } },
      },
      orderBy: { performedAt: 'desc' },
    });
    const workoutsForCheck = recentWorkouts.map((rw: any) => ({
      ...rw,
      cardio: cardioShape(rw.cardio),
    }));
    const sleepHistory = await loadSleepHistory(me.id);
    const recoveryHistory = await loadRecoveryHistory(me.id);

    // Per-world current cycle (WorldBoss.cycle — 1 for static
    // worlds, 1..N for the Breach). The progress unique key is
    // (userId, levelId, cycle) since the cycle migration; the old
    // `userId_levelId` two-field key used below no longer exists,
    // so every findUnique/upsert here threw
    // PrismaClientValidationError and quest auto-completion was
    // dead (no completions, no rewards).
    const checkBossRows = await prisma.worldBoss.findMany({
      where: { userId: me.id },
      select: { worldId: true, cycle: true },
    });
    const checkCycleByWorld = new Map<string, number>(
      checkBossRows.map((b: { worldId: string; cycle: number }) => [b.worldId, b.cycle]),
    );

    const results: Array<{ levelId: string; cleared: boolean; progress: RequirementProgress; dropId?: string | null }> = [];
    for (const world of WORLDS) {
      const cycle = checkCycleByWorld.get(world.id) ?? 1;
      for (const lvl of world.levels) {
        const progress = computeRequirementProgress(
          lvl.requirement,
          me.weightKg,
          workoutsForCheck,
          sleepHistory,
          recoveryHistory,
        );
        const existing = await prisma.userWorldProgress.findUnique({
          where: { userId_levelId_cycle: { userId: me.id, levelId: lvl.id, cycle } },
        });
        const wasCompleted = existing?.completed ?? false;
        if (progress.cleared && !wasCompleted) {
          // Auto-complete this level and grant rewards
          await prisma.userWorldProgress.upsert({
            where: { userId_levelId_cycle: { userId: me.id, levelId: lvl.id, cycle } },
            create: {
              userId: me.id,
              levelId: lvl.id,
              cycle,
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
          // Centralized award: heart multiplier + level recompute
          // (quest XP previously never leveled you up until the
          // next workout recomputed level).
          const { awardXpGold } = await import('../lib/award.js');
          await awardXpGold(me.id, { xp: lvl.xp, gold: lvl.gold });
          // Pet combat XP — quest level clear. XP only, no HP loss.
          // Gate: pet.deployed && !faintedAt (handled inside
          // applyCombatPetXp; we fetch via getDeployedCombatPet to
          // share the same lookup across endpoints).
          const deployedPet = await getDeployedCombatPet(me.id);
          if (deployedPet) {
            await applyCombatPetXp(prisma, me.id, PET_XP_PER_QUEST_LEVEL_CLEAR);
          }
          // Themed equipment drop on first clear — ~25% chance so
          // the user sees loot trickle in as they progress through
          // worlds, without flooding their inventory. Drop is
          // filtered by the world's class affiliation so Glade
          // drops Phantom gear, Spire drops Juggernaut gear, etc.
          let dropId: string | null = null;
          if (Math.random() < 0.25) {
            const worldId = lvl.id.split('-')[0] ?? '';
            const rarity = rollLootRarity(me.level ?? 1);
            const def = await pickItemOfRarity(
              prisma,
              rarity,
              classForWorld(worldId),
            );
            if (def) {
              const inv = await prisma.inventoryItem.create({
                data: {
                  userId: me.id,
                  itemDefId: def.id,
                  source: 'QUEST_REWARD',
                  notes: `Drop from ${world.name} — ${lvl.name}`,
                },
              });
              dropId = inv.id;
            }
          }
          results.push({
            levelId: lvl.id,
            cleared: true,
            progress,
            dropId,
          });
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
  // Look up the user's tz for tz-aware date keys. Was previously
  // `s.recordedAt.toISOString().slice(0, 10)` which produced UTC
  // dates — a sleep logged at 11pm EDT showed up as tomorrow's date.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const tz = user?.timezone ?? null;
  return sleeps.map((s: { recordedAt: Date; value: number }) => ({
    date: localDayKey(new Date(s.recordedAt), tz),
    hours: s.value,
  }));
}

// Helper: load recovery score history. Delegates to the batched
// single-query implementation in `recovery.ts`. Previously this
// returned `[]` so the RECOVERY_STREAK scan in
// `computeRequirementProgress` always saw an empty history —
// making sanctum-3, sanctum-5, and crossroads-4 (and their
// bosses) mathematically uncleareable. Now scores are computed
// from real measurements for each of the last 90 days.
async function loadRecoveryHistory(userId: string) {
  return computeRecoveryHistory(userId, 90, null);
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
    /** Workout timestamp; needed for TOTAL_VOLUME cutoff. */
    performedAt?: Date | string | null;
    exercises: Array<{
      name: string;
      sets: Array<{ weight: number | null; reps: number; duration: number | null }>;
    }>;
    /** Optional workout-level cardio block (JSONB on Workout). */
    cardio?: { distanceKm?: number | null; durationSec?: number | null } | null;
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