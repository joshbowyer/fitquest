// ============================================================
// Portal leak routes
// ============================================================
//
// GET  /portal-leak             — current active leak + recent damage
// POST /portal-leak/check-spawn — evaluate shield; spawn leak if conditions met
// POST /portal-leak/:id/attack  — apply workout damage to an active leak
// POST /portal-leak/:id/claim   — claim loot on a defeated leak
//
// All routes scope to req.user.id.
// ============================================================

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import {
  applyLeakDamage,
  claimLeakLoot,
  getLeakForUser,
  maybeSpawnLeak,
} from '../lib/portalLeaks.js';
import { tierForShield } from '../lib/penance.js';

export async function portalLeakRoutes(app: FastifyInstance) {
  // GET /portal-leak — current leak state. The `leaks` array is
  // the canonical stacking-aware list; `leak` and `recent` are
  // populated for backwards-compat with the homebase dashboard's
  // single-leak view (head of the queue).
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const result = await getLeakForUser(me.id);
    const head = result.leaks[0] ?? null;
    return {
      ...result,
      // Backwards-compat — homebase alert reads these.
      leak: head?.leak ?? null,
      recent: head?.recent ?? [],
    };
  });

  // GET /portal-leak/history — recently-resolved leaks (DEFEATED /
  // OVERWHELMED / EXPIRED), newest first. The dashboard card only
  // shows the current leak, so this is for the full /portal-leak
  // page and any future "leak log" elsewhere.
  //
  // Optional ?source=AMBIENT|BREACH filter. The /portal-leak page
  // uses this to split the two monster sources (regular ambient
  // shield leaks vs Breach-world escapes) into separate lists
  // so the user can see "I've been spawning breach leaks because
  // I've been killing The Maw" at a glance.
  app.get('/history', async (req) => {
    const me = await requireUser(req);
    const q = (req.query ?? {}) as { source?: string };
    const source = q.source === 'AMBIENT' || q.source === 'BREACH' ? q.source : null;
    const where: any = {
      userId: me.id,
      status: { in: ['DEFEATED', 'OVERWHELMED', 'EXPIRED'] },
    };
    if (source) where.worldSource = source;
    const items = await prisma.portalLeak.findMany({
      where,
      orderBy: { resolvedAt: 'desc' },
      take: 25,
    });
    return { items };
  });

  // POST /portal-leak/check-spawn — call after any shield-drop
  // event. Reads current shield score, rolls dice based on tier,
  // and spawns a leak if conditions are right.
  app.post('/check-spawn', async (req) => {
    const me = await requireUser(req);
    const body = z.object({
      shieldScore: z.number().int().min(0).max(100),
    }).parse(req.body);
    const result = await maybeSpawnLeak(me.id, body.shieldScore);
    return result;
  });

  // POST /portal-leak/:id/attack — apply workout damage to a
  // specific leak. The damage math is the same as Breach but
  // scaled down. The route is exposed for explicit UI flows
  // (e.g. "Train to seal the leak" buttons); the workout
  // commit handler also fires it inline.
  app.post('/:id/attack', async (req, reply) => {
    const me = await requireUser(req);
    const { id } = req.params as { id: string };
    const body = z.object({
      workoutId: z.string().min(1),
    }).parse(req.body);
    const leak = await prisma.portalLeak.findUnique({ where: { id } });
    if (!leak || leak.userId !== me.id) return reply.code(404).send({ error: 'leak_not_found' });
    if (leak.status !== 'ACTIVE') return reply.code(400).send({ error: 'leak_not_active', status: leak.status });
    // Delegate to the workout-keyed function which also handles
    // the classification + per-workout damage math.
    const result = await applyLeakDamage(me.id, body.workoutId);
    if (!result) return reply.code(400).send({ error: 'no_active_leak' });
    return result;
  });

  // POST /portal-leak/:id/claim — claim loot on a DEFEATED leak.
  // Single-shot: drops the item into inventory and clears the
  // leak's itemDrop so a second call returns null.
  app.post('/:id/claim', async (req, reply) => {
    const me = await requireUser(req);
    const { id } = req.params as { id: string };
    const result = await claimLeakLoot(me.id, id);
    if (!result) return reply.code(400).send({ error: 'cannot_claim', reason: 'leak_not_defeated_or_already_claimed' });
    return result;
  });

  // POST /portal-leak/:id/dismiss — explicitly dismiss a DEFEATED
  // leak without claiming loot (user chooses to walk away from
  // the prize). Useful for "I don't need this item" UX.
  app.post('/:id/dismiss', async (req, reply) => {
    const me = await requireUser(req);
    const { id } = req.params as { id: string };
    const leak = await prisma.portalLeak.findUnique({ where: { id } });
    if (!leak || leak.userId !== me.id) return reply.code(404).send({ error: 'leak_not_found' });
    if (leak.status !== 'DEFEATED') return reply.code(400).send({ error: 'leak_not_defeated' });
    await prisma.portalLeak.update({
      where: { id: leak.id },
      data: { itemDrop: null },
    });
    return { ok: true };
  });
}

// Re-export the tier helper so the dashboard's spawn check
// gets the tier in one place.
export { tierForShield };
