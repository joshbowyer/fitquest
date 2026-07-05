import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { checkAchievements } from '../lib/achievements.js';
import {
  PET_FOOD_COOLDOWN_MS,
  PET_FOOD_GOLD_COST,
  attackForLevel,
  leveledUp,
  maxHpForLevel,
  spritePath,
  spriteStage,
  vetCostGold,
  xpToNextLevel,
} from '../lib/petStats.js';

const feedSchema = z.object({
  /// How many food units to feed at once. 1-50. Each unit is +1 XP
  /// and 10g.
  count: z.number().int().min(1).max(50).default(1),
});

/**
 * Map the persisted PetInstance + its PetBreed into the shape the
 * /pet endpoint returns. Single source of truth for derived fields
 * so the frontend and combat callers stay in sync.
 */
export async function serializePet(petId: string) {
  const pet = await prisma.petInstance.findUnique({
    where: { id: petId },
    include: { breed: true },
  });
  if (!pet) throw new Error(`pet ${petId} not found`);

  const maxHp = maxHpForLevel(pet.level, pet.breed.baseHp);
  // currentHp: persisted hpAfterCombat clamped to maxHp. -1 means
  // "never been in combat, full HP implied".
  const currentHp =
    pet.hpAfterCombat < 0 ? maxHp : Math.min(pet.hpAfterCombat, maxHp);

  const stage = spriteStage({
    evolvedAt: pet.evolvedAt,
    armoredAt: pet.armoredAt,
    injuredAt: pet.injuredAt,
  });

  return {
    id: pet.id,
    name: pet.name,
    colorVariant: pet.colorVariant,
    level: pet.level,
    xp: pet.xp,
    xpToNextLevel: xpToNextLevel(pet.level, pet.xp),
    isPuppy: !pet.evolvedAt,
    isArmored: !!pet.armoredAt,
    isFainted: !!pet.faintedAt,
    canToggleArmor: pet.level >= 15 && !pet.faintedAt,
    canFeed: !pet.faintedAt,
    canVet: !!pet.faintedAt,
    stage,
    spritePath: spritePath(pet.breed, stage, pet.colorVariant),
    currentHp,
    maxHp,
    attack: attackForLevel(pet.level, pet.breed.baseAttack),
    baseHp: pet.breed.baseHp,
    baseAttack: pet.breed.baseAttack,
    breed: {
      id: pet.breed.id,
      slug: pet.breed.slug,
      displayName: pet.breed.displayName,
      species: pet.breed.species,
    },
    lastFedAt: pet.lastFedAt,
    faintedAt: pet.faintedAt,
    injuredAt: pet.injuredAt,
    armoredAt: pet.armoredAt,
    evolvedAt: pet.evolvedAt,
    createdAt: pet.createdAt,
  };
}

