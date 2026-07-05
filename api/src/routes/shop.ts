import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { checkAchievements } from '../lib/achievements.js';
import {
  PET_BREED_BUY_GOLD_COST,
  spritePath,
  spriteStage,
} from '../lib/petStats.js';

const purchaseSchema = z.object({
  itemId: z.string().min(1),
});

const buyPetSchema = z.object({
  /// PetBreed.id (cuid). The user picks which breed from the
  /// /shop/pet-stock list.
  breedId: z.string().min(1),
  /// Owner-chosen name. 1-24 chars. Free text; we only enforce
  /// length and basic trim.
  name: z.string().trim().min(1).max(24),
  /// Must be one of PetBreed.colorVariants for the chosen breed.
  colorVariant: z.string().min(1).max(40),
});

/**
 * Shop routes. The user can list available ShopItem entries and
 * purchase one. Each item's effectKey determines what the
 * `Purchase` row does — see applyPurchaseEffect() below.
 *
 * Cost is paid out of `User.gold` atomically (a transaction).
 * For "immediate" effects (heart_refill) the effect is applied
 * inline. For "duration" effects (raid_buff, pr_doubler) the
 * Purchase row stays in the table with `consumedAt = null` and
 * `expiresAt = now + duration`; downstream callers (raid
 * damage calc, XP/gold calc) check for unconsumed + non-expired
 * Purchase rows and apply the multiplier.
 *
 * For streak_shield, the Purchase row's `expiresAt` is null
 * (one-shot); the streak-protection applies once, then the row
 * is marked consumed.
 */
