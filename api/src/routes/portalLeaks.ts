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
  // event. Reads the user's CURRENT shield from the HomeBase row
  // (NOT from the request body — that field used to be trusted and
  // was the source of the audit C6 bug: dashboard sent shieldScore=0
  // on every mount, so tierForShield(0) returned BREACHED and the
  // probe rolled a 50% spawn every page load). Body is accepted
  // for backwards-compat but ignored. Schema keeps the field
  // optional so old callers still pass validation.
  app.post('/check-spawn', async (req) => {
    const me = await requireUser(req);
    // Empty body is fine; old clients may still POST shieldScore
    // and we accept-and-ignore it. Reading the canonical value
    // from the DB closes the audit C6 gap.
    z.object({
      shieldScore: z.number().int().min(0).max(100).optional(),
    }).parse(req.body ?? {});
    const base = await prisma.homeBase.findUnique({ where: { userId: me.id } });
    // Brand-new user without a HomeBase row is at FORTIFIED (100)
    // — never spawn. getOrCreateHomeBase would also work but
    // creates a row we don't strictly need for a read-only probe.
    const shieldScore = base?.shield ?? 100;
    const result = await maybeSpawnLeak(me.id, shieldScore);
    return result;
  });

  // POST /portal-leak/:id/attack — apply workout damage to a
  // SPECIFIC leak (the user picked a target). Distinct from the
  // auto-apply-on-commit path in routes/workouts.ts, which
  // cascades damage to every active leak matching the workout's
  // hitTags. Here, `:id` is honored: the helper is invoked with
  // `targetLeakId: id` so only this leak is in scope.
  //
  // The damage math is the same as Breach but scaled down. The
  // route is exposed for explicit UI flows (e.g. "Train to seal
  // the leak" buttons); the workout commit handler also fires
  // the helper inline via a different code path.
  //
  // Tag-mismatch semantics: if this leak's preferredTags /
  // bonusTags don't overlap the workout's hitTags, NO damage
  // lands — the helper returns `matched: 0` and we surface it
  // here so the UI can distinguish "no-op" from "no active leak"
  // (a leak exists; you just didn't train for it). NOT a 400 —
  // a targeted attack on a non-matching leak is the user's
  // prerogative; the route just gives them honest feedback.
  //
  // workoutId is optional in the body. If the caller doesn't
  // supply one (e.g. the modal is fired without picking a
  // workout), we fall back to the user's most-recent workout —
  // the natural "what did I just log?" default.
  app.post('/:id/attack', async (req, reply) => {
    const me = await requireUser(req);
    const { id } = req.params as { id: string };
    // Empty body is fine — workoutId is optional. Schema treats
    // an absent field the same as an old client that never sent
    // one in the first place.
    const body = z.object({
      workoutId: z.string().min(1).optional(),
    }).parse(req.body ?? {});
    // Look up the leak first so 404 / 400 errors short-circuit
    // before any helper work. The helper would also harmlessly
    // skip a leak it can't find via targetLeakId, but the
    // route-side check gives clearer error semantics.
    const leak = await prisma.portalLeak.findUnique({ where: { id } });
    if (!leak || leak.userId !== me.id) return reply.code(404).send({ error: 'leak_not_found' });
    if (leak.status !== 'ACTIVE') return reply.code(400).send({ error: 'leak_not_active', status: leak.status });
    // Resolve workoutId. If the body supplied one, use it; else
    // fall back to most-recent workout so the modal works
    // without forcing the UI to plumb a workoutId.
    let workoutId = body.workoutId;
    if (!workoutId) {
      const recent = await prisma.workout.findFirst({
        where: { userId: me.id },
        orderBy: { performedAt: 'desc' },
        take: 1,
      });
      if (!recent) {
        return reply.code(400).send({ error: 'no_workout_available', reason: 'no_workoutId_in_body_and_no_recent_workout' });
      }
      workoutId = recent.id;
    }
    // Delegate to the workout-keyed function with the route's
    // :id as the single-target scope. targeting is now ACTUAL —
    // pre-C7-fix this endpoint's :id was silently overridden by
    // the helper's findFirst, which made the modal lie about
    // which leak it was attacking.
    const summary = await applyLeakDamage(me.id, workoutId, prisma, { targetLeakId: id });
    // summary is always defined; matched === 0 is the no-op
    // signal. We deliberately do NOT 400 here — the call is
    // well-formed (we found the leak, it's active, a workout
    // exists); it just didn't match this leak's tags.
    return summary;
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