export async function petRoutes(app: FastifyInstance) {
  // GET /pet — full derived state for the user's pet.
  // 404 if the user hasn't adopted yet.
  app.get('/', async (req, reply) => {
    const me = await requireUser(req);
    const pet = await prisma.petInstance.findUnique({ where: { userId: me.id } });
    if (!pet) return reply.code(404).send({ error: 'No pet yet' });
    return await serializePet(pet.id);
  });

  // POST /pet/feed { count?: number } — 10g/feed, +1 XP each.
  // 1-hour cooldown since the LAST feedAt; the cooldown applies
  // per-call (not per count), so passing count=5 burns the same
  // cooldown as count=1.
  app.post('/feed', async (req, reply) => {
    const me = await requireUser(req);
    const body = feedSchema.parse(req.body);
    const pet = await prisma.petInstance.findUnique({ where: { userId: me.id } });
    if (!pet) return reply.code(404).send({ error: 'No pet yet' });
    if (pet.faintedAt) {
      return reply.code(400).send({ error: 'Pet has fainted. Visit the vet first.' });
    }
    const now = new Date();
    if (
      pet.lastFedAt &&
      now.getTime() - pet.lastFedAt.getTime() < PET_FOOD_COOLDOWN_MS
    ) {
      const remainingMs = PET_FOOD_COOLDOWN_MS - (now.getTime() - pet.lastFedAt.getTime());
      const remainingMin = Math.ceil(remainingMs / 60000);
      return reply.code(400).send({
        error: `Feed is on cooldown. ${remainingMin} min remaining.`,
        cooldownMsRemaining: remainingMs,
      });
    }

    const totalCost = PET_FOOD_GOLD_COST * body.count;
    const result = await prisma.$transaction(async (tx: any) => {
      const u = await tx.user.findUnique({ where: { id: me.id }, select: { gold: true } });
      if (!u) throw new Error('user vanished mid-transaction');
      if (u.gold < totalCost) {
        return { error: 'insufficient_gold' as const, gold: u.gold, cost: totalCost };
      }
      const updatedUser = await tx.user.update({
        where: { id: me.id },
        data: { gold: { decrement: totalCost } },
        select: { gold: true },
      });
      const newXp = pet.xp + body.count;
      let level = pet.level;
      let evolvedAt = pet.evolvedAt;
      let armoredAt = pet.armoredAt;
      // Apply level-ups in a loop in case count crosses multiple.
      while (leveledUp(newXp, level)) {
        level += 1;
        if (level === 5 && !evolvedAt) evolvedAt = now;
        if (level === 15 && !armoredAt) armoredAt = now;
      }
      const updatedPet = await tx.petInstance.update({
        where: { id: pet.id },
        data: {
          xp: newXp,
          level,
          lastFedAt: now,
          ...(evolvedAt && !pet.evolvedAt ? { evolvedAt } : {}),
          ...(armoredAt && !pet.armoredAt ? { armoredAt } : {}),
        },
      });
      await tx.petFeedLog.create({
        data: {
          petId: pet.id,
          fedAt: now,
          foodGoldCost: PET_FOOD_GOLD_COST,
          xpGained: body.count,
        },
      });
      return { gold: updatedUser.gold, pet: updatedPet };
    });

    if ('error' in result) {
      return reply.code(402).send({
        error: 'Not enough gold',
        gold: result.gold,
        cost: result.cost,
      });
    }

    await checkAchievements(me.id);
    return await serializePet(result.pet.id);
  });

  // POST /pet/toggle-armor — flip armoredAt on/off.
  // Only allowed at Lv15+ and only when not fainted.
  app.post('/toggle-armor', async (req, reply) => {
    const me = await requireUser(req);
    const pet = await prisma.petInstance.findUnique({ where: { userId: me.id } });
    if (!pet) return reply.code(404).send({ error: 'No pet yet' });
    if (pet.faintedAt) {
      return reply.code(409).send({ error: 'Pet has fainted. Visit the vet first.' });
    }
    if (pet.level < 15) {
      return reply.code(403).send({
        error: 'Pet must be level 15+ to toggle armor',
        level: pet.level,
      });
    }
    const now = new Date();
    const updated = await prisma.petInstance.update({
      where: { id: pet.id },
      data: { armoredAt: pet.armoredAt ? null : now },
    });
    return await serializePet(updated.id);
  });

  // POST /pet/vet — revive a fainted pet. Cost = 10 + 5*level gold.
  // Clears faintedAt and injuredAt; restores HP to breed baseHp*2.
  app.post('/vet', async (req, reply) => {
    const me = await requireUser(req);
    const pet = await prisma.petInstance.findUnique({ where: { userId: me.id } });
    if (!pet) return reply.code(404).send({ error: 'No pet yet' });
    if (!pet.faintedAt) {
      return reply.code(400).send({ error: 'Pet is not fainted' });
    }
    const cost = vetCostGold(pet.level);
    const maxHp = maxHpForLevel(pet.level, /* baseHp known via serialize */ 100);
    // We need the breed's baseHp to compute the restore-to value.
    // Re-fetch with breed included (cheap — already cached likely).
    const petWithBreed = await prisma.petInstance.findUnique({
      where: { id: pet.id },
      include: { breed: true },
    });
    if (!petWithBreed) return reply.code(404).send({ error: 'No pet yet' });
    const restoredHp = maxHpForLevel(petWithBreed.level, petWithBreed.breed.baseHp);

    const result = await prisma.$transaction(async (tx: any) => {
      const u = await tx.user.findUnique({ where: { id: me.id }, select: { gold: true } });
      if (!u) throw new Error('user vanished mid-transaction');
      if (u.gold < cost) {
        return { error: 'insufficient_gold' as const, gold: u.gold, cost };
      }
      const updatedUser = await tx.user.update({
        where: { id: me.id },
        data: { gold: { decrement: cost } },
        select: { gold: true },
      });
      const updatedPet = await tx.petInstance.update({
        where: { id: pet.id },
        data: {
          faintedAt: null,
          injuredAt: null,
          hpAfterCombat: restoredHp,
        },
      });
      return { gold: updatedUser.gold, pet: updatedPet };
    });

    if ('error' in result) {
      return reply.code(402).send({
        error: 'Not enough gold',
        gold: result.gold,
        cost: result.cost,
      });
    }

    await checkAchievements(me.id);
    return await serializePet(result.pet.id);
  });
}