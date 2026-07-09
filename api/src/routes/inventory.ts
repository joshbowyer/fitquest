import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { EquipSlot } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { requireUser, requireAdmin } from '../lib/auth.js';
import { getEquippedBonus } from '../lib/equipment.js';

/**
 * Inventory — equipment catalog + per-user ownership + equip/unequip.
 *
 * Endpoints:
 *   GET  /inventory           List owned items + equipped state
 *   GET  /inventory/stats     Rolled combat stats from equipped gear
 *   POST /inventory/equip     { itemId, slot }
 *   POST /inventory/unequip   { itemId }
 *   POST /inventory/grant     { itemDefId }  (dev convenience — grants starter)
 *
 * Equipment rules:
 *   - At most one item equipped per slot (auto-unequips current occupant)
 *   - Items with classRestriction only equip if user.class matches
 *     (null restriction = any class)
 *
 * Catalog browsing lives at GET /items (separate route — see items.ts).
 */

async function ensureClassMatch(userId: string, itemDefId: string): Promise<{ ok: boolean; reason?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { class: true },
  });
  const item = await prisma.itemDef.findUnique({
    where: { id: itemDefId },
    select: { classRestriction: true },
  });
  if (!user || !item) return { ok: false, reason: 'user or item not found' };
  if (item.classRestriction && user.class !== item.classRestriction) {
    return { ok: false, reason: `class lock: requires ${item.classRestriction}` };
  }
  return { ok: true };
}

export async function inventoryRoutes(app: FastifyInstance) {
  // GET /inventory — owned items + per-slot equipped map
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const items = await prisma.inventoryItem.findMany({
      where: { userId: me.id },
      orderBy: [{ acquiredAt: 'desc' }],
      include: { itemDef: true },
    });
    // Build an equipped map: { slot: inventoryItem }.
    const equipped: Record<string, typeof items[number] | null> = {};
    for (const slot of Object.values(EquipSlot)) equipped[slot] = null;
    for (const it of items) {
      if (it.equippedSlot) equipped[it.equippedSlot] = it;
    }
    return { items, equipped };
  });

  // GET /inventory/stats — rolled combat stats from all equipped gear.
  // Implementation now lives in `lib/equipment.ts` so the same totals
  // (and set counts) can be reused for the raid-damage wiring in
  // routes/workouts.ts without duplicating the Prisma query + loop.
  // The response shape is UNCHANGED (`{ totals, setCounts }`); the
  // helper returns the totals under the `statTotals` key and we
  // alias it back to `totals` here to preserve the existing API
  // contract that the Inventory.tsx frontend already depends on.
  app.get('/stats', async (req) => {
    const me = await requireUser(req);
    const { statTotals, setCounts } = await getEquippedBonus(me.id);
    return { totals: statTotals, setCounts };
  });

  // POST /inventory/equip — set an owned item into a slot
  const EquipBody = z.object({
    itemId: z.string().min(1),
  });
  app.post('/equip', async (req, reply) => {
    const me = await requireUser(req);
    const { itemId } = EquipBody.parse(req.body);

    const item = await prisma.inventoryItem.findFirst({
      where: { id: itemId, userId: me.id },
      include: { itemDef: true },
    });
    if (!item) return reply.code(404).send({ error: 'Item not found in your inventory' });

    const check = await ensureClassMatch(me.id, item.itemDefId);
    if (!check.ok) return reply.code(403).send({ error: check.reason });

    const slot = item.itemDef.slot;
    // Unequip anyone else currently in this slot (transactional)
    await prisma.$transaction([
      prisma.inventoryItem.updateMany({
        where: { userId: me.id, equippedSlot: slot, NOT: { id: item.id } },
        data: { equippedSlot: null },
      }),
      prisma.inventoryItem.update({
        where: { id: item.id },
        data: { equippedSlot: slot },
      }),
    ]);
    return { ok: true, slot, itemId };
  });

  // POST /inventory/unequip — clear an item's slot
  app.post('/unequip', async (req, reply) => {
    const me = await requireUser(req);
    const { itemId } = EquipBody.parse(req.body);
    const item = await prisma.inventoryItem.findFirst({
      where: { id: itemId, userId: me.id },
    });
    if (!item) return reply.code(404).send({ error: 'Item not found' });
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { equippedSlot: null },
    });
    return { ok: true };
  });

  // POST /inventory/grant — grant an item by defId. Admin-only:
  // the only caller is the Admin page's item-grant tool, and an
  // ungated version let ANY authenticated user mint arbitrary
  // items (including MYTHIC gear that feeds raid/boss stats) for
  // free, bypassing the shop/loot economy entirely.
  const GrantBody = z.object({
    itemDefId: z.string().min(1),
    source: z.enum(['MONSTER_DROP', 'BOSS_DROP', 'QUEST_REWARD', 'SHOP', 'CRAFTED', 'ACHIEVEMENT', 'STARTER_KIT']).default('STARTER_KIT'),
    notes: z.string().max(200).optional(),
  });
  app.post('/grant', async (req, reply) => {
    const me = await requireAdmin(req);
    const body = GrantBody.parse(req.body);
    const def = await prisma.itemDef.findUnique({ where: { id: body.itemDefId } });
    if (!def) return reply.code(404).send({ error: 'ItemDef not found' });
    const created = await prisma.inventoryItem.create({
      data: {
        userId: me.id,
        itemDefId: body.itemDefId,
        source: body.source,
        notes: body.notes ?? null,
      },
      include: { itemDef: true },
    });
    return { item: created };
  });
}

/**
 * Items catalog — browse the ItemDef table.
 * Separate route so it can be permissioned differently from /inventory
 * (e.g. public browse vs owner-only inventory state).
 */
export async function itemRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const q = z.object({
      slot: z.nativeEnum(EquipSlot).optional(),
      rarity: z.enum(['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC']).optional(),
      classRestriction: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }).parse(req.query);

    const where: any = {};
    if (q.slot) where.slot = q.slot;
    if (q.rarity) where.rarity = q.rarity;
    if (q.classRestriction) where.classRestriction = q.classRestriction;

    const items = await prisma.itemDef.findMany({
      where,
      orderBy: [{ rarity: 'asc' }, { name: 'asc' }],
      take: q.limit,
    });
    return { items };
  });

  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await prisma.itemDef.findUnique({ where: { id } });
    if (!item) return reply.code(404).send({ error: 'Item not found' });
    return { item };
  });
}