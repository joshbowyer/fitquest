import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { checkAchievements } from '../lib/achievements.js';
import {
  PET_FOOD_COOLDOWN_MS,
  attackForLevel,
  leveledUp,
  maxHpForLevel,
  spritePath,
  spriteStage,
  vetCostGold,
  xpToNextLevel,
} from '../lib/petStats.js';

const feedSchema = z.object({
  /// The ShopItem.id of the food the user wants to feed.
  /// Must be a pet_food_* effectKey matching the pet's species.
  /// User must own at least `count` unconsumed Purchase rows for it.
  foodItemId: z.string().min(1),
  /// How many units of food to feed at once. 1-50. Each unit gives
  /// the food's effectValue XP.
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

  // POST /pet/feed { foodItemId, count? } — consume pet food from
  // inventory to feed the user's pet. Each unit = foodItem.effectValue XP.
// 1-hour cooldown since the LAST feedAt (per-call, not per count).
//   - 400 if pet is fainted
//   - 400 if on cooldown
//   - 400 if foodItemId doesn't match the pet's species
//   - 402 if user doesn't own enough of the food
app.post('/feed', async (req, reply) => {
    const me = await requireUser(req);
    const body = feedSchema.parse(req.body);
    const pet = await prisma.petInstance.findUnique({
      where: { userId: me.id },
      include: { breed: true },
    });
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

    // Validate the food item exists, is active, and matches the pet's
    // species (effectKey='pet_food_<species>').
    const foodItem = await prisma.shopItem.findUnique({
      where: { id: body.foodItemId },
    });
    if (!foodItem || !foodItem.active) {
      return reply.code(404).send({ error: 'Unknown food item' });
    }
    const expectedEffectKey = `pet_food_${pet.breed.species}`;
    if (foodItem.effectKey !== expectedEffectKey) {
      return reply.code(400).send({
        error: `${foodItem.name} is not food for ${pet.breed.displayName}. They eat ${expectedEffectKey === 'pet_food_dog' ? 'kibble' : 'something else'}.`,
        expected: expectedEffectKey,
      });
    }

    const xpPerUnit = foodItem.effectValue || 1;
    const xpGain = body.count * xpPerUnit;

    const result = await prisma.$transaction(async (tx: any) => {
      // Pull unconsumed + non-expired Purchase rows for this user +
      // food item, oldest first. LIMIT count.
      const available = await tx.purchase.findMany({
        where: {
          userId: me.id,
          itemId: body.foodItemId,
          consumedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: { purchasedAt: 'asc' },
        take: body.count,
      });
      if (available.length < body.count) {
        return {
          error: 'insufficient_food' as const,
          owned: available.length,
          needed: body.count,
        };
      }
      // Mark consumed.
      await tx.purchase.updateMany({
        where: { id: { in: available.map((p: any) => p.id) } },
        data: { consumedAt: now },
      });
      // Apply XP + level-ups.
      const newXp = pet.xp + xpGain;
      let level = pet.level;
      let evolvedAt = pet.evolvedAt;
      let armoredAt = pet.armoredAt;
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
          foodGoldCost: foodItem.cost, // historical cost per unit
          xpGained: xpGain,
        },
      });
      return { pet: updatedPet };
    });

    if ('error' in result) {
      return reply.code(402).send({
        error: `Not enough ${foodItem.name}. You have ${result.owned}, need ${result.needed}.`,
        owned: result.owned,
        needed: result.needed,
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