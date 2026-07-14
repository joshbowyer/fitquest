import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser, requireAdmin } from '../lib/auth.js';
import {
  getOrCreateHomeBase,
  recentPenanceEvents,
  tierForShield,
  TIER_LABEL,
  TIER_COLOR,
} from '../lib/penance.js';
import type { PenanceKey } from '../lib/penance.js';

/**
 * Home-base + penance endpoints.
 *
 *   GET /home-base               — shield value, tier, recent events
 *   GET /penances                — list user's enabled penances
 *                                  (system defaults + user-custom)
 *   PATCH /penances/:key/toggle  — enable/disable a penance for the
 *                                  current user. User override takes
 *                                  precedence over the system default;
 *                                  disabling creates a user row with
 *                                  enabled=false so the next sign-in
 *                                  remembers the choice.
 *   DELETE /penances/:key        — remove the user override (the
 *                                  system default resumes).
 */

export async function homeBaseRoutes(app: FastifyInstance) {
  /**
   * GET /home-base
   * Current shield state + recent penance events. Lazy-creates the
   * HomeBase row on first read so we don't need to seed.
   */
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const base = await getOrCreateHomeBase(me.id);
    const events = await recentPenanceEvents(me.id, 20);
    return {
      shield: base.shield,
      tier: base.tier,
      tierLabel: TIER_LABEL[base.tier],
      tierColor: TIER_COLOR[base.tier],
      recentEvents: events.map((e) => ({
        id: e.id,
        key: e.penanceKey,
        label: e.label,
        shieldDelta: e.shieldDelta,
        shieldAfter: e.shieldAfter,
        tierAfter: e.tierAfter,
        source: e.source,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  });

  /**
   * GET /penances
   * List the user's effective penance set: system defaults + any
   * user-custom rows. Used by /settings (future) and the home-base
   * detail page. System defaults come from the PENANCE_DELTAS
   * constant — see api/src/lib/penance.ts.
   */
  app.get('/penances', async (req) => {
    const me = await requireUser(req);
    const penanceLib = await import('../lib/penance.js');
    const { PENANCE_DELTAS, PENANCE_LABELS, PENANCE_FLAVORS } = penanceLib;
    // Narrow the keys to the ones actually present in PENANCE_DELTAS
    // (which excludes 'custom'). Without this, indexing the records
    // below with noUncheckedIndexedAccess produces "possibly undefined"
    // / "Property 'custom' does not exist" errors.
    const systemKeys = Object.keys(PENANCE_DELTAS) as Array<Exclude<PenanceKey, 'custom'>>;
    const userOverrides = await prisma.penanceTemplate.findMany({
      where: { userId: me.id },
      orderBy: { key: 'asc' },
    });
    const overrideByKey = new Map(userOverrides.map((t) => [t.key, t]));
    const effective = systemKeys.map((key) => {
      const override = overrideByKey.get(key);
      if (override) {
        return {
          id: override.id,
          key,
          label: override.label,
          flavor: override.flavor,
          shieldDelta: override.shieldDelta,
          enabled: override.enabled,
          isUserOverride: true,
        };
      }
      return {
        id: `system:${key}`,
        key,
        label: PENANCE_LABELS[key],
        flavor: PENANCE_FLAVORS[key],
        shieldDelta: PENANCE_DELTAS[key],
        enabled: true,
        isUserOverride: false,
      };
    });
    return {
      items: effective,
      userOverrides: userOverrides.map((t) => ({
        id: t.id,
        key: t.key,
        label: t.label,
        flavor: t.flavor,
        shieldDelta: t.shieldDelta,
        enabled: t.enabled,
      })),
    };
  });

  /**
   * PATCH /penances/:key/toggle
   * Enable or disable a single penance for the current user.
   * Creates a user-scoped row when one doesn't exist yet (so the
   * choice persists across reloads without mutating the system
   * default).
   */
  app.patch<{ Params: { key: string } }>('/penances/:key/toggle', async (req, reply) => {
    const me = await requireUser(req);
    const key = req.params.key as PenanceKey;
    const body = z.object({ enabled: z.boolean() }).parse(req.body);

    const { PENANCE_DELTAS, PENANCE_LABELS, PENANCE_FLAVORS } = await import('../lib/penance.js');
    // 'custom' isn't in the records below (they're keyed by the
    // non-custom PenanceKey subset). Look up the delta as the
    // narrower type so the indexing isn't an error.
    const sysDelta = key === 'custom' ? undefined : PENANCE_DELTAS[key as Exclude<PenanceKey, 'custom'>];
    if (sysDelta == null && key !== 'custom') {
      return reply.code(404).send({ error: `No penance template for key '${key}'` });
    }

    const existing = await prisma.penanceTemplate.findUnique({
      where: { userId_key: { userId: me.id, key } },
    });
    if (existing) {
      const updated = await prisma.penanceTemplate.update({
        where: { id: existing.id },
        data: { enabled: body.enabled },
      });
      return { id: updated.id, key: updated.key, enabled: updated.enabled };
    }
    // No user override — copy the system default's label / flavor /
    // delta so the user's override starts as a shadow of the default.
    const created = await prisma.penanceTemplate.create({
      data: {
        userId: me.id,
        key,
        label: key === 'custom' ? '' : PENANCE_LABELS[key as Exclude<PenanceKey, 'custom'>],
        flavor: key === 'custom' ? null : PENANCE_FLAVORS[key as Exclude<PenanceKey, 'custom'>],
        shieldDelta: sysDelta ?? 0,
        enabled: body.enabled,
      },
    });
    return { id: created.id, key: created.key, enabled: created.enabled };
  });

  /**
   * DELETE /penances/:key
   * Remove the user's override (if any). The system default
   * resumes immediately on the next fire.
   */
  app.delete<{ Params: { key: string } }>('/penances/:key', async (req, reply) => {
    const me = await requireUser(req);
    const key = req.params.key;
    const existing = await prisma.penanceTemplate.findUnique({
      where: { userId_key: { userId: me.id, key } },
    });
    if (!existing) {
      return reply.code(404).send({ error: 'No user override for this key' });
    }
    await prisma.penanceTemplate.delete({ where: { id: existing.id } });
    return { ok: true };
  });

  /**
   * GET /home-base/summary
   * Lightweight endpoint for dashboard widgets. Returns just the
   * shield value + tier + 5 most recent events. Smaller payload
   * than the full GET /home-base.
   */
  app.get('/summary', async (req) => {
    const me = await requireUser(req);
    const base = await getOrCreateHomeBase(me.id);
    const events = await recentPenanceEvents(me.id, 5);
    return {
      shield: base.shield,
      tier: base.tier,
      tierLabel: TIER_LABEL[base.tier],
      tierColor: TIER_COLOR[base.tier],
      recentEvents: events,
    };
  });

  /**
   * POST /home-base/dev-tools/breach-shield
   * Dev-only: sets the calling admin's shield to 0 (BREACHED) and
   * logs a "manual breach" penance event for the audit feed. Used
   * by the Admin → Dev tools panel to test the missed_all_dailies
   * penance auto-fire (open the morning report after this and the
   * -20 should show in the home-base event feed).
   *
   * Gated to admins (requireAdmin) — pointless to expose to
   * regular users but a useful dev tool.
   */
  app.post('/dev-tools/breach-shield', async (req) => {
    const me = await requireAdmin(req);
    const base = await getOrCreateHomeBase(me.id);
    const shieldBefore = base.shield;
    const tierBefore = base.tier;
    const updated = await prisma.homeBase.update({
      where: { id: base.id },
      data: { shield: 0, tier: 'BREACHED' },
    });
    await prisma.penanceEvent.create({
      data: {
        userId: me.id,
        penanceKey: 'custom',
        label: `Dev tools · manual breach (${shieldBefore} ${tierBefore} → 0 BREACHED)`,
        shieldDelta: -shieldBefore,
        shieldAfter: 0,
        tierAfter: 'BREACHED',
        source: 'manual',
      },
    });
    return { shield: updated.shield, tier: updated.tier };
  });
}

/** Re-export for tests + other route files. */
export { tierForShield, TIER_LABEL, TIER_COLOR };
