import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { checkAchievements } from '../lib/achievements.js';

const purchaseSchema = z.object({
  itemId: z.string().min(1),
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
}
