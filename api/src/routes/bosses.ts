import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { WORLDS, getWorld, classForWorld } from '../lib/worlds.js';
import { rollLootRarity, pickItemOfRarity } from '../lib/portalLeaks.js';

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
      // Cap a single request at 25% of boss maxHp. The schema
      // already rejects damage > 10000, but a 1.3× Juggernaut
      // mult would still let a malicious client one-shot a boss
      // by sending the cap (10000 × 1.3 = 13000 vs typical
      // boss.maxHp of 500-2500). The workout-driven damage path
      // (applyWorldBossDamage in the workout commit hook) is the
      // authoritative path for "real" damage from a real workout;
      // this endpoint is the manual tap that lets the user chip
      // away between workouts. A 25% ceiling on taps means it
      // takes at least 4 real attacks to kill any boss — fine for
      // the current UX, immune to one-shot exploits.
      const maxPerRequest = Math.max(1, Math.floor(boss.bossMaxHp * 0.25));
      const cappedDamage = Math.min(actualDamage, maxPerRequest);
      const newHp = Math.max(0, boss.bossHp - cappedDamage);
      const defeated = newHp <= 0;

      const updated = await prisma.worldBoss.update({
        where: { id: boss.id },
        data: {
          bossHp: newHp,
          status: defeated ? 'DEFEATED' : 'ACTIVE',
          defeatedAt: defeated ? new Date() : boss.defeatedAt,
        },
      });

      let rewards: {
        xp: number;
        gold: number;
        soulstones: number;
        itemDrop: {
          id: string;
          itemDefId: string;
          name: string;
          slot: string;
          color: string;
          rarity: string;
          sprite: string;
        } | null;
      } | null = null;
      if (defeated && !boss.defeatedAt) {
        // First-time defeat rewards. XP/gold flow through the
        // centralized award helper (heart multiplier + level
        // recompute). The soulstone is a guaranteed 24h-TTL
        // Soulstone ROW — User.soulstones is a relation, not a
        // column, so the old `soulstones: { increment: 1 }` threw
        // PrismaClientValidationError and the ENTIRE first-defeat
        // reward crashed the endpoint.
        const xp = 500;
        const gold = 250;
        const soulstones = 1;
        const { awardXpGold } = await import('../lib/award.js');
        await awardXpGold(me.id, { xp, gold });
        await prisma.soulstone.create({
          data: {
            userId: me.id,
            bossName: boss.bossName,
            bossTier: boss.cycle ?? 1,
            droppedAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });

        // Roll an equipment drop. Higher level = better odds. Reuses
        // the same roll/pick helpers the portal-leak system uses so
        // the user sees consistent rarity across both drop sources.
        // Theme the drop by world: Spire drops Juggernaut gear, Glade
        // drops Phantom gear, etc. NEUTRAL worlds (crossroads, nexus)
        // pass null = unfiltered pool.
        const rarity = rollLootRarity(me.level ?? 1);
        const def = await pickItemOfRarity(prisma, rarity, classForWorld(worldId));
        let itemDrop: {
          id: string;
          itemDefId: string;
          name: string;
          slot: string;
          color: string;
          rarity: string;
          sprite: string;
        } | null = null;
        if (def) {
          const inv = await prisma.inventoryItem.create({
            data: {
              userId: me.id,
              itemDefId: def.id,
            },
          });
          // Re-fetch the full def so the response includes name/rarity/sprite.
          const full = await prisma.itemDef.findUnique({ where: { id: def.id } });
          if (full) {
            itemDrop = {
              id: inv.id,
              itemDefId: full.id,
              name: full.name,
              slot: full.slot,
              color: full.color,
              rarity: full.rarity,
              sprite: full.sprite,
            };
          }
        }

        rewards = { xp, gold, soulstones, itemDrop };
      }

      // Breach world resets on Maw defeat. The reset deletes the
      // cycle-N progress rows, picks a new Maw variant, and resets
      // the boss's HP to full so the next cycle starts fresh.
      let breachReset: Awaited<ReturnType<typeof import('../lib/breachReset.js').resetBreachIfDefeated>> | null = null;
      if (defeated) {
        const { resetBreachIfDefeated } = await import('../lib/breachReset.js');
        breachReset = await resetBreachIfDefeated(me.id, worldId);
      }

      return {
        boss: updated,
actualDamage: cappedDamage,
        rewards,
        breachReset: breachReset && breachReset.reset
          ? { cycle: breachReset.cycle, variant: breachReset.variant }
          : null,
      };
    },
  );
}