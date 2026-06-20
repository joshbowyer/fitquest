import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { WORLDS, getWorld } from '../lib/worlds.js';

const damageSchema = z.object({
  damage: z.number().int().min(1).max(10000),
});

// Per-class damage multiplier. Different classes do different
// amounts of damage to different bosses based on their theme.
// (Reuses the same flavour as raid damage.)
const CLASS_BOSS_MULT: Record<string, number> = {
  JUGGERNAUT: 1.2,  // boss killing spec
  BERSERKER:  1.3,
  PHANTOM:    0.9,
  SCOUT:      1.0,
  ORACLE:     0.85,
};

export async function bossRoutes(app: FastifyInstance) {
  // GET /bosses — list user's bosses (across all worlds)
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const bosses = await prisma.worldBoss.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: 'asc' },
    });

    // Check each world: if all 5 levels cleared and boss doesn't
    // exist yet, create it as LOCKED. If exists in LOCKED, activate it.
    for (const world of WORLDS) {
      const completed = await prisma.userWorldProgress.count({
        where: {
          userId: me.id,
          levelId: { startsWith: `${world.id}-` },
          completed: true,
        },
      });
      const allCleared = completed >= world.levels.length;

      const existing = await prisma.worldBoss.findUnique({
        where: { userId_worldId: { userId: me.id, worldId: world.id } },
      });

      if (allCleared && !existing) {
        // Auto-create the boss in ACTIVE state once world is cleared
        await prisma.worldBoss.create({
          data: {
            userId: me.id,
            worldId: world.id,
            bossName: world.boss.name,
            bossGlyph: world.boss.glyph,
            bossHp: world.boss.maxHp,
            bossMaxHp: world.boss.maxHp,
            status: 'ACTIVE',
            unlockedAt: new Date(),
          },
        });
      } else if (allCleared && existing && existing.status === 'LOCKED') {
        // Promote LOCKED → ACTIVE if user clears world later
        await prisma.worldBoss.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE', unlockedAt: new Date() },
        });
      }
    }

    // Re-fetch after any auto-creation
    const updated = await prisma.worldBoss.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: 'asc' },
    });
    return { bosses: updated };
  });

  // POST /bosses/:worldId/damage — deal damage to a boss
  app.post<{ Params: { worldId: string } }>(
    '/:worldId/damage',
    async (req, reply) => {
      const me = await requireUser(req);
      const { worldId } = req.params;
      const body = damageSchema.parse(req.body);
      const world = getWorld(worldId);
      if (!world) return reply.code(404).send({ error: 'World not found' });

      const boss = await prisma.worldBoss.findUnique({
        where: { userId_worldId: { userId: me.id, worldId } },
      });
      if (!boss) {
        return reply.code(400).send({
          error: 'Boss not unlocked yet — clear all 5 levels first',
        });
      }
      if (boss.status === 'DEFEATED') {
        return reply.code(400).send({ error: 'Boss already defeated' });
      }
      if (boss.status === 'LOCKED') {
        return reply.code(400).send({ error: 'Boss is locked' });
      }

      // Apply class multiplier
      const classMult = me.class ? (CLASS_BOSS_MULT[me.class] ?? 1.0) : 1.0;
      const actualDamage = Math.floor(body.damage * classMult);
      const newHp = Math.max(0, boss.bossHp - actualDamage);
      const defeated = newHp <= 0;

      const updated = await prisma.worldBoss.update({
        where: { id: boss.id },
        data: {
          bossHp: newHp,
          status: defeated ? 'DEFEATED' : 'ACTIVE',
          defeatedAt: defeated ? new Date() : boss.defeatedAt,
        },
      });

      let rewards: { xp: number; gold: number; soulstones: number } | null = null;
      if (defeated && !boss.defeatedAt) {
        // First-time defeat rewards
        const xp = 500;
        const gold = 250;
        const soulstones = 1;
        await prisma.user.update({
          where: { id: me.id },
          data: {
            xp: { increment: xp },
            gold: { increment: gold },
            soulstones: { increment: soulstones },
          },
        });
        rewards = { xp, gold, soulstones };
      }

      return {
        boss: updated,
        actualDamage,
        rewards,
      };
    },
  );
}