export async function shopRoutes(app: FastifyInstance) {
  // GET /shop/items — list available items with the user's owned count
  app.get('/items', async (req) => {
    const me = await requireUser(req);
    const items = await prisma.shopItem.findMany({
      where: { active: true },
      orderBy: { cost: 'asc' },
    });
    // For each item, also report the user's currently-held inventory
    // count (unconsumed + non-expired) so the shop UI can show
    // "Owned: 2" badges etc.
    const now = new Date();
    const counts = await prisma.purchase.groupBy({
      by: ['itemId'],
      where: {
        userId: me.id,
        consumedAt: null,
        ...(items.some((i: any) => i.effectDurationSec !== null)
          ? { expiresAt: { gt: now } }
          : {}),
      },
      _count: { _all: true },
    });
    const countByItem = new Map(counts.map((c: any) => [c.itemId, c._count._all]));
    return {
      items: items.map((i: any) => ({
        id: i.id,
        key: i.key,
        name: i.name,
        description: i.description,
        cost: i.cost,
        effectKey: i.effectKey,
        effectValue: i.effectValue,
        effectDurationSec: i.effectDurationSec,
        owned: countByItem.get(i.id) ?? 0,
      })),
    };
  });

  // GET /shop/inventory — user's active (unconsumed + non-expired) purchases
  app.get('/inventory', async (req) => {
    const me = await requireUser(req);
    const now = new Date();
    const items = await prisma.purchase.findMany({
      where: {
        userId: me.id,
        consumedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { purchasedAt: 'desc' },
      include: { item: true },
    });
    return {
      items: items.map((p: any) => ({
        id: p.id,
        itemId: p.itemId,
        name: p.item.name,
        description: p.item.description,
        effectKey: p.item.effectKey,
        purchasedAt: p.purchasedAt,
        expiresAt: p.expiresAt,
        isExpired: p.expiresAt !== null && p.expiresAt <= now,
      })),
    };
  });

  // POST /shop/purchase { itemId }
  // Atomic gold debit + Purchase row insert + immediate-effect
  // application. Returns the updated user state.
  app.post('/purchase', async (req, reply) => {
    const me = await requireUser(req);
    const body = purchaseSchema.parse(req.body);
    const item = await prisma.shopItem.findUnique({ where: { id: body.itemId } });
    if (!item || !item.active) {
      return reply.code(404).send({ error: 'Item not found or inactive' });
    }
    const me0 = await prisma.user.findUnique({
      where: { id: me.id },
      select: { gold: true, mode: true, hearts: true },
    });
    if (!me0) return reply.code(401).send({ error: 'Unauthorized' });
    if (me0.gold < item.cost) {
      return reply.code(400).send({ error: 'Not enough gold', gold: me0.gold, cost: item.cost });
    }

    // Pre-flight checks for items that have a Hardcore-only flag
    // (currently none — all items work in both modes).
    // if (item.key === 'vital_tonic' && me0.mode === 'CASUAL') {
    //   return reply.code(400).send({ error: 'Vital Tonic only useful in Hardcore' });
    // }

    const now = new Date();
    const expiresAt = item.effectDurationSec
      ? new Date(now.getTime() + item.effectDurationSec * 1000)
      : null;

    const result = await prisma.$transaction(async (tx: any) => {
      // Decrement gold
      const user = await tx.user.update({
        where: { id: me.id },
        data: { gold: { decrement: item.cost } },
        select: { gold: true },
      });
      // Create the Purchase row
      const purchase = await tx.purchase.create({
        data: {
          userId: me.id,
          itemId: item.id,
          purchasedAt: now,
          expiresAt,
        },
      });
      // Apply immediate effects (heart_refill is the only one)
      let newHearts = me0.hearts;
      if (item.effectKey === 'heart_refill') {
        const next = Math.min(10, newHearts + item.effectValue);
        if (next > newHearts) {
          await tx.user.update({
            where: { id: me.id },
            data: { hearts: next },
          });
          newHearts = next;
        }
        // heart_refill is consumed immediately
        await tx.purchase.update({
          where: { id: purchase.id },
          data: { consumedAt: now },
        });
      }
      // streak_shield is also one-shot (no duration). The streak-check
      // code reads the unconsumed + non-expired Purchase rows for
      // streak_shield and consumes on use. Mark it "ready" but not yet
      // consumed.
      // ... actually the streak-protection consumption happens in the
      // routine-missed handler, NOT here. Leave the row active.

      return { user, newHearts, purchaseId: purchase.id };
    });

    await checkAchievements(me.id);

    return {
      ok: true,
      gold: result.user.gold,
      hearts: result.newHearts,
      purchaseId: result.purchaseId,
    };
  });

  // ============================================================
  // Pet shop routes.
  //
  // The v1 rotation is hardcoded: the starter breed is always
  // in stock (`isStarter=true`), so users can always pick up
  // their first puppy. If the user has already adopted, the
  // endpoint still returns the current breed for the shop page
  // to render "you already own one — visit /pet" copy.
  // ============================================================

  // GET /shop/pet-stock — all breeds currently available for adoption.
  // v1: returns every PetBreed row (rotation deferred until we have
  // enough breeds to make a pool matter). Order: starter first, then
  // alphabetical. Each entry also reports the foodEffectKey the UI
  // can map to a ShopItem (`pet_food_<species>`) so the shop page
  // can render a "buy food for this breed" hint next to each card.
  app.get('/pet-stock', async (req) => {
    const me = await requireUser(req);
    const breeds = await prisma.petBreed.findMany({
      orderBy: [{ isStarter: 'desc' }, { slug: 'asc' }],
    });
    const stage = spriteStage({
      evolvedAt: null,
      armoredAt: null,
      injuredAt: null,
    });
    return {
      breeds: breeds.map((b: any) => {
        const variants = JSON.parse(b.colorVariants) as string[];
        const colorVariant = variants[0]!;
        return {
          breed: {
            id: b.id,
            slug: b.slug,
            displayName: b.displayName,
            species: b.species,
            costGold: b.costGold,
            description: b.description,
            baseHp: b.baseHp,
            baseAttack: b.baseAttack,
            spriteBasePath: b.spriteBasePath,
            colorVariants: variants,
            spriteStages: JSON.parse(b.spriteStages) as string[],
            isStarter: b.isStarter,
          },
          defaultColorVariant: colorVariant,
          defaultSpritePath: spritePath(b, stage, colorVariant),
          foodEffectKey: `pet_food_${b.species}`,
        };
      }),
    };
  });

  // POST /shop/buy-pet — adopt a pet.
  //   - debit User.gold (atomic with PetInstance insert)
  //   - 409 if user already owns a pet (v1 = one per user)
  //   - 402 if insufficient gold
  //   - 400 if colorVariant isn't on the breed
  //   - 404 if breedId is unknown
  app.post('/buy-pet', async (req, reply) => {
    const me = await requireUser(req);
    const body = buyPetSchema.parse(req.body);

    const breed = await prisma.petBreed.findUnique({
      where: { id: body.breedId },
    });
    if (!breed) {
      return reply.code(404).send({ error: 'Unknown breed' });
    }
    const variants = JSON.parse(breed.colorVariants) as string[];
    if (!variants.includes(body.colorVariant)) {
      return reply.code(400).send({
        error: 'Invalid colorVariant for this breed',
        allowed: variants,
      });
    }

    const result = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.petInstance.findUnique({ where: { userId: me.id } });
      if (existing) {
        return { error: 'already_owns_pet' as const, pet: existing };
      }
      const u = await tx.user.findUnique({
        where: { id: me.id },
        select: { gold: true },
      });
      if (!u) throw new Error('user vanished mid-transaction');
      if (u.gold < breed.costGold) {
        return { error: 'insufficient_gold' as const, gold: u.gold, cost: breed.costGold };
      }
      const updated = await tx.user.update({
        where: { id: me.id },
        data: { gold: { decrement: breed.costGold } },
        select: { gold: true },
      });
      const pet = await tx.petInstance.create({
        data: {
          userId: me.id,
          breedId: breed.id,
          name: body.name,
          colorVariant: body.colorVariant,
          level: 1,
          xp: 0,
        },
      });
      return { gold: updated.gold, pet };
    });

    if ('error' in result) {
      if (result.error === 'already_owns_pet') {
        return reply.code(409).send({ error: 'You already own a pet' });
      }
      return reply.code(402).send({
        error: 'Not enough gold',
        gold: result.gold,
        cost: result.cost,
      });
    }

    return {
      ok: true,
      gold: result.gold,
      petId: result.pet.id,
    };
  });
}
