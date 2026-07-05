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

/**
 * Resolve which pet the user is acting on. If petId is provided,
 * validate it belongs to the user. Otherwise return the user's
 * primary pet (oldest by createdAt). Returns null if the user
 * has no pets OR if the specified petId doesn't belong to them.
 */
async function resolvePet(userId: string, petId: string | undefined) {
  if (petId) {
    const p = await prisma.petInstance.findFirst({
      where: { id: petId, userId },
      include: { breed: true },
    });
    return p;
  }
  // No petId → primary = oldest by createdAt
  return prisma.petInstance.findFirst({
    where: { userId },
    include: { breed: true },
    orderBy: { createdAt: 'asc' },
  });
}

const feedSchema = z.object({
  /// The ShopItem.id of the food the user wants to feed.
  /// Must be a pet_food_* effectKey matching the pet's species.
  /// User must own at least `count` unconsumed Purchase rows for it.
  foodItemId: z.string().min(1),
  /// How many units of food to feed at once. 1-50. Each unit gives
  /// the food's effectValue XP.
  count: z.number().int().min(1).max(50).default(1),
  /// Optional petId. If omitted, the user's primary pet (oldest by
  /// createdAt) is fed.
  petId: z.string().min(1).optional(),
});

const petIdOnlySchema = z.object({
  petId: z.string().min(1).optional(),
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
    isCombatEligible: pet.level >= 15 && !pet.faintedAt,
    deployed: pet.deployed,
    canDeploy: pet.level >= 15 && !pet.faintedAt,
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
    lastFaintProgress: pet.lastFaintProgress,
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
  // GET /pet — full pet roster + active pet. Returns:
  //   { pets: Pet[], primaryPetId: string|null }
  // Sorted by createdAt asc; primary = oldest. Frontend renders
  // the primary as the default view; user can click others to
  // inspect.
  app.get('/', async (req, reply) => {
    const me = await requireUser(req);
    const pets = await prisma.petInstance.findMany({
      where: { userId: me.id },
      include: { breed: true },
      orderBy: { createdAt: 'asc' },
    });
    const serialized = await Promise.all(pets.map((p) => serializePet(p.id)));
    return {
      pets: serialized,
      primaryPetId: serialized[0]?.id ?? null,
    };
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
    const pet = await resolvePet(me.id, body.petId);
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
    const body = petIdOnlySchema.parse(req.body ?? {});
    const pet = await resolvePet(me.id, body.petId);
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
  // Clears faintedAt, injuredAt, and lastFaintProgress; restores HP
  // to breed baseHp*2. Note: `deployed` stays false — user must
  // explicitly re-deploy the pet after a revive.
  app.post('/vet', async (req, reply) => {
    const me = await requireUser(req);
    const body = petIdOnlySchema.parse(req.body ?? {});
    const pet = await resolvePet(me.id, body.petId);
    if (!pet) return reply.code(404).send({ error: 'No pet yet' });
    if (!pet.faintedAt) {
      return reply.code(400).send({ error: 'Pet is not fainted' });
    }
    const cost = vetCostGold(pet.level);
    const restoredHp = maxHpForLevel(pet.level, pet.breed.baseHp);

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
          // Reset the faint-progress snapshot too — there's no
          // mid-fight boss to credit any more.
          lastFaintProgress: null,
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

  // POST /pet/toggle-deploy — flip the deployed flag on the pet.
  // Only meaningful at Lv15+ (combat eligibility). Deploy defaults
  // to false; user must opt in to receive combat XP. When fainted
  // (either from HP=0 mid-fight or from a draw/loss), the combat
  // endpoints auto-flip deployed=false; user can't redeploy until
  // the vet revives.
  // Re-deploying also clears any stale lastFaintProgress snapshot
  // from a prior fight — it doesn't apply to the new fight.
  //
  // Only ONE pet per user may be deployed at a time. Toggling deploy
  // on auto-recalls any other currently-deployed pet.
  app.post('/toggle-deploy', async (req, reply) => {
    const me = await requireUser(req);
    const body = petIdOnlySchema.parse(req.body ?? {});
    const pet = await resolvePet(me.id, body.petId);
    if (!pet) return reply.code(404).send({ error: 'No pet yet' });
    if (pet.faintedAt) {
      return reply.code(409).send({ error: 'Pet has fainted. Visit the vet first.' });
    }
    if (pet.level < 15) {
      return reply.code(403).send({
        error: 'Pet must be level 15+ to deploy in combat',
        level: pet.level,
      });
    }
    const willDeploy = !pet.deployed;
    const updated = await prisma.$transaction(async (tx: any) => {
      // If we're deploying this pet, recall any other deployed pet
      // for this user first — only one can be deployed at a time.
      if (willDeploy) {
        await tx.petInstance.updateMany({
          where: { userId: me.id, deployed: true, NOT: { id: pet.id } },
          data: { deployed: false, lastFaintProgress: null },
        });
      }
      return tx.petInstance.update({
        where: { id: pet.id },
        data: {
          deployed: willDeploy,
          lastFaintProgress: null,
        },
      });
    });
    return await serializePet(updated.id);
  });

  // POST /pet/release { petId } — release a pet from the roster.
  // Hard-delete the PetInstance row. Cascades to PetFeedLog via
  // the relation's onDelete: Cascade. The pet's sprite file is
  // not touched (sprites are shared across all instances of a
  // breed/variant, and we may want the same breed + variant
  // combo again later).
  //
  // Frees one roster slot. No gold refund — this is a permanent
  // release, not a sale. Like Pokémon's release-to-the-wild, but
  // without a PC box to fall back to.
  app.post('/release', async (req, reply) => {
    const me = await requireUser(req);
    const body = petIdOnlySchema.parse(req.body ?? {});
    const pet = await prisma.petInstance.findFirst({
      where: body.petId ? { id: body.petId, userId: me.id } : { userId: me.id, faintedAt: null },
    });
    if (!pet) {
      return reply.code(404).send({ error: 'Pet not found' });
    }
    await prisma.petInstance.delete({ where: { id: pet.id } });
    return {
      ok: true,
      releasedPetId: pet.id,
      releasedPetName: pet.name,
    };
  });
}