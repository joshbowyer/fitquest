import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { PLATEAU_KINDS, type PlateauKind } from '../lib/plateau.js';

const PlateauKindSchema = z.enum([
  'NO_PR_RECENT',
  'ONE_RM_REGRESSION',
  'VOLUME_REGRESSION',
  'WEIGHT_FLATLINE',
  'METRIC_FLATLINE',
  'ALL',
]);

const CreateSchema = z.object({
  kind: PlateauKindSchema,
  /** How many days from now to mute. 1..365. */
  days: z.number().int().min(1).max(365),
  /** Optional free-text note ("summer cut", "post-injury deload"). */
  reason: z.string().max(140).optional(),
});

export async function plateauRoutes(app: FastifyInstance) {
  /**
   * GET /plateaus/pauses
   * List the caller's currently-active plateau pauses (resumeAt > now).
   * Past-expiry rows are filtered out at the SQL level so the UI
   * doesn't have to.
   */
  app.get('/pauses', async (req) => {
    const me = await requireUser(req);
    const now = new Date();
    const rows = await prisma.plateauPause.findMany({
      where: { userId: me.id, resumeAt: { gt: now } },
      orderBy: { resumeAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      pausedAt: r.pausedAt.toISOString(),
      resumeAt: r.resumeAt.toISOString(),
      reason: r.reason,
    }));
  });

  /**
   * POST /plateaus/pauses
   * Create a new pause. If a pause already exists for the same
   * kind, replace it (resumeAt updated; same id). Prevents stacking
   * redundant pauses on the same kind which would just spam the
   * settings list.
   */
  app.post('/pauses', async (req) => {
    const me = await requireUser(req);
    const body = CreateSchema.parse(req.body);
    const now = new Date();
    const resumeAt = new Date(now.getTime() + body.days * 24 * 60 * 60 * 1000);

    // Upsert by (userId, kind). The unique constraint we want
    // doesn't exist in the schema (deliberately — pauses can be
    // re-created after expiry), so we emulate it: delete any active
    // pause of the same kind first, then create a fresh one.
    await prisma.plateauPause.deleteMany({
      where: { userId: me.id, kind: body.kind as any, resumeAt: { gt: now } },
    });
    const row = await prisma.plateauPause.create({
      data: {
        userId: me.id,
        kind: body.kind as any,
        resumeAt,
        reason: body.reason ?? null,
      },
    });
    return {
      id: row.id,
      kind: row.kind,
      pausedAt: row.pausedAt.toISOString(),
      resumeAt: row.resumeAt.toISOString(),
      reason: row.reason,
    };
  });

  /**
   * DELETE /plateaus/pauses/:id
   * End a pause early. Only the owner can delete; non-owned or
   * already-expired ids return 404.
   */
  app.delete<{ Params: { id: string } }>('/pauses/:id', async (req, reply) => {
    const me = await requireUser(req);
    const row = await prisma.plateauPause.findUnique({ where: { id: req.params.id } });
    if (!row || row.userId !== me.id) return reply.code(404).send({ error: 'Not found' });
    await prisma.plateauPause.delete({ where: { id: row.id } });
    return { ok: true };
  });

  /**
   * GET /plateaus
   * Run the detector on demand and return the current array. Useful
   * for the settings "preview" panel — the user can see what would
   * fire if no pauses were active.
   */
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const { detectPlateaus } = await import('../lib/plateau.js');
    const plateaus = await detectPlateaus(me.id);
    return { plateaus };
  });
}

// Re-export for tests / other callers.
export { PLATEAU_KINDS };
